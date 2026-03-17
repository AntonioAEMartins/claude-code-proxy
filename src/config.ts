import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  proxyApiKeys: string[];
  requireAuth: boolean;
  codexPath: string;
  defaultModel: string;
  defaultEffort: string;
  requestTimeoutMs: number;
  logLevel: string;
  enableThinking: boolean;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = stripQuotes(rawValue);
  }
}

export function loadConfig(): Config {
  loadEnvFile();

  const keys = process.env.PROXY_API_KEYS?.split(',').map(k => k.trim()).filter(Boolean) ?? [];

  const port = parseInt(process.env.PORT || '4523', 10);
  if (isNaN(port)) {
    throw new Error(`Invalid PORT value: "${process.env.PORT}" is not a valid number`);
  }

  const requestTimeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS || '300000', 10);
  if (isNaN(requestTimeoutMs)) {
    throw new Error(`Invalid REQUEST_TIMEOUT_MS value: "${process.env.REQUEST_TIMEOUT_MS}" is not a valid number`);
  }

  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    proxyApiKeys: keys,
    requireAuth: process.env.REQUIRE_AUTH !== 'false',
    codexPath: process.env.CODEX_PATH || process.env.CLAUDE_PATH || 'codex',
    defaultModel: process.env.DEFAULT_MODEL || 'gpt-5-codex',
    defaultEffort: process.env.DEFAULT_EFFORT || 'medium',
    requestTimeoutMs,
    logLevel: process.env.LOG_LEVEL || 'info',
    enableThinking: process.env.ENABLE_THINKING === 'true',
  };
}
