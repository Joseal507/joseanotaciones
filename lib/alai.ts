import OpenAI from 'openai';
import {
  classifyProviderFailure,
  sanitizedProviderMessage,
  shouldFallbackToGroq,
  type ProviderError,
} from './ai/providerPolicy';

type Role = 'system' | 'user' | 'assistant';

export interface ALAIParams {
  messages: { role: Role; content: string }[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  excludeProviders?: string[];
  excludeModels?: string[];
  maxProviderAttempts?: number;
  fallbackError?: ProviderError;
  taskType?: string;
  stage?: string;
}

export interface ALAIResult {
  text: string;
  provider: string;
  model: string;
}

type Provider =
  | 'openrouter'
  | 'groq'
  | 'github'
  | 'gemini'
  | 'cerebras'
  | 'sambanova'
  | 'hf'
  | 'mistral'
  | 'cloudflare';

type QueueEntry = {
  provider: Provider;
  key: string;
  model: string;
  client: any;
};

const blocked = new Map<string, number>();
const cursor: Record<string, number> = {};

const disabledProviders = new Set(
  (process.env.ALAI_DISABLED_PROVIDERS || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean)
);

function unique(arr: string[]) {
  return Array.from(new Set(arr.map(x => x.trim()).filter(Boolean)));
}

function envKeys(base: string): string[] {
  const exact = process.env[base];
  const numbered = Object.keys(process.env)
    .filter(k => {
      if (k !== base && !k.startsWith(`${base}_`)) return false;
      if (k.endsWith('_TEST')) return false;
      return true;
    })
    .sort((a, b) => {
      const na = Number(a.replace(`${base}_`, '').replace(base, '1')) || 1;
      const nb = Number(b.replace(`${base}_`, '').replace(base, '1')) || 1;
      return na - nb;
    })
    .map(k => process.env[k] || '');

  return unique([exact || '', ...numbered]);
}

function envKeysLoose(prefix: string): string[] {
  return unique(
    Object.keys(process.env)
      .filter(k => k === prefix || /^JIT\d+$/.test(k))
      .sort((a, b) => {
        const na = a === prefix ? 1 : Number(a.replace(prefix, '')) || 1;
        const nb = b === prefix ? 1 : Number(b.replace(prefix, '')) || 1;
        return na - nb;
      })
      .map(k => process.env[k] || '')
  );
}

function isBlocked(key: string) {
  const until = blocked.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    blocked.delete(key);
    return false;
  }
  return true;
}

export function blockALAIKey(key: string, seconds = 60) {
  if (!key) return;
  blocked.set(key, Date.now() + seconds * 1000);
  console.warn(`🔴 ALAI: key bloqueada ${seconds}s → ${key.slice(0, 10)}...`);
}

function rotate<T extends QueueEntry>(entries: T[], provider: Provider): T[] {
  if (!entries.length) return entries;
  const i = cursor[provider] || 0;
  cursor[provider] = (i + 1) % entries.length;
  return [...entries.slice(i), ...entries.slice(0, i)];
}

function modelFor(provider: Provider): string {
  switch (provider) {
    case 'openrouter':
      return 'google/gemini-2.5-flash';
    case 'groq':
      return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    case 'github':
      return process.env.JIT_MODEL || process.env.GITHUB_MODEL || 'openai/gpt-4.1-mini';
    case 'gemini':
      return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    case 'cerebras':
      return process.env.CEREBRAS_MODEL || 'qwen-3-235b-a22b-instruct-2507';
    case 'sambanova':
      return process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.3-70B-Instruct';
    case 'hf':
      return process.env.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct';
    case 'mistral':
      return process.env.MISTRAL_MODEL || 'mistral-small-latest';
    case 'cloudflare':
      return process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  }
}

function openAIClient(key: string, baseURL: string) {
  return new OpenAI({ apiKey: key, baseURL });
}

function geminiClient(key: string, model: string) {
  return {
    chat: {
      completions: {
        create: async (p: any) => {
          const prompt = p.messages
            .map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
            .join('\n');

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  maxOutputTokens: p.max_tokens || 8192,
                  temperature: p.temperature ?? 0.7,
                },
              }),
            }
          );

          if (!res.ok) {
            const text = await res.text();
            const e: any = new Error(text || `Gemini ${res.status}`);
            e.status = res.status;
            throw e;
          }

          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return { choices: [{ message: { content: text } }] };
        },
      },
    },
  };
}

