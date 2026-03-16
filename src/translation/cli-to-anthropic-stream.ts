import type { CliEvent, StreamInnerEvent } from '../protocol/cli-types.js';
import { logger } from '../util/logger.js';
import { stripMcpToolPrefix } from '../tools/tool-translator.js';

function formatSSE(event: StreamInnerEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Transform CLI events into Anthropic SSE text chunks.
 * The CLI stream_event messages already contain Anthropic-format inner events,
 * so this is mostly pass-through with filtering.
 */
export async function* cliToAnthropicSSE(
  events: AsyncGenerator<CliEvent>,
  enableThinking: boolean,
): AsyncGenerator<string> {
  const filteredIndices = new Set<number>();
  let sawToolUseStop = false;

  for await (const event of events) {
    switch (event.type) {
      case 'stream_event': {
        const inner = event.event;

        // Strip MCP prefix from tool_use block names
        if (
          inner.type === 'content_block_start' &&
          inner.content_block.type === 'tool_use'
        ) {
          inner.content_block.name = stripMcpToolPrefix(inner.content_block.name);
        }

        // Track tool_use stop reason for multi-turn interception
        if (inner.type === 'message_delta' && inner.delta.stop_reason === 'tool_use') {
          sawToolUseStop = true;
        }

        // Filter thinking blocks if not enabled
        if (!enableThinking) {
          if (
            inner.type === 'content_block_start' &&
            'type' in inner.content_block &&
            inner.content_block.type === 'thinking'
          ) {
            filteredIndices.add(inner.index);
            continue;
          }
          if (
            inner.type === 'content_block_delta' &&
            'type' in inner.delta &&
            (inner.delta.type === 'thinking_delta' || inner.delta.type === 'signature_delta')
          ) {
            continue;
          }
        }

        if (inner.type === 'content_block_stop' && filteredIndices.has(inner.index)) {
          filteredIndices.delete(inner.index);
          continue;
        }

        yield formatSSE(inner);

        // After yielding message_stop for a tool_use turn, stop the stream.
        // The CLI would continue into a second turn with the MCP bridge's
        // placeholder result — that garbage must never reach the client.
        if (inner.type === 'message_stop' && sawToolUseStop) {
          logger.debug('Stopping stream after tool_use turn (intercepting MCP placeholder turn)');
          return;
        }

        break;
      }

      case 'result': {
        if (event.subtype === 'error') {
          logger.error('CLI returned error result', { result: event.result });
        }
        // The message_stop event is emitted by stream_event before the result event,
        // so we don't need to emit anything extra here.
        break;
      }

      case 'rate_limit_event': {
        if (event.rate_limit_info.status !== 'allowed') {
          logger.warn('Rate limited by CLI', { info: event.rate_limit_info });
          // Emit an error event in the stream
          const errorEvent = {
            type: 'error' as const,
            error: {
              type: 'rate_limit_error',
              message: event.rate_limit_info.message || 'Rate limit exceeded',
            },
          };
          yield `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`;
        }
        break;
      }

      case 'system':
        logger.debug('CLI system init', { model: event.model });
        break;

      case 'assistant':
        // Full assistant message — in streaming mode we already get this via stream_events
        break;

      case 'user':
        // Tool result round-trip — shouldn't happen in single-turn mode
        break;

      default:
        logger.debug('Unknown CLI event type', { event });
    }
  }
}
