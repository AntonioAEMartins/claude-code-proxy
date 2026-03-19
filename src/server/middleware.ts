import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import { ApiError, unauthorized } from '../util/errors.js';
import { logger } from '../util/logger.js';

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Parse JSON body from request. Returns parsed object.
 * Throws ApiError(400) on invalid JSON.
 */
export async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        reject(new ApiError(413, 'invalid_request_error', 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        reject(new ApiError(400, 'invalid_request_error', 'Request body is empty'));
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch {
        reject(new ApiError(400, 'invalid_request_error', 'Invalid JSON in request body'));
      }
    });
    req.on('error', (err) => {
      reject(new ApiError(400, 'invalid_request_error', `Request error: ${err.message}`));
    });
  });
}

/**
 * Check auth header against configured API keys.
 * Supports both "Authorization: Bearer <token>" and "x-api-key: <token>".
 */
export function checkAuth(req: IncomingMessage, config: Config): void {
  if (!config.requireAuth) return;
  if (config.proxyApiKeys.length === 0) {
    throw unauthorized('No API keys configured');
  }

  const authHeader = req.headers['authorization'];
  const xApiKey = req.headers['x-api-key'];

  let token: string | undefined;

  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      token = match[1];
    }
  }

  if (!token && typeof xApiKey === 'string') {
    token = xApiKey;
  }

  if (!token || !config.proxyApiKeys.some(key => constantTimeCompare(key, token!))) {
    throw unauthorized();
  }
}

/**
 * Set CORS headers on response.
 */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta, x-effort');
  res.setHeader('Access-Control-Expose-Headers', 'x-proxy-unsupported, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset');
}

/**
 * Detect if request is for Anthropic or OpenAI format based on path.
 */
export type ApiFormat = 'anthropic' | 'openai';

export function detectApiFormat(path: string): ApiFormat {
  if (path.startsWith('/v1/messages')) return 'anthropic';
  return 'openai';
}

/**
 * Send an error response in the appropriate format.
 */
export function sendError(res: ServerResponse, err: unknown, format: ApiFormat = 'anthropic'): void {
  if (res.headersSent) {
    // If streaming has started, we can't change the status code.
    // Try to write an error event to the stream.
    try {
      if (err instanceof ApiError) {
        const errorData = format === 'anthropic' ? err.toAnthropicError() : err.toOpenAIError();
        res.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
      }
    } catch {
      // Can't write to stream, just end it
    }
    res.end();
    return;
  }

  const apiError = err instanceof ApiError
    ? err
    : new ApiError(500, 'api_error', err instanceof Error ? err.message : 'Internal server error');

  const body = format === 'anthropic'
    ? apiError.toAnthropicError()
    : apiError.toOpenAIError();

  if (apiError.statusCode === 429 && 'resetAt' in apiError && typeof apiError.resetAt === 'string') {
    res.setHeader('x-ratelimit-reset', apiError.resetAt);
  }

  res.writeHead(apiError.statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Add warning headers for unsupported parameters.
 */
export function addUnsupportedWarnings(res: ServerResponse, params: string[]): void {
  if (params.length > 0) {
    res.setHeader('x-proxy-unsupported', params.join(', '));
  }
}
