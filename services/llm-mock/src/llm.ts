import { createHash } from 'node:crypto';

/**
 * The language-model stand-in's behaviour (ADR-0039), free of HTTP so it is unit-testable. Everything is
 * deterministic: the same request always gets the same answer, so smoke and e2e need no model download.
 */

export const CHAT_MODEL = 'raadi-mock-chat';
export const EMBED_MODEL = 'raadi-mock-embed';
/** bge-m3's dimension, so code built on the mock fits the real model. */
export const EMBED_DIMENSIONS = 1024;

/** Test scenarios: chosen by the x-mock-scenario header or a [[mock:<scenario>]] marker in the prompt. */
export type Scenario = 'normal' | 'timeout' | 'error' | 'malformed' | 'refusal';
const SCENARIOS = new Set<Scenario>(['timeout', 'error', 'malformed', 'refusal']);

export interface ChatMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }> | null;
}
export interface ChatRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  response_format?: { type?: string };
}

export const textOf = (m: ChatMessage): string =>
  typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((p) => p.text ?? '').join(' ')
      : '';

export function scenarioOf(header: string | undefined, req: ChatRequest): Scenario {
  const wanted = header?.trim().toLowerCase();
  if (wanted && SCENARIOS.has(wanted as Scenario)) return wanted as Scenario;
  const marker = (req.messages ?? [])
    .map(textOf)
    .join('\n')
    .match(/\[\[mock:([a-z]+)\]\]/)?.[1];
  return marker && SCENARIOS.has(marker as Scenario) ? (marker as Scenario) : 'normal';
}

/** A prompt-injection attempt the guardrail tests use; the mock answers like a well-behaved model. */
const INJECTION = /ignore (all )?(previous|prior) instructions|reveal (the|your) system prompt/i;

/** The assistant's reply text for a request in the "normal" (or "refusal") scenario. */
export function replyText(req: ChatRequest, scenario: Scenario): string {
  const messages = req.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const said = lastUser ? textOf(lastUser) : '';
  if (scenario === 'refusal' || INJECTION.test(said)) return "I can't help with that.";
  if (req.response_format?.type === 'json_object' || req.response_format?.type === 'json_schema') {
    return JSON.stringify({ mock: true, digest: digest(said) });
  }
  const shown = said.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `Mock reply (${digest(said)}): ${shown}`;
}

export function chatCompletion(req: ChatRequest, scenario: Scenario, now = Date.now()) {
  const content = scenario === 'malformed' ? '{"mock": tru' : replyText(req, scenario);
  const promptTokens = tokens((req.messages ?? []).map(textOf).join(' '));
  const completionTokens = tokens(content);
  return {
    id: `chatcmpl-mock-${digest(JSON.stringify(req.messages ?? []))}`,
    object: 'chat.completion',
    created: Math.floor(now / 1000),
    model: req.model ?? CHAT_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/** The same answer as server-sent events: one chunk per word, then [DONE]. */
export function* chatStream(
  req: ChatRequest,
  scenario: Scenario,
  now = Date.now(),
): Generator<string> {
  const full = chatCompletion(req, scenario, now);
  const base = {
    id: full.id,
    object: 'chat.completion.chunk',
    created: full.created,
    model: full.model,
  };
  const words = (full.choices[0]!.message.content ?? '').split(/(?<= )/);
  yield sse({
    ...base,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  });
  for (const w of words)
    yield sse({ ...base, choices: [{ index: 0, delta: { content: w }, finish_reason: null }] });
  yield sse({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: full.usage,
  });
  yield 'data: [DONE]\n\n';
}

/**
 * A deterministic embedding: hashed bag of words, signed, L2-normalised. Texts that share words get
 * similar vectors (cosine), which is enough to test search and "similar listings" end to end.
 */
export function embed(text: string): number[] {
  const v = new Array<number>(EMBED_DIMENSIONS).fill(0);
  for (const word of text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)) {
    const h = createHash('sha256').update(word).digest();
    const index = h.readUInt32BE(0) % EMBED_DIMENSIONS;
    v[index]! += h[4]! & 1 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function embeddings(input: string | string[], model = EMBED_MODEL) {
  const texts = Array.isArray(input) ? input : [input];
  return {
    object: 'list',
    model,
    data: texts.map((t, index) => ({ object: 'embedding', index, embedding: embed(t) })),
    usage: { prompt_tokens: tokens(texts.join(' ')), total_tokens: tokens(texts.join(' ')) },
  };
}

export function models(now = Date.now()) {
  const created = Math.floor(now / 1000);
  return {
    object: 'list',
    data: [CHAT_MODEL, EMBED_MODEL].map((id) => ({
      id,
      object: 'model',
      created,
      owned_by: 'raadi',
    })),
  };
}

/** What the mock received, for tests that check no personal data reaches a model. Newest first. */
export class RequestLog {
  private readonly entries: Array<{ at: string; path: string; body: unknown }> = [];
  constructor(private readonly max = 200) {}
  add(path: string, body: unknown): void {
    this.entries.unshift({ at: new Date().toISOString(), path, body });
    this.entries.length = Math.min(this.entries.length, this.max);
  }
  list() {
    return [...this.entries];
  }
  clear(): void {
    this.entries.length = 0;
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);
const tokens = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
