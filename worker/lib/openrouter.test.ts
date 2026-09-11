import { afterEach, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { chatCompletion } from './openrouter';

afterEach(() => vi.unstubAllGlobals());

it('uses the deployed Gemini/DeepSeek order and switches to DeepSeek after a timeout', async () => {
  const models: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    models.push((JSON.parse(init.body as string) as { model: string }).model);
    if (models.length === 1) throw new DOMException('Request aborted', 'AbortError');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  }));
  const result = await chatCompletion<{ ok: boolean }>('test-key', {
    messages: [{ role: 'user', content: 'Return JSON.' }],
  }, { primaryModel: env.OPENROUTER_MODEL, fallbackModel: env.OPENROUTER_FALLBACK_MODEL });
  expect(models).toEqual(['google/gemini-3.8-flash', 'deepseek/deepseek-v4.1-flash']);
  expect(result.data).toEqual({ ok: true });
  expect(result.meta.usedFallbackModel).toBe(true);
});

it('reserves the output budget for JSON on both Flash models, including failover', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    if (bodies.length === 1) return new Response('Unavailable', { status: 503 });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  }));
  const result = await chatCompletion<{ ok: boolean }>('test-key', {
    messages: [{ role: 'user', content: 'Return JSON.' }],
  }, {
    primaryModel: 'deepseek/deepseek-v4-flash-0731',
    fallbackModel: 'qwen/qwen3.8-flash',
  });
  expect(result.data).toEqual({ ok: true });
  expect(bodies.map(body => body.model)).toEqual(['deepseek/deepseek-v4-flash-0731', 'qwen/qwen3.8-flash']);
  expect(bodies.map(body => body.reasoning)).toEqual([{ enabled: false }, { enabled: false }]);
  expect(result.meta.usedFallbackModel).toBe(true);
});

it('uses the fallback when a private primary-model request gets a provider-specific 400', async () => {
  const models: string[] = [];
  const reasoning: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { model: string; reasoning?: unknown };
    models.push(body.model);
    reasoning.push(body.reasoning);
    if (body.model === 'google/gemini-3.8-flash') {
      return Response.json({ error: { message: 'Provider rejected this request' } }, { status: 400 });
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  }));

  const result = await chatCompletion<{ ok: boolean }>('test-key', {
    messages: [{ role: 'user', content: 'Return JSON from private documents.' }],
  }, {
    primaryModel: 'google/gemini-3.8-flash',
    fallbackModel: 'deepseek/deepseek-v4.1-flash',
  }, {
    redactErrors: true,
  });

  expect(result.data).toEqual({ ok: true });
  expect(models).toEqual(['google/gemini-3.8-flash', 'deepseek/deepseek-v4.1-flash']);
  expect(reasoning).toEqual([undefined, { enabled: false }]);
  expect(result.meta.usedFallbackModel).toBe(true);
});
