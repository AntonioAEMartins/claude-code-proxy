import { badRequest } from '../util/errors.js';

/**
 * Prefixes that are stripped before model family lookup.
 * Allows clients like OpenClaw to send e.g. "claude-code-cli/opus".
 */
const STRIP_PREFIXES = ['claude-code-cli/', 'openai/'];
const FAMILY_REGEX = /^(?:claude-)?(opus|sonnet|haiku)(?:[-/].*)?$/i;

// Effort level constraints per model family
const EFFORT_BY_MODEL: Record<string, string[]> = {
  opus: ['low', 'medium', 'high', 'max'],
  sonnet: ['low', 'medium', 'high'],
  haiku: [], // No effort support
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

function resolveFamily(model: string): 'opus' | 'sonnet' | 'haiku' | null {
  const match = FAMILY_REGEX.exec(model);
  return match ? (match[1].toLowerCase() as 'opus' | 'sonnet' | 'haiku') : null;
}

export function toCliModel(model: string): string {
  const stripped = stripModelPrefix(model);
  const family = resolveFamily(stripped);
  if (family) {
    return family;
  }

  throw badRequest(
    `Unknown model: "${model}". Supported families: opus, sonnet, haiku ` +
    `(e.g. "opus", "claude-opus-4-7", "sonnet", "haiku-4-5").`
  );
}

export function validateEffort(model: string, effort: string | undefined, defaultEffort: string): string | null {
  const stripped = stripModelPrefix(model);
  const family = resolveFamily(stripped);
  const allowed = family ? EFFORT_BY_MODEL[family] : undefined;

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
    { id: 'claude-opus-4-6', owned_by: 'anthropic' },
    { id: 'claude-sonnet-4-6', owned_by: 'anthropic' },
    { id: 'claude-haiku-4-5', owned_by: 'anthropic' },
  ];
}
