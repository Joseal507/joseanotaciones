import OpenAI from 'openai';

// ═══════════════════════════════════════════════════════════════
// ALAI — motor unificado de IA para StudyAL
// Rotación real por proveedor + key + modelo
// Compatibilidad OpenAI Chat Completions cuando aplica
// ═══════════════════════════════════════════════════════════════

type Role = 'system' | 'user' | 'assistant';

export interface ALAIParams {
  messages: { role: Role; content: string }[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface ALAIResult {
  text: string;
  provider: string;
  model: string;
}

type Provider =
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
    .filter(k => k === base || k.startsWith(`${base}_`))
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
                  maxOutputTokens: p.max_tokens || 4096,
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

  addOpenAIProvider('groq', envKeys('GROQ_API_KEY'), 'https://api.groq.com/openai/v1');

  // JIT = GitHub Models token(s). GitHub Models usa PAT con models:read.
  // Endpoint oficial OpenAI-compatible: https://models.github.ai/inference
  addOpenAIProvider('github', envKeysLoose('JIT'), 'https://models.github.ai/inference');

  addOpenAIProvider('cerebras', envKeys('CEREBRAS_API_KEY'), 'https://api.cerebras.ai/v1');
  addOpenAIProvider('hf', envKeys('HF_API_KEY'), 'https://router.huggingface.co/v1');
  addOpenAIProvider('sambanova', envKeys('SAMBANOVA_API_KEY'), 'https://api.sambanova.ai/v1');

  const geminiModel = modelFor('gemini');
  if (!disabledProviders.has('gemini')) for (const key of envKeys('GEMINI_API_KEY')) {
    queue.push({
      provider: 'gemini',
      key,
      model: geminiModel,
      client: geminiClient(key, geminiModel),
    });
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
    'groq',
    'github',
    'gemini',
    'cerebras',
    'sambanova',
    'mistral',
    'cloudflare',
    'hf',
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
    provider !== 'cerebras'
  );
}

function providerMaxTokens(provider: Provider, requested?: number) {
  const base = requested ?? 4096;

  // Cerebras gpt-oss usa tokens de reasoning antes de content.
  // Si el límite es muy bajo, responde 200 pero message.content viene vacío.
  if (provider === 'cerebras') return Math.max(base, 1024);

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
  return status === 402 || status === 404 || status === 410 ||
    msg.includes('depleted') ||
    msg.includes('not available') ||
    msg.includes('model') && msg.includes('not');
}

export async function alai(params: ALAIParams): Promise<ALAIResult> {
  const queue = buildQueue();
  let lastError: any;

  if (!queue.length) {
    throw new Error('ALAI: no hay proveedores configurados en .env.local');
  }

  for (const entry of queue) {
    const { client, provider, key, model } = entry;
    if (key && isBlocked(key)) continue;

    try {
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
      return { text, provider, model };
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '').slice(0, 140);

      if (isRateLimit(err)) {
        blockALAIKey(key, retrySeconds(err));
        console.warn(`⚠️ ALAI: rate/quota ${provider} · ${model}`);
      } else if (isAuthError(err)) {
        blockALAIKey(key, 3600);
        console.warn(`⚠️ ALAI: auth ${provider} · ${model}`);
      } else if (String(err?.message || '').includes('ALAI_EMPTY_RESPONSE')) {
        blockALAIKey(key, 120);
        console.warn(`⚠️ ALAI: respuesta vacía ${provider} · ${model}`);
      } else if (isProviderUnavailable(err)) {
        blockALAIKey(key, 24 * 3600);
        console.warn(`⚠️ ALAI: provider/model no disponible ${provider} · ${model}`);
      } else {
        console.warn(`⚠️ ALAI: error ${provider} · ${model} — ${msg}`);
      }
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
  const queue = buildQueue();
  let lastError: any;

  for (const entry of queue) {
    const { client, provider, key, model } = entry;
    if (key && isBlocked(key)) continue;

    try {
      const result = await fn(client, () => model);
      console.log(`✅ ALAI request: ${provider} OK · ${model}`);
      return result;
    } catch (err: any) {
      lastError = err;

      if (isRateLimit(err)) {
        blockALAIKey(key, retrySeconds(err));
      } else if (isAuthError(err)) {
        blockALAIKey(key, 3600);
      } else if (isProviderUnavailable(err)) {
        blockALAIKey(key, 24 * 3600);
      } else {
        console.warn(`⚠️ ALAI request: ${provider} · ${model} — ${String(err?.message || '').slice(0, 120)}`);
      }
    }
  }

  throw lastError || new Error('ALAI: todos los proveedores fallaron');
};

export const getALAIClient = () => {
  const first = buildQueue().find(x => x.provider === 'groq' && !isBlocked(x.key))
    || buildQueue().find(x => !isBlocked(x.key));
  return first?.client || null;
};

export function safeParseJson(raw: string): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  return null;
}

export function cleanText(s: any): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
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

// Compatibilidad temporal con imports actuales
export type StudyAIParams = ALAIParams;
export type StudyAIResult = ALAIResult;
export const studyAI = alai;
export const studyAIJson = alaiJson;
export const groqRequest = alaiRequest;
export const getGroqClient = getALAIClient;
