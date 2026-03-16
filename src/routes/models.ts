import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OpenAIModelList } from '../protocol/openai-types.js';
import { getAllModels } from '../translation/model-map.js';

export function handleModels(_req: IncomingMessage, res: ServerResponse): void {
  const models = getAllModels();
  const response: OpenAIModelList = {
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: 1700000000,
      owned_by: m.owned_by,
    })),
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}
