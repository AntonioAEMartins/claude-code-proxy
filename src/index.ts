#!/usr/bin/env node
import { createServer } from './server/app.js';
import { loadConfig } from './config.js';
import { setLogLevel, logger } from './util/logger.js';
import { spawnSync } from 'node:child_process';

function verifyClaude(claudePath: string): void {
  const result = spawnSync(claudePath, ['--version'], {
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      logger.error(`Claude CLI not found at "${claudePath}". Install it or set CLAUDE_PATH.`);
    } else {
      logger.error(`Failed to verify Claude CLI: ${result.error.message}`);
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    logger.error(`Claude CLI exited with code ${result.status}`);
    process.exit(1);
  }

  const version = result.stdout?.toString().trim();
  logger.info('Claude CLI verified', { version, path: claudePath });
}

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info('Starting Claude Code Proxy', {
    port: config.port,
    host: config.host,
    defaultModel: config.defaultModel,
    requireAuth: config.requireAuth,
    enableThinking: config.enableThinking,
  });

  verifyClaude(config.claudePath);

  const server = createServer(config);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Kill it with: lsof -ti :${config.port} | xargs kill -9`);
    } else {
      logger.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info(`Proxy listening on http://${config.host}:${config.port}`);
  });

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info('Shutting down...');
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    // Force close after 10 seconds
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
