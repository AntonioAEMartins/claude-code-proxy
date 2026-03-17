import { Readable } from 'node:stream';
import type { CliEvent } from '../protocol/cli-types.js';
import { logger } from '../util/logger.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const LOG_RAW_CODEX_EVENTS = process.env.CODEX_DEBUG_RAW_EVENTS === 'true';

interface CodexUsageLike {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface ParserState {
  sessionId: string;
  model: string;
  messageId: string;
  started: boolean;
  contentStarted: boolean;
  completed: boolean;
  sawText: boolean;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function createState(): ParserState {
  return {
    sessionId: `codex_${crypto.randomUUID().replace(/-/g, '')}`,
    model: 'gpt-5-codex',
    messageId: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
    started: false,
    contentStarted: false,
    completed: false,
    sawText: false,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join('') : undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  const directTextKeys = ['text', 'delta', 'content', 'message', 'formatted_output', 'last_agent_message'];
  for (const key of directTextKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  const nestedCandidates = [
    record.item,
    record.message,
    record.content,
    record.delta,
    record.last_agent_message,
  ];
  for (const candidate of nestedCandidates) {
    const text = extractText(candidate);
    if (text) return text;
  }

  return undefined;
}

function extractUsage(event: Record<string, unknown>): CodexUsageLike | undefined {
  const candidates = [event.usage, event.token_usage, event.last_token_usage, event.token_count];

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) continue;

    const input = typeof record.input_tokens === 'number' ? record.input_tokens : undefined;
    const output = typeof record.output_tokens === 'number' ? record.output_tokens : undefined;
    const cached = typeof record.cached_input_tokens === 'number' ? record.cached_input_tokens : undefined;
    const total = typeof record.total_tokens === 'number' ? record.total_tokens : undefined;

    if (input !== undefined || output !== undefined || cached !== undefined || total !== undefined) {
      return {
        input_tokens: input,
        output_tokens: output,
        cached_input_tokens: cached,
        total_tokens: total,
      };
    }
  }

  return undefined;
}

function updateUsage(state: ParserState, event: Record<string, unknown>): void {
  const usage = extractUsage(event);
  if (!usage) return;
  if (typeof usage.input_tokens === 'number') state.usage.input_tokens = usage.input_tokens;
  if (typeof usage.output_tokens === 'number') state.usage.output_tokens = usage.output_tokens;
  if (typeof usage.cached_input_tokens === 'number') {
    state.usage.cache_read_input_tokens = usage.cached_input_tokens;
  }
}

function extractModel(event: Record<string, unknown>): string | undefined {
  const direct = ['model', 'model_id', 'from_model', 'to_model'];
  for (const key of direct) {
    if (typeof event[key] === 'string' && event[key]) {
      return event[key] as string;
    }
  }

  const sessionMeta = asRecord(event.session_meta);
  if (sessionMeta && typeof sessionMeta.model === 'string') {
    return sessionMeta.model;
  }

  return undefined;
}

function ensureMessageStarted(state: ParserState): CliEvent[] {
  const events: CliEvent[] = [];

  if (!state.started) {
    events.push({
      type: 'system',
      subtype: 'init',
      apiKeySource: 'codex',
      cwd: process.cwd(),
      model: state.model,
      permissionMode: 'full-auto',
      tools: [],
      mcpServers: [],
      session_id: state.sessionId,
    });

    events.push({
      type: 'stream_event',
      session_id: state.sessionId,
      event: {
        type: 'message_start',
        message: {
          id: state.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: state.model,
          stop_reason: null,
          stop_sequence: null,
          usage: state.usage,
        },
      },
    });

    state.started = true;
  }

  if (!state.contentStarted) {
    events.push({
      type: 'stream_event',
      session_id: state.sessionId,
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: '',
        },
      },
    });
    state.contentStarted = true;
  }

  return events;
}

function buildTextDeltaEvents(state: ParserState, text: string): CliEvent[] {
  if (!text) return [];
  state.sawText = true;

  return [
    ...ensureMessageStarted(state),
    {
      type: 'stream_event',
      session_id: state.sessionId,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text,
        },
      },
    },
  ];
}