function cloudflareClient(model: string) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const token = process.env.CLOUDFLARE_API_TOKEN || '';

  return {
    chat: {
      completions: {
        create: async (p: any) => {
          if (!account || !token) throw new Error('Cloudflare no configurado');

          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messages: p.messages.map((m: any) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                })),
              }),
            }
          );

          const data = await res.json() as any;
          if (!res.ok || !data?.result?.response) {
            const e: any = new Error(JSON.stringify(data).slice(0, 400));
            e.status = res.status;
            throw e;
          }

          return { choices: [{ message: { content: data.result.response } }] };
        },
      },
    },
  };
}

function buildQueue(): QueueEntry[] {
  const queue: QueueEntry[] = [];

  const addOpenAIProvider = (
    provider: Provider,
    keys: string[],
    baseURL: string,
  ) => {
    if (disabledProviders.has(provider)) return;

    const model = modelFor(provider);
    for (const key of keys) {
      queue.push({
        provider,
        key,
        model,
        client: openAIClient(key, baseURL),
      });
    }
  };

  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  if (openrouterKey && !disabledProviders.has('openrouter')) {
    queue.push({
      provider: 'openrouter',
      key: openrouterKey,
      model: modelFor('openrouter'),
      client: openAIClient(openrouterKey, 'https://openrouter.ai/api/v1'),
    });
  }

  addOpenAIProvider('groq', envKeys('GROQ_API_KEY'), 'https://api.groq.com/openai/v1');
  addOpenAIProvider('github', envKeysLoose('JIT'), 'https://models.github.ai/inference');
  addOpenAIProvider('cerebras', envKeys('CEREBRAS_API_KEY'), 'https://api.cerebras.ai/v1');

  if (!process.env.HF_DISABLED) {
    addOpenAIProvider('hf', envKeys('HF_API_KEY'), 'https://router.huggingface.co/v1');
  }
  if (!process.env.SAMBANOVA_DISABLED) {
    addOpenAIProvider('sambanova', envKeys('SAMBANOVA_API_KEY'), 'https://api.sambanova.ai/v1');
  }

  const geminiModel = modelFor('gemini');
  const geminiDisabled = disabledProviders.has('gemini') || !!process.env.GEMINI_DISABLED;
  if (!geminiDisabled) {
    const geminiKeys = [
      ...envKeys('GEMINI_API_KEY'),
      ...(process.env.GEMINI_PREMIUM_KEY ? [process.env.GEMINI_PREMIUM_KEY] : []),
    ].filter(Boolean);
    for (const key of unique(geminiKeys)) {
      queue.push({
        provider: 'gemini',
        key,
        model: geminiModel,
        client: geminiClient(key, geminiModel),
      });
    }
  }

  const mistralKey = process.env.MISTRAL_API_KEY || '';
  if (mistralKey && !disabledProviders.has('mistral')) {
    queue.push({
      provider: 'mistral',
      key: mistralKey,
      model: modelFor('mistral'),
      client: openAIClient(mistralKey, 'https://api.mistral.ai/v1'),
    });
  }

  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN && !disabledProviders.has('cloudflare')) {
    const model = modelFor('cloudflare');
    queue.push({
      provider: 'cloudflare',
      key: process.env.CLOUDFLARE_API_TOKEN,
      model,
      client: cloudflareClient(model),
    });
  }

  const order: Provider[] = [
    'openrouter',
    'groq',
    'github',
    'hf',
    'mistral',
    'sambanova',
    'gemini',
    'cerebras',
    'cloudflare',
  ];

  return order.flatMap(provider =>
    rotate(queue.filter(x => x.provider === provider), provider)
  );
}

function shouldUseJson(provider: Provider, params: ALAIParams) {
  return Boolean(
    params.json &&
    provider !== 'gemini' &&
    provider !== 'cloudflare' &&
    provider !== 'cerebras' &&
    provider !== 'openrouter'
  );
}

function providerMaxTokens(provider: Provider, requested?: number) {
  const base = requested ?? 4096;
  if (provider === 'cerebras') return Math.max(base, 4000);
  if (provider === 'openrouter') return Math.max(base, 8192); // Forzar presupuesto alto en OpenRouter
  return base;
}

function retrySeconds(err: any) {
  const h = err?.headers;
  const raw =
    h?.['retry-after'] ||
    h?.get?.('retry-after') ||
    err?.response?.headers?.['retry-after'];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 60;
}

function isRateLimit(err: any) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return status === 429 || msg.includes('rate') || msg.includes('quota') || msg.includes('too many');
}

function isAuthError(err: any) {
  const status = err?.status || err?.statusCode;
  return status === 401 || status === 403;
}

function isProviderUnavailable(err: any) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  // 429 = rate limit, nunca provider unavailable
  if (status === 429) return false;
  // 404 con "no endpoints" o "model not found" = MODEL_NOT_AVAILABLE
  // No bloquear key: es un error de configuración, no financiero ni de autenticación
  if (status === 404) return false;
  return status === 402 || status === 410 ||
    msg.includes('depleted');
}

