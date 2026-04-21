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
  process.env.CEREBRAS_API_KEY,
  process.env.CEREBRAS_API_KEY_2,
  process.env.CEREBRAS_API_KEY_3,
].filter(Boolean) as string[];

const TOGETHER_KEYS = [
  process.env.TOGETHER_API_KEY,
  process.env.TOGETHER_API_KEY_2,
  process.env.TOGETHER_API_KEY_3,
  process.env.TOGETHER_API_KEY_4,
].filter(Boolean) as string[];

const keyStatus = new Map<string, number>();
let currentGroqIndex = 0;
let currentGeminiIndex = 0;
let currentCerebrasIndex = 0;
let currentTogetherIndex = 0;

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

const getMistralClient = () => {
  if (!process.env.MISTRAL_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.MISTRAL_API_KEY, baseURL: 'https://api.mistral.ai/v1' });
};

const getOpenRouterClient = () => {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' });
};

const callGemini = async (messages: any[], maxTokens: number = 2000): Promise<string> => {
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const key = getNextKey(GEMINI_KEYS, currentGeminiIndex, (i) => currentGeminiIndex = i);
    if (!key) break;
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      });
      const prompt = messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: any) {
      if (err?.message?.includes('429') || err?.message?.includes('quota')) {
        markKeyAsBlocked(key, 60);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Todas las keys de Gemini agotadas');
};

const makeGeminiFakeClient = () => ({
  chat: {
    completions: {
      create: async (p: any) => ({
        choices: [{ message: { content: await callGemini(p.messages, p.max_tokens) } }],
      }),
    },
  },
});

const adaptModel = (model: string, provider: string): string => {
  if (provider === 'groq') return model;
  if (provider === 'cerebras') return 'llama3.1-70b';
  if (provider === 'together') return 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
  if (provider === 'mistral') return 'mistral-small-latest';
  return 'meta-llama/llama-3.1-8b-instruct:free';
};

export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>,
): Promise<T> => {
  let lastError: any;

  // 🏗️ Lista de proveedores en orden de prioridad
  // Groq x6, Cerebras x3, Together x4, Gemini x4, Mistral x2, OpenRouter x4
  const providers: (() => { client: any; provider: string } | null)[] = [
    // ⚡ Groq (más rápido, 6 keys)
    ...Array(6).fill(null).map(() => () => {
      const c = getGroqClient();
      return c ? { client: c, provider: 'groq' } : null;
    }),
    // 🧠 Cerebras (velocidad extrema, 3 keys)
    ...Array(3).fill(null).map(() => () => {
      const c = getCerebrasClient();
      return c ? { client: c, provider: 'cerebras' } : null;
    }),
    // 🤝 Together (gran capacidad, 4 keys)
    ...Array(4).fill(null).map(() => () => {
      const c = getTogetherClient();
      return c ? { client: c, provider: 'together' } : null;
    }),
    // 🌟 Gemini (4 keys, 1500 req/día cada una)
    ...Array(4).fill(null).map(() => () => ({
      client: makeGeminiFakeClient(),
      provider: 'gemini',
    })),
    // 🇪🇺 Mistral
    ...Array(2).fill(null).map(() => () => {
      const c = getMistralClient();
      return c ? { client: c, provider: 'mistral' } : null;
    }),
    // 🌐 OpenRouter (último recurso)
    ...Array(4).fill(null).map(() => () => {
      const c = getOpenRouterClient();
      return c ? { client: c, provider: 'openrouter' } : null;
    }),
  ];

  for (let attempt = 0; attempt < providers.length; attempt++) {
    try {
      const p = providers[attempt]();
      if (!p) {
        console.warn(`⚠️ Provider no disponible en intento ${attempt + 1}`);
        continue;
      }
      const result = await fn(p.client, (m) => adaptModel(m, p.provider));
      console.log(`✅ ${p.provider} funcionó en intento ${attempt + 1}`);
      return result;
    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️ Intento ${attempt + 1} (${err?.message?.slice(0, 50)})`);
      await new Promise(r => setTimeout(r, 200));
    }
  }

  throw lastError || new Error('Todas las IAs fallaron');
};
