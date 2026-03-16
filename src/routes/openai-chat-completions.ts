import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import type { OpenAIChatCompletionRequest, OpenAIChatMessage } from '../protocol/openai-types.js';
import type { AnthropicMessagesRequest, AnthropicMessage, AnthropicContentBlock, AnthropicToolDefinition, AnthropicToolChoice } from '../protocol/anthropic-types.js';
import { parseJsonBody, addUnsupportedWarnings } from '../server/middleware.js';
import { translateAnthropicRequest } from '../translation/anthropic-to-cli.js';
import { buildArgs } from '../cli/args-builder.js';
import { spawnCli } from '../cli/subprocess.js';
import { cliToOpenAISSE } from '../translation/cli-to-openai-stream.js';
import { collectOpenAIResponse } from '../translation/cli-to-openai.js';
import { badRequest } from '../util/errors.js';
import { logger } from '../util/logger.js';

/**
 * Convert OpenAI messages to Anthropic format.
 * System messages become the top-level system field.
 */
function convertMessages(messages: OpenAIChatMessage[]): {
  system?: string;
  anthropicMessages: AnthropicMessage[];
} {
  let system: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Collect system messages
      const text = typeof msg.content === 'string' ? msg.content :
        Array.isArray(msg.content) ? msg.content.filter(p => p.type === 'text').map(p => ('text' in p ? p.text : '')).join('\n') : '';
      system = system ? `${system}\n\n${text}` : text;
    } else if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content :
        Array.isArray(msg.content) ? msg.content.map(part => {
          if (part.type === 'text') return { type: 'text' as const, text: part.text };
          return { type: 'text' as const, text: '[Unsupported content type]' };
        }) : '';
      anthropicMessages.push({ role: 'user', content });
    } else if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) {
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content.filter(p => p.type === 'text').map(p => 'text' in p ? p.text : '').join('');
        }
        if (text) blocks.push({ type: 'text', text });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let parsedInput: Record<string, unknown>;
          try {
            parsedInput = JSON.parse(tc.function.arguments || '{}');
          } catch {
            parsedInput = {};
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
      }
      anthropicMessages.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : (msg.content as string) || '',
      });
    } else if (msg.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id || '',
          content: typeof msg.content === 'string' ? msg.content : '',
        }],
      });
    }
  }

  return { system, anthropicMessages };
}

/**
 * Convert OpenAI tool definitions to Anthropic format.
 */
function convertTools(tools?: OpenAIChatCompletionRequest['tools']): AnthropicToolDefinition[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: 'object', properties: {} },
  }));
}

/**
 * Convert OpenAI tool_choice to Anthropic format.
 */
function convertToolChoice(choice?: OpenAIChatCompletionRequest['tool_choice']): AnthropicToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  if (choice === 'none') return undefined;
  if (typeof choice === 'object' && choice.type === 'function') {
    return { type: 'tool', name: choice.function.name };
  }
  return undefined;
}

export async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<void> {
  const body = await parseJsonBody(req) as unknown as OpenAIChatCompletionRequest;

  if (!body.model) throw badRequest('model is required');
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw badRequest('messages is required and must be a non-empty array');
  }

  // Track unsupported params
  const unsupported: string[] = [];
  if (body.temperature !== undefined) unsupported.push('temperature');
  if (body.top_p !== undefined) unsupported.push('top_p');
  if (body.frequency_penalty !== undefined) unsupported.push('frequency_penalty');
  if (body.presence_penalty !== undefined) unsupported.push('presence_penalty');
  if (body.n !== undefined && body.n > 1) unsupported.push('n');
  if (body.stop !== undefined) unsupported.push('stop');

  if (unsupported.length > 0) {
    addUnsupportedWarnings(res, unsupported);
  }

  // Convert OpenAI format to Anthropic format
  const { system, anthropicMessages } = convertMessages(body.messages);
  const tools = convertTools(body.tools);
  const toolChoice = convertToolChoice(body.tool_choice);

  // Get effort from custom header
  const effortHeader = req.headers['x-effort'];
  const effort = typeof effortHeader === 'string' ? effortHeader : undefined;

  // Build Anthropic-format request for the translation pipeline
  const anthropicRequest: AnthropicMessagesRequest = {
    model: body.model,
    messages: anthropicMessages,
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
    system,
    tools,
    tool_choice: toolChoice,
    metadata: { effort },
  };

  // Handle response_format for structured output
  if (body.response_format?.type === 'json_schema' && body.response_format.json_schema) {
    anthropicRequest.metadata = {
      ...anthropicRequest.metadata,
      json_schema: body.response_format.json_schema.schema,
    };
  }

  const cliArgs = translateAnthropicRequest(anthropicRequest);
  const { args, prompt } = buildArgs(cliArgs, config);

  logger.debug('Spawning CLI for OpenAI request', {
    model: body.model,
    stream: body.stream,
    messageCount: body.messages.length,
  });

  const { events, kill } = spawnCli(args, prompt, config.requestTimeoutMs);

  req.on('close', () => {
    logger.debug('Client disconnected, killing CLI process');
    kill();
  });

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      for await (const chunk of cliToOpenAISSE(events)) {
        if (!res.writable) break;
        res.write(chunk);
      }
    } catch (err) {
      logger.error('Error during OpenAI streaming', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      kill();
      res.end();
    }
  } else {
    try {
      const result = await collectOpenAIResponse(events);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      kill();
      throw err;
    } finally {
      kill();
    }
  }
}
