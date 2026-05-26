import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── KEYS ──────────────────────────────────────────────────────────────────────
const CEREBRAS_KEYS = [
  process.env.CEREBRAS_API_KEY, process.env.CEREBRAS_API_KEY_2,
  process.env.CEREBRAS_API_KEY_3, process.env.CEREBRAS_API_KEY_4,
  process.env.CEREBRAS_API_KEY_5,
].filter(Boolean) as string[];

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
].filter(Boolean) as string[];

const SAMBANOVA_KEYS = [
  process.env.SAMBANOVA_API_KEY, process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3, process.env.SAMBANOVA_API_KEY_4,
  process.env.SAMBANOVA_API_KEY_5,
].filter(Boolean) as string[];

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

const HF_KEYS = [
  process.env.HF_API_KEY, process.env.HF_API_KEY_2,
  process.env.HF_API_KEY_3, process.env.HF_API_KEY_4,
  process.env.HF_API_KEY_5,
].filter(Boolean) as string[];

const MISTRAL_KEY = process.env.MISTRAL_API_KEY || '';
const CF_ACCOUNT  = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_TOKEN    = process.env.CLOUDFLARE_API_TOKEN  || '';

// ── RATE LIMIT TRACKER ────────────────────────────────────────────────────────
const keyStatus = new Map<string, number>();
const providerIdx: Record<string, number> = {
  cerebras: 0, groq: 0, sambanova: 0, gemini: 0, hf: 0,
};

const getNextKey = (keys: string[], provider: string): string | null => {
  if (!keys.length) return null;
  const now = Date.now();
  const start = providerIdx[provider] || 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[(start + i) % keys.length];
    if (!keyStatus.has(k) || now >= keyStatus.get(k)!) {
      providerIdx[provider] = (start + i + 1) % keys.length;
      return k;
    }
  }
  // Todas bloqueadas → la que se desbloquea primero
  let best = keys[0], bestTime = keyStatus.get(keys[0]) || 0;
  for (const k of keys) {
    const t = keyStatus.get(k) || 0;
    if (t < bestTime) { best = k; bestTime = t; }
  }
  return best;
};

export const markKeyAsBlocked = (key: string, seconds = 60) => {
  keyStatus.set(key, Date.now() + seconds * 1000);
};

