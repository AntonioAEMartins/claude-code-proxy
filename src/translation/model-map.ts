import { badRequest } from '../util/errors.js';
import { logger } from '../util/logger.js';

const MODEL_ALIASES: Record<string, string> = {
  'codex': 'gpt-5-codex',
  'gpt-5-codex': 'gpt-5-codex',
  'gpt-5': 'gpt-5',
  'o4-mini': 'o4-mini',
  'o3': 'o3',
};

/**
 * Prefixes that are stripped before model alias lookup.
 * Allows clients like OpenClaw to send e.g. "claude-code-cli/opus".
 */
const STRIP_PREFIXES = ['claude-code-cli/', 'openai/', 'codex/'];

// Map CLI model names back to full Anthropic model IDs for responses
const CLI_TO_API_MODEL: Record<string, string> = {
  'gpt-5-codex': 'gpt-5-codex',
  'gpt-5': 'gpt-5',
  'o4-mini': 'o4-mini',
  'o3': 'o3',
};

// Effort level constraints per model
const EFFORT_BY_MODEL: Record<string, string[]> = {
  'gpt-5-codex': ['low', 'medium', 'high'],
  'gpt-5': ['low', 'medium', 'high'],
  'o4-mini': ['low', 'medium', 'high'],
  'o3': ['low', 'medium', 'high'],
};

/**
 * Strip known prefixes from model names.
 * E.g. "claude-code-cli/opus" → "opus", "openai/gpt-4.1" → "gpt-4.1"
 */
function stripModelPrefix(model: string): string {
  for (const prefix of STRIP_PREFIXES) {
    if (model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }
  return model;
}

export function toCliModel(model: string, defaultCliModel?: string): string {
  const stripped = stripModelPrefix(model);
  const normalized = MODEL_ALIASES[stripped];
  if (normalized) return normalized;

  if (stripped) return stripped;

  // Unknown model — fall back to default if provided
  if (defaultCliModel) {
    const fallback = MODEL_ALIASES[defaultCliModel] || defaultCliModel;
    logger.warn(`Unknown model "${model}", falling back to "${fallback}"`);
    return fallback;
  }

  throw badRequest(`Unknown model: ${model}. Supported models: ${Object.keys(MODEL_ALIASES).join(', ')}`);
}

export function toApiModel(cliModel: string): string {
  return CLI_TO_API_MODEL[cliModel] || cliModel;
}

export function validateEffort(model: string, effort: string | undefined, defaultEffort: string): string | null {
  const stripped = stripModelPrefix(model);
  const cliModel = MODEL_ALIASES[stripped] || stripped;
  const allowed = EFFORT_BY_MODEL[cliModel];

  if (!allowed || allowed.length === 0) {
    return null; // Model doesn't support effort
  }

  const effectiveEffort = effort || defaultEffort;

  if (!allowed.includes(effectiveEffort)) {
    if (!effort) {
      // Default effort not valid for this model; use model's highest supported
      return allowed[allowed.length - 1];
    }
    throw badRequest(
      `Effort level "${effort}" is not supported for model "${model}". Supported: ${allowed.join(', ')}`
    );
  }

  return effectiveEffort;
}

export function getAllModels(): Array<{ id: string; owned_by: string }> {
  return [
    { id: 'gpt-5-codex', owned_by: 'openai' },
    { id: 'gpt-5', owned_by: 'openai' },
    { id: 'o4-mini', owned_by: 'openai' },
    { id: 'o3', owned_by: 'openai' },
  ];
}
