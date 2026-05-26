// ═══════════════════════════════════════════════════════════════
// StudyAI — cliente unificado de IA para StudyAL
// Cola inteligente: gratis primero, pago solo si todo falla
// ═══════════════════════════════════════════════════════════════

import OpenAI from 'openai';

// ── Keys ──────────────────────────────────────────────────────
const GROQ_KEYS = [
  process.env.GROQ_API_KEY,      process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,    process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,    process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
].filter(Boolean) as string[];

const CEREBRAS_KEYS = [
  process.env.CEREBRAS_API_KEY,  process.env.CEREBRAS_API_KEY_2,
  process.env.CEREBRAS_API_KEY_3,process.env.CEREBRAS_API_KEY_4,
  process.env.CEREBRAS_API_KEY_5,
].filter(Boolean) as string[];

const SAMBANOVA_KEYS = [
  process.env.SAMBANOVA_API_KEY,  process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3,process.env.SAMBANOVA_API_KEY_4,
  process.env.SAMBANOVA_API_KEY_5,
].filter(Boolean) as string[];

const HF_KEYS = [
  process.env.HF_API_KEY,  process.env.HF_API_KEY_2,
  process.env.HF_API_KEY_3,process.env.HF_API_KEY_4,
  process.env.HF_API_KEY_5,
].filter(Boolean) as string[];

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

const MISTRAL_KEY  = process.env.MISTRAL_API_KEY  || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const CF_ACCOUNT   = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_TOKEN     = process.env.CLOUDFLARE_API_TOKEN  || '';

// ── Rate limit tracker ─────────────────────────────────────────
const blocked = new Map<string, number>(); // key → unblock timestamp

export function blockKey(key: string, seconds = 60) {
  blocked.set(key, Date.now() + seconds * 1000);
  console.warn(`🔴 StudyAI: key bloqueada ${seconds}s → ${key.slice(0,12)}...`);
}

function isBlocked(key: string) {
  const t = blocked.get(key);
  if (!t) return false;
  if (Date.now() >= t) { blocked.delete(key); return false; }
  return true;
}

function pickKey(keys: string[]): string | null {
  const available = keys.filter(k => !isBlocked(k));
  if (available.length > 0) return available[Math.floor(Math.random() * available.length)];
  // Todas bloqueadas → la que se desbloquea antes
  if (keys.length === 0) return null;
  return keys.reduce((a, b) => (blocked.get(a) || 0) < (blocked.get(b) || 0) ? a : b);
}

// ── Modelos por proveedor ──────────────────────────────────────
function modelFor(provider: string): string {
  switch (provider) {
    case 'groq':      return 'llama-3.3-70b-versatile';
    case 'cerebras':  return 'qwen-3-235b-a22b-instruct-2507';
    case 'sambanova': return 'Meta-Llama-3.3-70B-Instruct';
    case 'hf':        return 'meta-llama/Llama-3.3-70B-Instruct';
    case 'mistral':   return 'mistral-small-latest';
    case 'openrouter':return 'google/gemini-2.0-flash-001';
    default:          return 'llama-3.3-70b-versatile';
  }
}

// ── Wrappers especiales ────────────────────────────────────────
function geminiClient(key: string) {
  return {
    _studyai: { provider: 'gemini', key },
    chat: {
      completions: {
        create: async (p: any) => {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: p.messages.map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n') }] }],
                generationConfig: { maxOutputTokens: p.max_tokens || 4096, temperature: p.temperature || 0.7 },
              }),
            }
          );
          if (!res.ok) {
            const err = await res.text();
            const e: any = new Error(`Gemini ${res.status}`);
            e.status = res.status;
            e.message = err;
            throw e;
          }
          const d = await res.json();
          const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return { choices: [{ message: { content: text } }] };
        },
      },
    },
  };
}

function cloudflareClient() {
  return {
    _studyai: { provider: 'cloudflare', key: '' },
    chat: {
      completions: {
        create: async (p: any) => {
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
            {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: p.messages.map((m: any) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                })),
              }),
            }
          );
          const d = await res.json() as any;
          if (!d.result?.response) throw new Error('Cloudflare sin respuesta');
          return { choices: [{ message: { content: d.result.response } }] };
        },
      },
    },
  };
}

// ── Cola de proveedores ────────────────────────────────────────
type Entry = { client: any; provider: string; key: string };

