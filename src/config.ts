export interface Config {
  port: number;
  host: string;
  proxyApiKeys: string[];
  requireAuth: boolean;
  claudePath: string;
  defaultModel: string;
  defaultEffort: string;
  requestTimeoutMs: number;
  logLevel: string;
  enableThinking: boolean;
}

export function loadConfig(): Config {
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
    claudePath: process.env.CLAUDE_PATH || 'claude',
    defaultModel: process.env.DEFAULT_MODEL || 'sonnet',
    defaultEffort: process.env.DEFAULT_EFFORT || 'high',
    requestTimeoutMs,
    logLevel: process.env.LOG_LEVEL || 'info',
    enableThinking: process.env.ENABLE_THINKING === 'true',
  };
}
