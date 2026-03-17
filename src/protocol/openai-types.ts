// ── Request types ──

export interface OpenAIFunctionDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenAIToolDef {
  type: 'function';
  function: OpenAIFunctionDef;
}

export interface OpenAITextContent {
  type: 'text';
  text: string;
}

export interface OpenAIImageUrl {
  url: string;
  detail?: 'auto' | 'low' | 'high';
}

export interface OpenAIImageContent {
  type: 'image_url';
  image_url: OpenAIImageUrl;
}

/** OpenClaw/OpenAI Responses API `input_text` content block — treated as plain text. */
export interface OpenAIInputTextContent {
  type: 'input_text';
  text: string;
}

export type OpenAIContentPart = OpenAITextContent | OpenAIImageContent | OpenAIInputTextContent;

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolChoiceFunction {
  type: 'function';
  function: { name: string };
}

export type OpenAIToolChoice = 'none' | 'auto' | 'required' | OpenAIToolChoiceFunction;

export interface OpenAIResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: OpenAIToolDef[];
  tool_choice?: OpenAIToolChoice;
  response_format?: OpenAIResponseFormat;
}

// ── Response types ──

export interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

export interface OpenAICompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAICompletionUsage;
  system_fingerprint: string | null;
}

// ── Streaming types ──

export interface OpenAIStreamDelta {
  role?: 'assistant';
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIStreamDelta;
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

export interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  system_fingerprint: string | null;
}

// ── Models endpoint ──

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  object: 'list';
  data: OpenAIModel[];
}
