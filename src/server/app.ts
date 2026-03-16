import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { Config } from '../config.js';
import { checkAuth, setCorsHeaders, sendError, detectApiFormat } from './middleware.js';
import { handleMessages } from '../routes/anthropic-messages.js';
import { handleChatCompletions } from '../routes/openai-chat-completions.js';
import { handleModels } from '../routes/models.js';
import { handleHealth } from '../routes/health.js';
import { logger } from '../util/logger.js';
import { notFound } from '../util/errors.js';

export function createServer(config: Config): Server {
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const startTime = Date.now();
    const method = req.method || 'GET';
    const url = req.url || '/';
    const path = url.split('?')[0];

    // Set CORS headers on all responses
    setCorsHeaders(res);

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const format = detectApiFormat(path);

    try {
      // Auth check (skip for health endpoint)
      if (path !== '/health') {
        checkAuth(req, config);
      }

      // Route dispatch
      if (method === 'POST' && path === '/v1/messages') {
        await handleMessages(req, res, config);
      } else if (method === 'POST' && path === '/v1/chat/completions') {
        await handleChatCompletions(req, res, config);
      } else if (method === 'GET' && path === '/v1/models') {
        handleModels(req, res);
      } else if (method === 'GET' && path === '/health') {
        handleHealth(req, res);
      } else {
        throw notFound(`No route for ${method} ${path}`);
      }
    } catch (err) {
      sendError(res, err, format);
    } finally {
      const duration = Date.now() - startTime;
      logger.info('Request completed', {
        method,
        path,
        status: res.statusCode,
        duration_ms: duration,
      });
    }
  });

  return server;
}
