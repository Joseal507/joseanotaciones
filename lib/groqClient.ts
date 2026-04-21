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

const SAMBANOVA_KEYS = [
  process.env.SAMBANOVA_API_KEY, process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3, process.env.SAMBANOVA_API_KEY_4,
].filter(Boolean) as string[];

const HF_KEYS = [
  process.env.HF_API_KEY, process.env.HF_API_KEY_2,
  process.env.HF_API_KEY_3, process.env.HF_API_KEY_4,
].filter(Boolean) as string[];

const keyStatus = new Map<string, number>();
let currentGroqIndex = 0;
let currentGeminiIndex = 0;
let currentCerebrasIndex = 0;
let currentSambanovaIndex = 0;
let currentHfIndex = 0;

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
};

// ✅ HF usa router.huggingface.co que es compatible con OpenAI SDK
const getHFClient = () => {
  const key = getNextKey(HF_KEYS, currentHfIndex, (i) => currentHfIndex = i);
  return key ? new OpenAI({
    apiKey: key,
    baseURL: 'https://router.huggingface.co/v1',
  }) : null;
};

export const getGroqClient = () => {
  const key = getNextKey(GROQ_KEYS, currentGroqIndex, (i) => currentGroqIndex = i);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }) : null;
};

const callGemini = async (messages: any[], maxTokens: number = 2000): Promise<string> => {
  const key = getNextKey(GEMINI_KEYS, currentGeminiIndex, (i) => currentGeminiIndex = i);
  if (!key) throw new Error('No Gemini keys');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { maxOutputTokens: maxTokens },
  });
  const prompt = messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');
  const result = await model.generateContent(prompt);
  return result.response.text();
};

const callCloudflare = async (messages: any[]): Promise<string> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('Cloudflare no configurado');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }
  );
  const data = await res.json() as any;
  return data.result.response;
};

const adaptModel = (model: string, provider: string): string => {
  if (provider === 'groq') return 'llama-3.3-70b-versatile';
  if (provider === 'cerebras') return 'llama3.1-8b';
  if (provider === 'sambanova') return 'Meta-Llama-3.3-70B-Instruct';
  if (provider === 'hf') return 'meta-llama/Llama-3.1-8B-Instruct';
  return model;
};

export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>,
): Promise<T> => {
  let lastError: any;

  const providers: (() => { client: any; provider: string } | null)[] = [
    // ⚡ Groq x6
    ...Array(6).fill(null).map(() => () => {
      const c = getGroqClient();
      return c ? { client: c, provider: 'groq' } : null;
    }),
    // 🧠 Cerebras x4
    ...Array(4).fill(null).map(() => () => {
      const k = getNextKey(CEREBRAS_KEYS, currentCerebrasIndex, (i) => currentCerebrasIndex = i);
      return k ? { client: new OpenAI({ apiKey: k, baseURL: 'https://api.cerebras.ai/v1' }), provider: 'cerebras' } : null;
    }),
    // 🦙 SambaNova x4
    ...Array(4).fill(null).map(() => () => {
      const k = getNextKey(SAMBANOVA_KEYS, currentSambanovaIndex, (i) => currentSambanovaIndex = i);
      return k ? { client: new OpenAI({ apiKey: k, baseURL: 'https://api.sambanova.ai/v1' }), provider: 'sambanova' } : null;
    }),
    // 🤗 HuggingFace x4 (router.huggingface.co - Llama 3.1 aprobado)
    ...Array(4).fill(null).map(() => () => {
      const c = getHFClient();
      return c ? { client: c, provider: 'hf' } : null;
    }),
    // 🌟 Gemini x4
    ...Array(4).fill(null).map(() => () => ({
      client: {
        chat: {
          completions: {
            create: async (p: any) => ({
              choices: [{ message: { content: await callGemini(p.messages, p.max_tokens) } }],
            }),
          },
        },
      },
      provider: 'gemini',
    })),
    // ☁️ Cloudflare
    () => ({
      client: {
        chat: {
          completions: {
            create: async (p: any) => ({
              choices: [{ message: { content: await callCloudflare(p.messages) } }],
            }),
          },
        },
      },
      provider: 'cloudflare',
    }),
  ];

  for (let attempt = 0; attempt < providers.length; attempt++) {
    try {
      const p = providers[attempt]();
      if (!p) continue;
      const result = await fn(p.client, (m) => adaptModel(m, p.provider));
      console.log(`✅ ${p.provider} OK en intento ${attempt + 1}`);
      return result;
    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️ Intento ${attempt + 1} (${err?.message?.slice(0, 50)})`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw lastError || new Error('All providers failed');
};
