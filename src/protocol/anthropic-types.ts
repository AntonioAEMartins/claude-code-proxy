// ── Request types ──

export interface AnthropicTextContent {
  type: 'text';
  text: string;
}

export interface AnthropicImageSource {
  type: 'base64';
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
}

export interface AnthropicImageContent {
  type: 'image';
  source: AnthropicImageSource;
}

export interface AnthropicToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | AnthropicTextContent[];
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextContent
  | AnthropicImageContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicToolChoiceAuto {
  type: 'auto';
}

export interface AnthropicToolChoiceAny {
  type: 'any';
}

export interface AnthropicToolChoiceTool {
  type: 'tool';
  name: string;
}

export type AnthropicToolChoice =
  | AnthropicToolChoiceAuto
  | AnthropicToolChoiceAny
  | AnthropicToolChoiceTool;

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string | AnthropicSystemBlock[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice;
  metadata?: {
    user_id?: string;
    effort?: string;
    json_schema?: Record<string, unknown>;
  };
}

// ── Response types ──

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface AnthropicTextResponseBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseResponseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicResponseContentBlock =
  | AnthropicThinkingBlock
  | AnthropicTextResponseBlock
  | AnthropicToolUseResponseBlock;

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicResponseContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

// ── SSE event types ──

export interface AnthropicSSEMessageStart {
  type: 'message_start';
  message: AnthropicMessagesResponse;
}

export interface AnthropicSSEContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicResponseContentBlock;
}

export interface AnthropicSSEContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
  };
}

export interface AnthropicSSEContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface AnthropicSSEMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: string | null;
  };
  usage: AnthropicUsage;
}

export interface AnthropicSSEMessageStop {
  type: 'message_stop';
}

export type AnthropicSSEEvent =
  | AnthropicSSEMessageStart
  | AnthropicSSEContentBlockStart
  | AnthropicSSEContentBlockDelta
  | AnthropicSSEContentBlockStop
  | AnthropicSSEMessageDelta
  | AnthropicSSEMessageStop;
