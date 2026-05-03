import type { CliEvent } from '../protocol/cli-types.js';
import type { OpenAIChatCompletionChunk, OpenAICompletionUsage } from '../protocol/openai-types.js';
import { logger } from '../util/logger.js';
import { stripMcpToolPrefix } from '../tools/tool-translator.js';
import { makeEmptyUsage, updateUsageFromEvent } from './cli-to-openai.js';

function makeChunk(
  id: string,
  model: string,
  delta: OpenAIChatCompletionChunk['choices'][0]['delta'],
  finishReason: OpenAIChatCompletionChunk['choices'][0]['finish_reason'],
): OpenAIChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    system_fingerprint: null,
  };
}

function makeUsageChunk(
  id: string,
  model: string,
  usage: OpenAICompletionUsage,
): OpenAIChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    system_fingerprint: null,
    usage,
  };
}

/**
 * Transform CLI events into OpenAI SSE text chunks.
 * @param reverseToolMap - Optional map to translate CLI tool names back to client names
 * @param includeUsage   - When true, emit a final chunk with empty `choices` and a populated
 *                         `usage` object before `[DONE]`, per the OpenAI streaming contract for
 *                         `stream_options.include_usage: true`. The chunk is suppressed on
 *                         rate-limit errors, since those terminate the stream with an error event.
 */
export async function* cliToOpenAISSE(
  events: AsyncGenerator<CliEvent>,
  reverseToolMap?: Record<string, string>,
  includeUsage = false,
): AsyncGenerator<string> {
  let messageId = '';
  let model = '';
  let toolCallIndex = -1;
  let sentRole = false;
  let sawToolUseStop = false;
  const usage: OpenAICompletionUsage = makeEmptyUsage();

  for await (const event of events) {
    updateUsageFromEvent(usage, event);

    if (event.type !== 'stream_event') {
      if (event.type === 'system') {
        model = event.model;
      }
      if (event.type === 'result' && event.subtype === 'error') {
        logger.error('CLI error in OpenAI stream', { result: event.result });
      }
      if (event.type === 'rate_limit_event' && event.rate_limit_info.status !== 'allowed') {
        logger.warn('Rate limited by CLI', { info: event.rate_limit_info });
        const errorPayload = {
          error: {
            message: event.rate_limit_info.message || 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: '429',
            reset_at: event.rate_limit_info.reset,
          },
        };
        yield `data: ${JSON.stringify(errorPayload)}\n\n`;
        yield 'data: [DONE]\n\n';
        return;
      }
      continue;
    }

    const inner = event.event;

    switch (inner.type) {
      case 'message_start': {
        messageId = inner.message.id || `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`;
        model = inner.message.model || model;
        // Send initial role chunk
        if (!sentRole) {
          const chunk = makeChunk(messageId, model, { role: 'assistant' }, null);
          yield `data: ${JSON.stringify(chunk)}\n\n`;
          sentRole = true;
        }
        break;
      }

      case 'content_block_start': {
        const block = inner.content_block;
        if (block.type === 'tool_use') {
          toolCallIndex++;
          const chunk = makeChunk(messageId, model, {
            tool_calls: [{
              index: toolCallIndex,
              id: block.id,
              type: 'function',
              function: { name: stripMcpToolPrefix(block.name, reverseToolMap), arguments: '' },
            }],
          }, null);
          yield `data: ${JSON.stringify(chunk)}\n\n`;
        }
        // Skip thinking blocks for OpenAI format
        break;
      }

      case 'content_block_delta': {
        if (inner.delta.type === 'text_delta') {
          const chunk = makeChunk(messageId, model, {
            content: inner.delta.text,
          }, null);
          yield `data: ${JSON.stringify(chunk)}\n\n`;
        } else if (inner.delta.type === 'input_json_delta') {
          const chunk = makeChunk(messageId, model, {
            tool_calls: [{
              index: toolCallIndex,
              function: { arguments: inner.delta.partial_json },
            }],
          }, null);
          yield `data: ${JSON.stringify(chunk)}\n\n`;
        }
        // Skip thinking_delta and signature_delta for OpenAI
        break;
      }

      case 'message_delta': {
        let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';
        if (inner.delta.stop_reason === 'tool_use') {
          finishReason = 'tool_calls';
          sawToolUseStop = true;
        } else if (inner.delta.stop_reason === 'max_tokens') {
          finishReason = 'length';
        }
        const chunk = makeChunk(messageId, model, {}, finishReason);
        yield `data: ${JSON.stringify(chunk)}\n\n`;
        break;
      }

      case 'message_stop': {
        // After message_stop for a tool_use turn, emit [DONE] and stop.
        // The CLI would continue into a second turn with the MCP bridge's
        // placeholder result — that garbage must never reach the client.
        if (sawToolUseStop) {
          logger.debug('Stopping stream after tool_use turn (intercepting MCP placeholder turn)');
          if (includeUsage) {
            yield `data: ${JSON.stringify(makeUsageChunk(messageId, model, usage))}\n\n`;
          }
          yield 'data: [DONE]\n\n';
          return;
        }
        break;
      }

      case 'content_block_stop':
        break;

      default:
        break;
    }
  }

  if (includeUsage) {
    yield `data: ${JSON.stringify(makeUsageChunk(messageId, model, usage))}\n\n`;
  }
  yield 'data: [DONE]\n\n';
}
