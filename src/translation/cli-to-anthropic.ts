import type { CliEvent } from '../protocol/cli-types.js';
import type { AnthropicMessagesResponse, AnthropicResponseContentBlock, AnthropicUsage } from '../protocol/anthropic-types.js';
import { logger } from '../util/logger.js';
import { serverError, rateLimited } from '../util/errors.js';
import { stripMcpToolPrefix } from '../tools/tool-translator.js';

/**
 * Collect all CLI events and build a non-streaming Anthropic Messages response.
 */
export async function collectAnthropicResponse(
  events: AsyncGenerator<CliEvent>,
  enableThinking: boolean,
): Promise<AnthropicMessagesResponse> {
  let messageId = '';
  let model = '';
  let stopReason: AnthropicMessagesResponse['stop_reason'] = null;
  let stopSequence: string | null = null;
  const contentBlocks: AnthropicResponseContentBlock[] = [];
  let usage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };
  let hasResult = false;
  let sawToolUseStop = false;
  // Track partial JSON accumulation for tool_use blocks by index
  const partialJsonByIndex = new Map<number, string>();

  eventLoop: for await (const event of events) {
    switch (event.type) {
      case 'stream_event': {
        const inner = event.event;

        if (inner.type === 'message_start') {
          messageId = inner.message.id;
          model = inner.message.model;
          usage = {
            input_tokens: inner.message.usage.input_tokens,
            output_tokens: inner.message.usage.output_tokens,
          };
        }

        if (inner.type === 'content_block_start') {
          const block = inner.content_block;
          if (block.type === 'thinking' && !enableThinking) continue;
          // Initialize the block — will be filled by deltas
          if (block.type === 'text') {
            contentBlocks[inner.index] = { type: 'text', text: '' };
          } else if (block.type === 'tool_use') {
            contentBlocks[inner.index] = {
              type: 'tool_use',
              id: block.id,
              name: stripMcpToolPrefix(block.name),
              input: {},
            };
          } else if (block.type === 'thinking' && enableThinking) {
            contentBlocks[inner.index] = {
              type: 'thinking',
              thinking: '',
              signature: '',
            };
          }
        }

        if (inner.type === 'content_block_delta') {
          const block = contentBlocks[inner.index];
          if (!block) continue; // Filtered thinking block

          if (inner.delta.type === 'text_delta' && block.type === 'text') {
            block.text += inner.delta.text;
          } else if (inner.delta.type === 'input_json_delta' && block.type === 'tool_use') {
            const existing = partialJsonByIndex.get(inner.index) || '';
            partialJsonByIndex.set(inner.index, existing + inner.delta.partial_json);
          } else if (inner.delta.type === 'thinking_delta' && block.type === 'thinking') {
            block.thinking += inner.delta.thinking;
          } else if (inner.delta.type === 'signature_delta' && block.type === 'thinking') {
            block.signature += inner.delta.signature;
          }
        }

        if (inner.type === 'content_block_stop') {
          const block = contentBlocks[inner.index];
          if (!block) continue;

          // Parse accumulated JSON for tool_use blocks
          const partialJson = partialJsonByIndex.get(inner.index);
          if (block.type === 'tool_use' && partialJson) {
            try {
              block.input = JSON.parse(partialJson);
            } catch {
              logger.warn('Failed to parse tool input JSON', { partialJson });
              block.input = {};
            }
            partialJsonByIndex.delete(inner.index);
          }
        }

        if (inner.type === 'message_delta') {
          stopReason = inner.delta.stop_reason as AnthropicMessagesResponse['stop_reason'];
          stopSequence = inner.delta.stop_sequence;
          if (inner.usage) {
            usage.output_tokens = inner.usage.output_tokens;
          }
          if (stopReason === 'tool_use') {
            sawToolUseStop = true;
          }
        }

        // After message_stop for a tool_use turn, stop consuming events.
        // The CLI would continue into a second turn with the MCP bridge's
        // placeholder result — that garbage must never reach the client.
        if (inner.type === 'message_stop' && sawToolUseStop) {
          logger.debug('Stopping event collection after tool_use turn (intercepting MCP placeholder turn)');
          break eventLoop;
        }

        break;
      }

      case 'result': {
        hasResult = true;
        if (event.subtype === 'error') {
          throw serverError(event.result || 'CLI returned an error');
        }
        // Update usage from result if available
        if (event.subtype === 'success' && event.usage) {
          usage.input_tokens = event.usage.input_tokens;
          usage.output_tokens = event.usage.output_tokens;
        }
        break;
      }

      case 'rate_limit_event': {
        if (event.rate_limit_info.status !== 'allowed') {
          throw rateLimited(
            event.rate_limit_info.message || 'Rate limit exceeded',
          );
        }
        break;
      }

      case 'system':
        model = event.model;
        break;

      default:
        break;
    }
  }

  if (!hasResult && contentBlocks.length === 0) {
    throw serverError('CLI process ended without producing any output');
  }

  // Filter out undefined entries (from skipped thinking blocks)
  const filteredContent = contentBlocks.filter((b): b is AnthropicResponseContentBlock => b != null);

  return {
    id: messageId || `msg_${crypto.randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    content: filteredContent,
    model: model || 'unknown',
    stop_reason: stopReason || 'end_turn',
    stop_sequence: stopSequence,
    usage,
  };
}