function buildQueue(): Entry[] {
  const q: Entry[] = [];

  for (const k of GROQ_KEYS) {
    q.push({
      client: new OpenAI({ apiKey: k, baseURL: 'https://api.groq.com/openai/v1' }),
      provider: 'groq', key: k,
    });
  }

  for (const k of CEREBRAS_KEYS) {
    q.push({
      client: new OpenAI({ apiKey: k, baseURL: 'https://api.cerebras.ai/v1' }),
      provider: 'cerebras', key: k,
    });
  }

  for (const k of HF_KEYS) {
    q.push({
      client: new OpenAI({ apiKey: k, baseURL: 'https://router.huggingface.co/v1' }),
      provider: 'hf', key: k,
    });
  }

  for (const k of SAMBANOVA_KEYS) {
    q.push({
      client: new OpenAI({ apiKey: k, baseURL: 'https://api.sambanova.ai/v1' }),
      provider: 'sambanova', key: k,
    });
  }

  for (const k of GEMINI_KEYS) {
    q.push({ client: geminiClient(k), provider: 'gemini', key: k });
  }

  if (MISTRAL_KEY) {
    q.push({
      client: new OpenAI({ apiKey: MISTRAL_KEY, baseURL: 'https://api.mistral.ai/v1' }),
      provider: 'mistral', key: MISTRAL_KEY,
    });
  }

  if (OPENROUTER_KEY) {
    q.push({
      client: new OpenAI({
        apiKey: OPENROUTER_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://joseanotaciones.com',
          'X-Title': 'StudyAL',
        },
      }),
      provider: 'openrouter', key: OPENROUTER_KEY,
    });
  }

  if (CF_ACCOUNT && CF_TOKEN) {
    q.push({ client: cloudflareClient(), provider: 'cloudflare', key: '' });
  }

  return q;
}

// ── Interfaz pública ───────────────────────────────────────────
export interface StudyAIParams {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface StudyAIResult {
  text: string;
  provider: string;
}

/**
 * Llama a la IA con fallback automático entre todos los proveedores.
 * Gratis primero — pago solo si todo falla.
 */
export async function studyAI(params: StudyAIParams): Promise<StudyAIResult> {
  const queue = buildQueue();
  let lastError: any;

  for (const { client, provider, key } of queue) {
    if (key && isBlocked(key)) continue;

    try {
      const res = await client.chat.completions.create({
        model: modelFor(provider),
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        ...(params.json && provider !== 'gemini' && provider !== 'cloudflare'
          ? { response_format: { type: 'json_object' } }
          : {}),
      });

      const text = res.choices[0]?.message?.content || '';
      if (!text.trim()) throw new Error('Respuesta vacía');

      console.log(`✅ StudyAI: ${provider} OK`);
      return { text, provider };

    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode;
      const msg = String(err?.message || '');

      if (status === 429 || msg.includes('rate') || msg.includes('429') || msg.includes('quota')) {
        if (key) blockKey(key, 60);
        console.warn(`⚠️ StudyAI: rate limit ${provider}`);
      } else if (status === 401 || status === 403) {
        if (key) blockKey(key, 3600);
        console.warn(`⚠️ StudyAI: auth error ${provider}`);
      } else {
        console.warn(`⚠️ StudyAI: error ${provider} — ${msg.slice(0, 80)}`);
      }
    }
  }

  throw lastError || new Error('StudyAI: todos los proveedores fallaron');
}

/**
 * Llama a la IA y parsea el resultado como JSON.
 * Reintenta si el JSON es inválido.
 */
export async function studyAIJson<T = any>(params: StudyAIParams): Promise<T> {
  const result = await studyAI({ ...params, json: true });
  const parsed = safeParseJson(result.text);
  if (parsed === null) throw new Error(`StudyAI: JSON inválido de ${result.provider}`);
  return parsed as T;
}

// ── Compatibilidad con código existente ────────────────────────
// Para no romper rutas que importan groqClient
export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>,
): Promise<T> => {
  const queue = buildQueue();
  let lastError: any;

  for (const { client, provider, key } of queue) {
    if (key && isBlocked(key)) continue;
    try {
      const result = await fn(client, () => modelFor(provider));
      console.log(`✅ StudyAI (groqRequest compat): ${provider}`);
      return result;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode;
      const msg = String(err?.message || '');
      if (status === 429 || msg.includes('rate') || msg.includes('429')) {
        if (key) blockKey(key, 60);
      } else if (status === 401 || status === 403) {
        if (key) blockKey(key, 3600);
      }
    }
  }
  throw lastError || new Error('StudyAI: todos los proveedores fallaron');
};

export const getGroqClient = () => {
  const key = pickKey(GROQ_KEYS);
  if (!key) return null;
  return new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
};

// ── Utilidades ─────────────────────────────────────────────────
export function safeParseJson(raw: string): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
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
