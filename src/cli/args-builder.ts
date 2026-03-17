import type { Config } from '../config.js';
import { toCliModel } from '../translation/model-map.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CliArgs {
  /** The system prompt, if any */
  systemPrompt?: string;
  /** The model to use (API format, will be converted) */
  model: string;
  /** The effort level */
  effort?: string;
  /** The prompt text (all messages flattened) */
  prompt: string;
  /** JSON schema for structured output */
  jsonSchema?: Record<string, unknown>;
  /** MCP config JSON for tool use */
  mcpConfig?: Record<string, unknown>;
  /** Whether to enable thinking */
  enableThinking: boolean;
}

export interface BuiltCliCommand {
  args: string[];
  prompt: string;
  outputFile: string;
}

export function buildArgs(cliArgs: CliArgs, config: Config): BuiltCliCommand {
  const cliModel = toCliModel(cliArgs.model, config.defaultModel);
  const outputDir = mkdtempSync(join(tmpdir(), 'codex-proxy-'));
  const outputFile = join(outputDir, 'last-message.txt');

  const args: string[] = [
    config.codexPath,
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '--ephemeral',
    '--model', cliModel,
    '--output-last-message', outputFile,
    '-',
  ];

  // Inject the system prompt into the user prompt because codex exec does not
  // expose a dedicated system prompt flag.
  if (cliArgs.systemPrompt) {
    cliArgs.prompt = [
      '<system>',
      cliArgs.systemPrompt,
      '</system>',
      '',
      cliArgs.prompt,
    ].join('\n');
  }

  // Client-defined tools, effort overrides, and JSON schema output are
  // currently ignored. Codex still has access to its own native toolchain when
  // running in full-auto mode.
  return { args, prompt: cliArgs.prompt, outputFile };
}
