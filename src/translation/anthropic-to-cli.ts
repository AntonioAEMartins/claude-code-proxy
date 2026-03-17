import type { AnthropicMessagesRequest, AnthropicMessage, AnthropicContentBlock, AnthropicToolResultContent } from '../protocol/anthropic-types.js';
import type { CliArgs } from '../cli/args-builder.js';
import { badRequest } from '../util/errors.js';
import { buildMcpConfig } from '../tools/tool-translator.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Extract system prompt from the request.
 * Can be a string or an array of {type: "text", text: "..."} blocks.
 */
function extractSystemPrompt(system: AnthropicMessagesRequest['system']): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  // Array of text blocks
  return system.map(block => block.text).join('\n\n');
}

/**
 * Convert a single content block to text representation for the prompt.
 */
function contentBlockToText(block: AnthropicContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
      return '[Image content]';
    case 'tool_use':
      return `<tool_call id="${block.id}" name="${block.name}">\n${JSON.stringify(block.input, null, 2)}\n</tool_call>`;
    case 'tool_result': {
      const resultContent = formatToolResultContent(block);
      const errorAttr = block.is_error ? ' is_error="true"' : '';
      return `<tool_result tool_use_id="${block.tool_use_id}"${errorAttr}>\n${resultContent}\n</tool_result>`;
    }
    default:
      return '';
  }
}

function formatToolResultContent(block: AnthropicToolResultContent): string {
  if (!block.content) return '';
  if (typeof block.content === 'string') return block.content;
  return block.content.map(b => b.text).join('\n');
}

/**
 * Convert the message content to text.
 * Content can be a string or an array of content blocks.
 */
function messageContentToText(content: AnthropicMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(contentBlockToText).filter(Boolean).join('\n');
}

/**
 * Flatten the full messages array into a single prompt string.
 *
 * Multi-turn conversations are encoded as a structured text prompt
 * that Claude can understand:
 * - User messages are included directly
 * - Assistant messages are wrapped in tags for context
 * - Tool results are formatted with structured tags
 */
function messagesToPrompt(messages: AnthropicMessage[]): string {
  if (messages.length === 0) {
    throw badRequest('messages array must not be empty');
  }

  // Single user message — just use the content directly
  if (messages.length === 1 && messages[0].role === 'user') {
    return messageContentToText(messages[0].content);
  }

  // Multi-turn: format each message with role context
  const parts: string[] = [];

  for (const msg of messages) {
    const text = messageContentToText(msg.content);
    if (msg.role === 'user') {
      parts.push(text);
    } else if (msg.role === 'assistant') {
      parts.push(`<assistant_response>\n${text}\n</assistant_response>`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Translate an Anthropic Messages API request into CLI arguments.
 */
export function translateAnthropicRequest(request: AnthropicMessagesRequest): CliArgs {
  // Validate required fields
  if (!request.model) {
    throw badRequest('model is required');
  }
  if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
    throw badRequest('messages is required and must be a non-empty array');
  }
  if (!request.max_tokens || typeof request.max_tokens !== 'number') {
    throw badRequest('max_tokens is required and must be a number');
  }

  // Build MCP config if tools are provided
  let mcpConfig: Record<string, unknown> | undefined;
  if (request.tools && request.tools.length > 0) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const bridgeScript = resolve(currentDir, '..', 'tools', 'mcp-bridge.js');
    const { mcpConfig: config } = buildMcpConfig(request.tools, bridgeScript);
    mcpConfig = config as unknown as Record<string, unknown>;
  }

  return {
    model: request.model,
    prompt: messagesToPrompt(request.messages),
    systemPrompt: extractSystemPrompt(request.system),
    effort: request.metadata?.effort,
    jsonSchema: request.metadata?.json_schema,
    mcpConfig,
    enableThinking: false, // Will be set by the route handler based on config/headers
  };
}
