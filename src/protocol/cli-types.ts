// ── Shared content types ──

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<TextBlock>;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ── CLI Event types ──

export interface CliSystemInit {
  type: 'system';
  subtype: 'init';
  apiKeySource: string;
  cwd: string;
  model: string;
  permissionMode: string;
  tools: string[];
  mcpServers: string[];
  session_id: string;
}

export interface CliAssistantMessage {
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: Usage;
}

export interface CliAssistant {
  type: 'assistant';
  message: CliAssistantMessage;
  session_id: string;
}

export interface CliUserMessage {
  role: 'user';
  content: ContentBlock[];
}

export interface CliUser {
  type: 'user';
  message: CliUserMessage;
  tool_use_result?: {
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  };
  session_id: string;
}

// ── Stream inner events (Anthropic streaming format) ──

export interface StreamMessageStart {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: Usage;
  };
}

export interface StreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface TextDelta {
  type: 'text_delta';
  text: string;
}

export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

export interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;
}

export interface SignatureDelta {
  type: 'signature_delta';
  signature: string;
}

export type Delta = TextDelta | ThinkingDelta | InputJsonDelta | SignatureDelta;

export interface StreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: Delta;
}

export interface StreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface StreamMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: string | null;
  };
  usage: Usage;
}

export interface StreamMessageStop {
  type: 'message_stop';
}

export type StreamInnerEvent =
  | StreamMessageStart
  | StreamContentBlockStart
  | StreamContentBlockDelta
  | StreamContentBlockStop
  | StreamMessageDelta
  | StreamMessageStop;

export interface CliStreamEvent {
  type: 'stream_event';
  event: StreamInnerEvent;
  session_id: string;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: string;
}

export interface CliRateLimitEvent {
  type: 'rate_limit_event';
  rate_limit_info: {
    status: 'allowed' | 'rate_limited';
    limit?: number;
    remaining?: number;
    reset?: string;
    type?: string;
    message?: string;
  };
  session_id: string;
}

export interface CliResultSuccess {
  type: 'result';
  subtype: 'success';
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: Usage;
}

export interface CliResultError {
  type: 'result';
  subtype: 'error';
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: true;
  result: string;
  session_id: string;
  total_cost_usd: number;
}

export type CliResult = CliResultSuccess | CliResultError;

export type CliEvent =
  | CliSystemInit
  | CliAssistant
  | CliUser
  | CliStreamEvent
  | CliRateLimitEvent
  | CliResult;
