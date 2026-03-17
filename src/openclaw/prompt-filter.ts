/**
 * Filter OpenClaw-injected tooling sections from system prompts.
 *
 * OpenClaw injects tool definitions and skill blocks into system prompts.
 * These conflict with the CLI's own MCP-based tool system, causing the model
 * to see duplicate (and sometimes contradictory) tool descriptions.
 *
 * This filter auto-detects and strips known OpenClaw patterns while
 * preserving the rest of the user's system prompt.
 */

/**
 * Patterns that identify OpenClaw-injected sections to strip.
 * Each pattern matches a complete section including its boundaries.
 */
const STRIP_PATTERNS: RegExp[] = [
  // XML-tagged tool blocks
  /<tools>[\s\S]*?<\/tools>/g,
  /<available[-_]tools>[\s\S]*?<\/available[-_]tools>/g,
  /<tool[-_]definitions>[\s\S]*?<\/tool[-_]definitions>/g,
  /<system[-_]tools>[\s\S]*?<\/system[-_]tools>/g,

  // Skill blocks
  /<skills>[\s\S]*?<\/skills>/g,
  /<available[-_]skills>[\s\S]*?<\/available[-_]skills>/g,

  // Tool use instruction blocks
  /<tool[-_]use[-_]instructions>[\s\S]*?<\/tool[-_]use[-_]instructions>/g,

  // Function definition blocks (common in OpenAI-style system prompts)
  /<functions>[\s\S]*?<\/functions>/g,
];

/**
 * Strip OpenClaw-injected tooling sections from a system prompt.
 * Returns the cleaned prompt with excess whitespace normalized.
 */
export function stripToolingSections(prompt: string): string {
  let result = prompt;
  for (const pattern of STRIP_PATTERNS) {
    result = result.replace(pattern, '');
  }
  // Normalize excess whitespace left by removed sections
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Detect whether a system prompt contains OpenClaw-injected tooling sections.
 */
export function hasToolingSections(prompt: string): boolean {
  return STRIP_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(prompt);
  });
}
