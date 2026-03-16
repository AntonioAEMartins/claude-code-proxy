import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

interface ToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/**
 * MCP Bridge Server
 *
 * Runs as a child process, speaking MCP stdio protocol.
 * The CLI connects to this server to discover and call tools.
 *
 * Tool definitions are passed via the TOOL_DEFINITIONS environment variable.
 *
 * When a tool is called by the Claude CLI, this bridge returns a placeholder
 * result. The proxy process detects the tool_use block in the CLI's output
 * stream and surfaces it to the HTTP client as stop_reason: "tool_use".
 * The client then sends a follow-up request with the actual tool_result.
 */

async function main(): Promise<void> {
  const toolDefsJson = process.env.TOOL_DEFINITIONS;
  if (!toolDefsJson) {
    process.stderr.write('ERROR: TOOL_DEFINITIONS environment variable not set\n');
    process.exit(1);
  }

  let toolDefs: ToolDefinition[];
  try {
    toolDefs = JSON.parse(toolDefsJson);
  } catch {
    process.stderr.write('ERROR: Failed to parse TOOL_DEFINITIONS JSON\n');
    process.exit(1);
  }

  const server = new McpServer({
    name: 'client_tools',
    version: '1.0.0',
  });

  // Register each tool definition
  for (const tool of toolDefs) {
    // The McpServer.tool() method signature: (name, description, schema, handler)
    // We need to use the raw registration approach for dynamic schemas
    server.tool(
      tool.name,
      tool.description || '',
      tool.input_schema as any,
      async (args: Record<string, unknown>) => {
        // Return a placeholder result.
        // The proxy will intercept the tool_use block from the CLI's output
        // and return it to the client before this result is used.
        // When the client sends a follow-up request with tool_result,
        // the proxy will embed it in the prompt of a new CLI invocation.
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'pending',
                message: 'Tool execution delegated to client. Result will be provided in follow-up request.',
                tool_name: tool.name,
                arguments: args,
              }),
            },
          ],
        };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP Bridge fatal error: ${err}\n`);
  process.exit(1);
});