function isModelNotAvailable(err: any) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  return status === 404 ||
    (msg.includes('model') && msg.includes('not found')) ||
    msg.includes('no endpoints');
}

function normalizedProviderError(error: any, provider: Provider): ProviderError {
  return {
    provider,
    status: Number(error?.status || error?.statusCode || error?.response?.status || 0),
    message: String(error?.message || ''),
    body: error?.body || error?.error || error?.response?.data,
  };
}

function providerTelemetry(
  event: string,
  entry: Pick<QueueEntry, 'provider' | 'model'>,
  params: ALAIParams,
  details: Record<string, unknown>,
) {
  console.info('[provider-policy]', JSON.stringify({
    event,
    provider: entry.provider,
    model: entry.model,
    stage: params.stage || 'normal',
    taskType: params.taskType || 'unspecified',
    ...details,
  }));
}

// ── ZERO-PAID-PROVIDER TEST GUARD ──────────────────────────────────
// STUDYAL_TEST_NO_PROVIDER_CALLS is set ONLY by playwright.config.ts's
// webServer.env (a local dev-only Playwright process spawn) — it does not
// exist in .env, .env.local, .env.production, or any deployed environment,
// so this can never fire in production and production provider behavior/
// policy is completely unchanged when unset. When set, it makes the SINGLE
// canonical provider chokepoint (alai()) fail loudly and immediately,
// BEFORE any real network call, whenever a Playwright test's route mocks
// have a gap and a request would otherwise reach a real paid provider
// (OpenRouter/Groq/etc). This is a server-side backstop independent of
// per-test page.route() completeness — see tests/e2e/_shared/noPaidProviderGuard.ts
// for the client-side assertion that also fails the test explicitly.
function assertNoRealProviderCallsInTestMode() {
  if (process.env.STUDYAL_TEST_NO_PROVIDER_CALLS === '1') {
    throw new Error(
      'STUDYAL_TEST_MODE: blocked a real AI provider call. This route was not ' +
      'mocked in the current Playwright test — add a page.route() fixture for ' +
      'the endpoint that triggers alai()/alaiJson() instead of letting the ' +
      'request reach the real provider.',
    );
  }
}

export async function alai(params: ALAIParams): Promise<ALAIResult> {
  assertNoRealProviderCallsInTestMode();
  const fallbackAllowed = Boolean(params.fallbackError && shouldFallbackToGroq(params.fallbackError));
  const requestedExclusions = (params.excludeProviders || []).map(value => value.toLowerCase());
  if (requestedExclusions.includes('openrouter') && !fallbackAllowed) {
    throw new Error('PROVIDER_POLICY_VIOLATION:openrouter_exclusion_without_credits_exhausted');
  }
  const excludedProviders = new Set(fallbackAllowed ? ['openrouter'] : requestedExclusions.filter(value => value !== 'openrouter'));
  const excludedModels = new Set(params.excludeModels || []);
  const selectedProvider: Provider = fallbackAllowed ? 'groq' : 'openrouter';
  const queue = buildQueue().filter(entry => entry.provider === selectedProvider && !excludedProviders.has(entry.provider) && !excludedModels.has(entry.model));
  let lastError: any;
  let providerAttempts = 0;

  if (!queue.length) {
    throw new Error(`ALAI: proveedor canónico ${selectedProvider} no configurado`);
  }

  for (const entry of queue) {
    const { client, provider, key, model } = entry;
    if (key && isBlocked(key)) continue;

    try {
      providerAttempts += 1;
      providerTelemetry('provider_call_started', entry, params, {
        status: null, normalizedFailureReason: null, fallbackAllowed,
        fallbackTarget: fallbackAllowed ? 'groq' : null, excludedProviders: [...excludedProviders], rawProviderMessage: '',
      });
      const res = await client.chat.completions.create({
        model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: providerMaxTokens(provider, params.maxTokens),
        ...(shouldUseJson(provider, params)
          ? { response_format: { type: 'json_object' } }
          : {}),
      });

      const text =
        res?.choices?.[0]?.message?.content ??
        res?.choices?.[0]?.delta?.content ??
        res?.choices?.[0]?.text ??
        res?.content ??
        res?.response ??
        res?.output_text ??
        '';

      if (!String(text).trim()) {
        const e: any = new Error('ALAI_EMPTY_RESPONSE');
        e.status = 204;
        throw e;
      }

      console.log(`✅ ALAI: ${provider} OK · ${model}`);
      providerTelemetry('provider_call_succeeded', entry, params, {
        status: 200, normalizedFailureReason: null, fallbackAllowed,
        fallbackTarget: fallbackAllowed ? 'groq' : null, excludedProviders: [...excludedProviders], rawProviderMessage: '',
      });

      return { text, provider, model };
    } catch (err: any) {
      lastError = err;
      err.alaiProvider = provider;
      const policyError = normalizedProviderError(err, provider);
      err.providerError = policyError;
      const normalizedFailureReason = classifyProviderFailure(policyError);
      providerTelemetry('provider_call_failed', entry, params, {
        status: policyError.status || 0, normalizedFailureReason,
        fallbackAllowed: shouldFallbackToGroq(policyError),
        fallbackTarget: shouldFallbackToGroq(policyError) ? 'groq' : null,
        excludedProviders: [...excludedProviders], rawProviderMessage: sanitizedProviderMessage(policyError),
      });
      if (isRateLimit(err)) {
        blockALAIKey(key, retrySeconds(err));
        console.warn(`⚠️ ALAI: rate/quota ${provider} · ${model}`);
      } else if (isAuthError(err)) {
        blockALAIKey(key, 3600);
        console.warn(`⚠️ ALAI: auth error ${provider} · ${model}`);
      } else if (isModelNotAvailable(err)) {
        // MODEL_NOT_AVAILABLE: error de configuración, no financiero
        // NO bloquear key, NO habilitar Groq — reportar y fallar limpio
        console.error(`🔴 ALAI: MODEL_NOT_AVAILABLE ${provider} · ${model} — verifica OPENROUTER_MODEL o modelFor()`);
      } else if (isProviderUnavailable(err)) {
        blockALAIKey(key, 300);
        console.warn(`⚠️ ALAI: provider unavailable ${provider} · ${model}`);
      }
      if (providerAttempts >= Math.max(1, params.maxProviderAttempts ?? 1)) break;
    }
  }

  throw lastError || new Error('ALAI: todos los proveedores fallaron');
}