// ── GEMINI WRAPPER ────────────────────────────────────────────────────────────
const callGemini = async (messages: any[], maxTokens = 2000): Promise<string> => {
  const k = getNextKey(GEMINI_KEYS, 'gemini');
  if (!k) throw new Error('No Gemini keys');
  const genAI = new GoogleGenerativeAI(k);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { maxOutputTokens: maxTokens },
  });
  const prompt = messages.map((m: any) => {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${m.role}: ${c}`;
  }).join('\n');
  const result = await model.generateContent(prompt);
  return result.response.text();
};

// ── CLOUDFLARE WRAPPER ────────────────────────────────────────────────────────
const callCloudflare = async (messages: any[]): Promise<string> => {
  if (!CF_ACCOUNT || !CF_TOKEN) throw new Error('Cloudflare no configurado');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
      }),
    }
  );
  const data = await res.json() as any;
  if (!data.result?.response) throw new Error('Cloudflare sin respuesta');
  return data.result.response;
};

const wrapAsClient = (callFn: (msgs: any[], max?: number) => Promise<string>) => ({
  chat: {
    completions: {
      create: async (p: any) => ({
        choices: [{ message: { content: await callFn(p.messages, p.max_tokens) } }],
      }),
    },
  },
});

// ── MODELO POR PROVEEDOR ──────────────────────────────────────────────────────
const adaptModel = (provider: string): string => {
  switch (provider) {
    case 'cerebras':  return 'qwen-3-235b-a22b-instruct-2507';
    case 'groq':      return 'llama-3.3-70b-versatile';
    case 'sambanova': return 'Meta-Llama-3.3-70B-Instruct';
    case 'hf':        return 'meta-llama/Llama-3.3-70B-Instruct';
    case 'mistral':   return 'mistral-small-latest';
    default:          return 'llama-3.3-70b-versatile';
  }
};

// ── COLA DE PROVEEDORES (orden por velocidad y disponibilidad) ────────────────
type Entry = { client: any; provider: string; key?: string };

const buildQueue = (): Entry[] => {
  const q: Entry[] = [];

  // 1. Groq x7 — más rápido cuando disponible (184-544ms)
  for (const k of GROQ_KEYS) {
    q.push({ client: new OpenAI({ apiKey: k, baseURL: 'https://api.groq.com/openai/v1' }), provider: 'groq', key: k });
  }

  // 2. Cerebras x5 — rápido, 235B (706ms pero con rate limit frecuente)
  for (const k of CEREBRAS_KEYS) {
    q.push({ client: new OpenAI({ apiKey: k, baseURL: 'https://api.cerebras.ai/v1' }), provider: 'cerebras', key: k });
  }

  // 3. HuggingFace x5 — rápido (183-480ms)
  for (const k of HF_KEYS) {
    q.push({ client: new OpenAI({ apiKey: k, baseURL: 'https://router.huggingface.co/v1' }), provider: 'hf', key: k });
  }

  // 4. SambaNova x5 — medio (409-1500ms)
  for (const k of SAMBANOVA_KEYS) {
    q.push({ client: new OpenAI({ apiKey: k, baseURL: 'https://api.sambanova.ai/v1' }), provider: 'sambanova', key: k });
  }

  // 5. Gemini x5 — cuando no está en rate limit
  for (const k of GEMINI_KEYS) {
    q.push({ client: wrapAsClient(callGemini), provider: 'gemini', key: k });
  }

  // 6. Mistral x1 — fallback (861ms)
  if (MISTRAL_KEY) {
    q.push({
      client: new OpenAI({ apiKey: MISTRAL_KEY, baseURL: 'https://api.mistral.ai/v1' }),
      provider: 'mistral',
      key: MISTRAL_KEY,
    });
  }

  // 7. Cloudflare — último recurso (1141ms, modelo 8B)
  if (CF_ACCOUNT && CF_TOKEN) {
    q.push({ client: wrapAsClient(callCloudflare), provider: 'cloudflare' });
  }

  return q;
};

// ── REQUEST PRINCIPAL ─────────────────────────────────────────────────────────
export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>,
): Promise<T> => {
  const queue = buildQueue();
  let lastError: any;

  for (let attempt = 0; attempt < queue.length; attempt++) {
    const { client, provider, key } = queue[attempt];

    // Saltar keys bloqueadas
    if (key && keyStatus.has(key) && Date.now() < keyStatus.get(key)!) {
      continue;
    }

    try {
      const result = await fn(client, () => adaptModel(provider));
      console.log(`✅ ${provider} OK (intento ${attempt + 1})`);
      return result;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode;
      const msg = String(err?.message || '').slice(0, 80);

      if (status === 429 || msg.includes('rate') || msg.includes('429') || msg.includes('quota')) {
        if (key) markKeyAsBlocked(key, 60);
        console.warn(`⚠️ Rate limit ${provider} (intento ${attempt + 1})`);
      } else if (status === 401 || status === 403) {
        if (key) markKeyAsBlocked(key, 3600);
        console.warn(`⚠️ Auth error ${provider} (intento ${attempt + 1})`);
      } else {
        console.warn(`⚠️ Error ${provider} (intento ${attempt + 1}): ${msg}`);
      }
    }
  }

  console.error('❌ Todos los proveedores fallaron');
  throw lastError || new Error('AI_EXHAUSTED');
};

// ── EXPORTS COMPATIBILIDAD ────────────────────────────────────────────────────
export const getGroqClient = () => {
  const k = getNextKey(GROQ_KEYS, 'groq');
  return k ? new OpenAI({ apiKey: k, baseURL: 'https://api.groq.com/openai/v1' }) : null;
};
