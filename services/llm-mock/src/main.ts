import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { loggerOptions } from '@raadi/service-kit/logger';
import { pino } from 'pino';
import {
  type ChatRequest,
  chatCompletion,
  chatStream,
  embeddings,
  models,
  RequestLog,
  scenarioOf,
} from './llm.js';

const log = pino(loggerOptions('llm-mock'));
const requests = new RequestLog();
const port = Number(process.env.PORT ?? 4000);
const MAX_BODY = 2_000_000;
/** How long the "timeout" scenario stalls: longer than any client in the stack waits. */
const STALL_MS = Number(process.env.MOCK_TIMEOUT_MS ?? 120_000);

function reply(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
const error = (
  res: ServerResponse,
  status: number,
  message: string,
  type = 'invalid_request_error',
) => reply(res, status, { error: { message, type } });

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Development stand-in for a language-model API (ADR-0039), OpenAI-compatible like Ollama and LiteLLM:
 * GET /v1/models, POST /v1/chat/completions (also streamed), POST /v1/embeddings. Answers are
 * deterministic; x-mock-scenario (or a [[mock:…]] marker) picks timeout, error, malformed or refusal.
 * GET /_mock/requests shows what arrived, for tests that check no personal data reaches a model.
 * Nothing leaves the machine.
 */
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://llm-mock');
  void (async () => {
    if (url.pathname === '/livez' || url.pathname === '/readyz')
      return reply(res, 200, { status: 'ok' });
    if (url.pathname === '/v1/models' && req.method === 'GET') return reply(res, 200, models());
    if (url.pathname === '/_mock/requests') {
      if (req.method === 'GET') return reply(res, 200, { requests: requests.list() });
      if (req.method === 'DELETE') return (requests.clear(), reply(res, 204));
    }
    if (req.method !== 'POST') return error(res, 404, 'not found');

    let body: Record<string, unknown>;
    try {
      body = (await readJson(req)) as Record<string, unknown>;
    } catch {
      return error(res, 400, 'invalid JSON');
    }
    requests.add(url.pathname, body);

    if (url.pathname === '/v1/embeddings') {
      const input = body.input;
      const valid =
        typeof input === 'string' ||
        (Array.isArray(input) && input.every((i) => typeof i === 'string'));
      if (!valid) return error(res, 400, 'input must be a string or an array of strings');
      return reply(
        res,
        200,
        embeddings(input as string | string[], body.model as string | undefined),
      );
    }

    if (url.pathname === '/v1/chat/completions') {
      const chat = body as ChatRequest;
      if (!Array.isArray(chat.messages) || !chat.messages.length)
        return error(res, 400, 'messages is required');
      const scenario = scenarioOf(req.headers['x-mock-scenario'] as string | undefined, chat);
      log.info({ scenario, stream: Boolean(chat.stream), messages: chat.messages.length }, 'chat');
      if (scenario === 'timeout') await sleep(STALL_MS);
      if (scenario === 'error') return error(res, 500, 'mock failure', 'server_error');
      if (chat.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (const chunk of chatStream(chat, scenario)) res.write(chunk);
        return res.end();
      }
      return reply(res, 200, chatCompletion(chat, scenario));
    }
    return error(res, 404, 'not found');
  })().catch((err: unknown) => {
    log.error({ err }, 'request failed');
    if (!res.headersSent) error(res, 500, 'internal error', 'server_error');
  });
});

server.listen(port, () => log.info({ port }, 'llm mock listening'));

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