export async function alaiJson<T = any>(params: ALAIParams): Promise<T> {
  const result = await alai({ ...params, json: true });
  const parsed = safeParseJson(result.text);
  if (parsed === null) {
    throw new Error(`ALAI: JSON inválido de ${result.provider} · ${result.model}`);
  }
  return parsed as T;
}

export const alaiRequest = async <T>(
  fn: (client: any, model: (m?: string) => string) => Promise<T>,
): Promise<T> => {
  const openrouter = buildQueue().find(entry => entry.provider === 'openrouter' && !isBlocked(entry.key));
  if (!openrouter) throw new Error('ALAI: proveedor canónico openrouter no configurado');
  try {
    const result = await fn(openrouter.client, () => openrouter.model);
    return result;
  } catch (error: any) {
    const policyError = normalizedProviderError(error, 'openrouter');
    if (!shouldFallbackToGroq(policyError)) throw error;
    console.info('[provider-policy]', JSON.stringify({
      event: 'openrouter_credits_exhausted', provider: 'openrouter', model: openrouter.model,
      status: policyError.status, normalizedFailureReason: 'OPENROUTER_CREDITS_EXHAUSTED', fallbackAllowed: true,
      fallbackTarget: 'groq', excludedProviders: ['openrouter'], rawProviderMessage: sanitizedProviderMessage(policyError),
    }));
    const groq = buildQueue().find(entry => entry.provider === 'groq' && !isBlocked(entry.key));
    if (!groq) throw error;
    return await fn(groq.client, () => groq.model);
  }
};

export const getALAIClient = () => {
  const first = buildQueue().find(x => x.provider === 'openrouter' && !isBlocked(x.key));
  return first?.client || null;
};

export function safeParseJson(raw: string): any {
  if (!raw) return null;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : raw;
  const braceMatch = !fenceMatch ? candidate.match(/(\{[\s\S]*\})/) : null;
  const jsonStr = braceMatch ? braceMatch[1] : candidate;
  const repaired = repairJson(jsonStr);
  try { return JSON.parse(repaired); } catch {}
  try { return JSON.parse(jsonStr); } catch {}
  return null;
}

function repairJson(raw: string): string {
  let s = raw;
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, (strMatch: string) => {
      return strMatch.replace(/\\([a-zA-Z][a-zA-Z]+)/g, (_: string, cmd: string) => '\\\\' + cmd);
  });
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s.trim();
}

export function cleanText(s: any): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '').trim();
}

export function cleanDeep(obj: any): any {
  if (typeof obj === 'string') return cleanText(obj);
  if (Array.isArray(obj)) return obj.map(cleanDeep);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const k of Object.keys(obj)) out[k] = cleanDeep(obj[k]);
    return out;
  }
  return obj;
}
