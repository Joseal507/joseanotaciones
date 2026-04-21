import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6,
].filter(Boolean) as string[];

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4,
].filter(Boolean) as string[];

const CEREBRAS_KEYS = [
  process.env.CEREBRAS_API_KEY, process.env.CEREBRAS_API_KEY_2,
  process.env.CEREBRAS_API_KEY_3, process.env.CEREBRAS_API_KEY_4,
].filter(Boolean) as string[];

const TOGETHER_KEYS = [
  process.env.TOGETHER_API_KEY, process.env.TOGETHER_API_KEY_2,
  process.env.TOGETHER_API_KEY_3, process.env.TOGETHER_API_KEY_4,
].filter(Boolean) as string[];

const SAMBANOVA_KEYS = [
  process.env.SAMBANOVA_API_KEY, process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3, process.env.SAMBANOVA_API_KEY_4,
].filter(Boolean) as string[];

const keyStatus = new Map<string, number>();
let currentGroqIndex = 0;
let currentGeminiIndex = 0;
let currentCerebrasIndex = 0;
let currentTogetherIndex = 0;
let currentSambanovaIndex = 0;

const getNextKey = (keys: string[], currentIndex: number, setIndex: (i: number) => void) => {
  if (keys.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const idx = (currentIndex + i) % keys.length;
    const key = keys[idx];
    if (!keyStatus.has(key) || now >= keyStatus.get(key)!) {
      setIndex((idx + 1) % keys.length);
      return key;
    }
  }
  return null;
};

export const markKeyAsBlocked = (key: string, seconds = 60) => {
  keyStatus.set(key, Date.now() + seconds * 1000);
  console.warn(`🔴 Key bloqueada por ${seconds}s → ${key.slice(0, 10)}...`);
};

// --- CLIENTES NATIVOS ---
const callCloudflare = async (messages: any[]): Promise<string> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('Cloudflare no configurado');

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
  const data = await res.json();
  if (!data.success) throw new Error('Cloudflare AI Error');
  return data.result.response;
};

const callGemini = async (messages: any[], maxTokens: number = 2000): Promise<string> => {
  const key = getNextKey(GEMINI_KEYS, currentGeminiIndex, (i) => currentGeminiIndex = i);
  if (!key) throw new Error('No hay keys de Gemini');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const prompt = messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');
  const result = await model.generateContent(prompt);
  return result.response.text();
};

// --- GENERADORES DE CLIENTES COMPATIBLES ---
export const getGroqClient = () => {
  const key = getNextKey(GROQ_KEYS, currentGroqIndex, (i) => currentGroqIndex = i);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }) : null;
};

const getCerebrasClient = () => {
  const key = getNextKey(CEREBRAS_KEYS, currentCerebrasIndex, (i) => currentCerebrasIndex = i);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.cerebras.ai/v1' }) : null;
};

const getTogetherClient = () => {
  const key = getNextKey(TOGETHER_KEYS, currentTogetherIndex, (i) => currentTogetherIndex = i);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' }) : null;
};

const getSambanovaClient = () => {
  const key = getNextKey(SAMBANOVA_KEYS, currentSambanovaIndex, (i) => currentSambanovaIndex = i);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.sambanova.ai/v1' }) : null;
};

// --- FALLBACK ENGINE ---
export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>
): Promise<T> => {
  let lastError: any;

  const providers: (() => { client: any; provider: string } | null)[] = [
    ...Array(6).fill(null).map(() => () => { const c = getGroqClient(); return c ? { client: c, provider: 'groq' } : null; }),
    ...Array(4).fill(null).map(() => () => { const c = getCerebrasClient(); return c ? { client: c, provider: 'cerebras' } : null; }),
    ...Array(4).fill(null).map(() => () => { const c = getTogetherClient(); return c ? { client: c, provider: 'together' } : null; }),
    ...Array(4).fill(null).map(() => () => { const c = getSambanovaClient(); return c ? { client: c, provider: 'sambanova' } : null; }),
    () => ({ client: { chat: { completions: { create: async (p: any) => ({ choices: [{ message: { content: await callGemini(p.messages) } }] }) } } }, provider: 'gemini' }),
    () => ({ client: { chat: { completions: { create: async (p: any) => ({ choices: [{ message: { content: await callCloudflare(p.messages) } }] }) } } }, provider: 'cloudflare' }),
    () => { 
        if (!process.env.OPENROUTER_API_KEY) return null;
        const c = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
        return { client: c, provider: 'openrouter' };
    }
  ];

  for (let attempt = 0; attempt < providers.length; attempt++) {
    try {
      const p = providers[attempt]();
      if (!p) continue;
      
      const modelAdapter = (m: string) => {
        if (p.provider === 'cerebras') return 'llama3.1-70b';
        if (p.provider === 'together') return 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
        if (p.provider === 'sambanova') return 'Meta-Llama-3.1-405B-Instruct';
        if (p.provider === 'openrouter') return 'meta-llama/llama-3.1-8b-instruct:free';
        return m;
      };

      const result = await fn(p.client, modelAdapter);
      console.log(`✅ ${p.provider} OK`);
      return result;
    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️ Intento ${attempt + 1} falló`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw lastError || new Error('Todas las IAs fallaron');
};