function readOutputFallback(outputFile?: string): string | undefined {
  if (!outputFile || !existsSync(outputFile)) return undefined;

  try {
    const finalText = readFileSync(outputFile, 'utf-8').trim();
    return finalText || undefined;
  } catch (err) {
    logger.warn('Failed to read Codex output-last-message fallback', {
      outputFile,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

function completeMessage(state: ParserState, stopReason: string = 'end_turn'): CliEvent[] {
  if (state.completed || !state.started) return [];

  state.completed = true;

  const events: CliEvent[] = [];
  if (state.contentStarted) {
    events.push({
      type: 'stream_event',
      session_id: state.sessionId,
      event: {
        type: 'content_block_stop',
        index: 0,
      },
    });
  }

  events.push({
    type: 'stream_event',
    session_id: state.sessionId,
    event: {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: state.usage,
    },
  });

  events.push({
    type: 'stream_event',
    session_id: state.sessionId,
    event: {
      type: 'message_stop',
    },
  });

  events.push({
    type: 'result',
    subtype: 'success',
    cost_usd: 0,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    result: 'success',
    session_id: state.sessionId,
    total_cost_usd: 0,
    usage: state.usage,
  });

  return events;
}

function errorResult(state: ParserState, message: string): CliEvent {
  return {
    type: 'result',
    subtype: 'error',
    cost_usd: 0,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    result: message,
    session_id: state.sessionId,
    total_cost_usd: 0,
  };
}

function parseCodexLine(line: string, state: ParserState, outputFile?: string): CliEvent[] {
  if (LOG_RAW_CODEX_EVENTS) {
    logger.debug('Raw Codex event', {
      line,
    });
  }

  const parsed = JSON.parse(line) as Record<string, unknown>;
  const type = typeof parsed.type === 'string' ? parsed.type : undefined;

  const model = extractModel(parsed);
  if (model) state.model = model;
  updateUsage(state, parsed);

  if (!type) return [];

  const normalizedType = type.replace(/\./g, '_');

  switch (normalizedType) {
    case 'thread_started':
    case 'session_configured':
    case 'task_started':
      return ensureMessageStarted(state);

    case 'item_completed': {
      const item = asRecord(parsed.item);
      const itemType = typeof item?.type === 'string' ? item.type : undefined;

      if (itemType === 'agent_message') {
        const text = extractText(item);
        return text ? buildTextDeltaEvents(state, text) : [];
      }

      return [];
    }

    case 'agent_message':
    case 'agent_message_delta':
    case 'agent_message_content_delta': {
      const text = extractText(parsed);
      return text ? buildTextDeltaEvents(state, text) : [];
    }

    case 'raw_response_item': {
      const text = extractText(parsed);
      return text ? buildTextDeltaEvents(state, text) : [];
    }

    case 'token_count':
      return [];

    case 'turn_completed':
    case 'turn_complete': {
      const text = extractText(parsed.last_agent_message) || (!state.sawText ? readOutputFallback(outputFile) : undefined);
      const events = text && !state.contentStarted ? buildTextDeltaEvents(state, text) : [];
      return [...events, ...completeMessage(state)];
    }

    case 'turn_aborted':
    case 'stream_error':
    case 'error': {
      const text = extractText(parsed) || 'Codex execution failed';
      return [errorResult(state, text)];
    }

    default:
      return [];
  }
}

export async function* parseCliStream(stdout: Readable, outputFile?: string): AsyncGenerator<CliEvent> {
  let buffer = '';
  const state = createState();
  let sawError = false;

  for await (const chunk of stdout) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        for (const event of parseCodexLine(trimmed, state, outputFile)) {
          if (event.type === 'result' && event.subtype === 'error') {
            sawError = true;
            state.completed = true;
          }
          yield event;
        }
      } catch (err) {
        logger.warn('Failed to parse CLI output line', {
          line: trimmed.slice(0, 200),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Process any remaining data in the buffer
  if (buffer.trim()) {
    try {
      for (const event of parseCodexLine(buffer.trim(), state, outputFile)) {
        if (event.type === 'result' && event.subtype === 'error') {
          sawError = true;
          state.completed = true;
        }
        yield event;
      }
    } catch (err) {
      logger.warn('Failed to parse final CLI buffer', {
        buffer: buffer.trim().slice(0, 200),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!sawError && state.started && !state.completed) {
    if (!state.sawText) {
      const finalText = readOutputFallback(outputFile);
      if (finalText) {
        yield* buildTextDeltaEvents(state, finalText);
      }
    }

    yield* completeMessage(state);
  }

  if (outputFile) {
    try {
      rmSync(dirname(outputFile), { recursive: true, force: true });
    } catch (err) {
      logger.warn('Failed to cleanup Codex output temp dir', {
        outputFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
