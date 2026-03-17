import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import type { AnthropicMessagesRequest } from '../protocol/anthropic-types.js';
import { parseJsonBody, addUnsupportedWarnings } from '../server/middleware.js';
import { translateAnthropicRequest } from '../translation/anthropic-to-cli.js';
import { buildArgs } from '../cli/args-builder.js';
import { spawnCli } from '../cli/subprocess.js';
import { cliToAnthropicSSE } from '../translation/cli-to-anthropic-stream.js';
import { collectAnthropicResponse } from '../translation/cli-to-anthropic.js';
import { badRequest } from '../util/errors.js';
import { logger } from '../util/logger.js';

export async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<void> {
  const body = await parseJsonBody(req) as unknown as AnthropicMessagesRequest;

  // Validate required fields
  if (!body.model) throw badRequest('model is required');
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw badRequest('messages is required and must be a non-empty array');
  }
  if (!body.max_tokens || typeof body.max_tokens !== 'number') {
    throw badRequest('max_tokens is required and must be a number');
  }

  // Track unsupported params
  const unsupported: string[] = [];
  if (body.temperature !== undefined) unsupported.push('temperature');
  if (body.top_p !== undefined) unsupported.push('top_p');
  if (body.top_k !== undefined) unsupported.push('top_k');
  if (body.stop_sequences !== undefined) unsupported.push('stop_sequences');
  if (body.tools !== undefined) unsupported.push('tools');
  if (body.tool_choice !== undefined) unsupported.push('tool_choice');
  if (body.metadata?.json_schema !== undefined) unsupported.push('metadata.json_schema');
  if (body.metadata?.effort !== undefined) unsupported.push('metadata.effort');

  if (unsupported.length > 0) {
    addUnsupportedWarnings(res, unsupported);
    logger.debug('Ignoring unsupported parameters', { unsupported });
  }

  // Determine thinking mode from config or beta header
  const betaHeader = req.headers['anthropic-beta'];
  const enableThinking = config.enableThinking ||
    (typeof betaHeader === 'string' && betaHeader.includes('thinking'));

  // Translate request to CLI args
  const cliArgs = translateAnthropicRequest(body);
  cliArgs.enableThinking = enableThinking;

  const { args, prompt, outputFile } = buildArgs(cliArgs, config);

  logger.debug('Spawning CLI for Anthropic request', {
    model: body.model,
    stream: body.stream,
    messageCount: body.messages.length,
  });

  const { events, kill } = spawnCli(args, prompt, config.requestTimeoutMs, outputFile);

  // Kill subprocess on client disconnect
  req.on('close', () => {
    logger.debug('Client disconnected, killing CLI process');
    kill();
  });

  if (body.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      for await (const chunk of cliToAnthropicSSE(events, enableThinking)) {
        if (!res.writable) break;
        res.write(chunk);
      }
    } catch (err) {
      logger.error('Error during Anthropic streaming', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Try to write an error event if stream is still writable
      if (res.writable) {
        const errorEvent = {
          type: 'error',
          error: {
            type: 'api_error',
            message: err instanceof Error ? err.message : 'Internal error during streaming',
          },
        };
        res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
      }
    } finally {
      kill();
      res.end();
    }
  } else {
    try {
      const result = await collectAnthropicResponse(events, enableThinking);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      kill();
      throw err;
    } finally {
      kill();
    }
  }
}
