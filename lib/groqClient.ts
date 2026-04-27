import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
  process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
].filter(Boolean) as string[];

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

const CEREBRAS_KEYS = [
  process.env.CEREBRAS_API_KEY,
  process.env.CEREBRAS_API_KEY_2,
  process.env.CEREBRAS_API_KEY_3,
  process.env.CEREBRAS_API_KEY_4,
  process.env.CEREBRAS_API_KEY_5,
].filter(Boolean) as string[];

const SAMBANOVA_KEYS = [
  process.env.SAMBANOVA_API_KEY,
  process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3,
  process.env.SAMBANOVA_API_KEY_4,
  process.env.SAMBANOVA_API_KEY_5,
].filter(Boolean) as string[];

const HF_KEYS = [
  process.env.HF_API_KEY,
  process.env.HF_API_KEY_2,
  process.env.HF_API_KEY_3,
  process.env.HF_API_KEY_4,
  process.env.HF_API_KEY_5, // ← Nueva que vas a agregar
].filter(Boolean) as string[];

const keyStatus = new Map<string, number>();

const getNextKey = (keys: string[]) => {
  if (keys.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!keyStatus.has(key) || now >= keyStatus.get(key)!) {
      return key;
    }
  }
  return keys[Math.floor(Math.random() * keys.length)];
};

export const markKeyAsBlocked = (key: string, seconds = 60) => {
  keyStatus.set(key, Date.now() + seconds * 1000);
};

export const getGroqClient = () => {
  const key = getNextKey(GROQ_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }) : null;
};

const getHFClient = () => {
  const key = getNextKey(HF_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://router.huggingface.co/v1' }) : null;
};

const getCerebrasClient = () => {
  const key = getNextKey(CEREBRAS_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.cerebras.ai/v1' }) : null;
};

const getSambanovaClient = () => {
  const key = getNextKey(SAMBANOVA_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.sambanova.ai/v1' }) : null;
};

const callGemini = async (messages: any[], maxTokens: number = 2000): Promise<string> => {
  const key = getNextKey(GEMINI_KEYS);
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

  const providers = [
    // ⚡ Groq x7
    ...GROQ_KEYS.map(() => () => {
      const c = getGroqClient();
      return c ? { client: c, provider: 'groq' } : null;
    }),
    // 🧠 Cerebras x5
    ...CEREBRAS_KEYS.map(() => () => {
      const c = getCerebrasClient();
      return c ? { client: c, provider: 'cerebras' } : null;
    }),
    // 🦙 SambaNova x5
    ...SAMBANOVA_KEYS.map(() => () => {
      const c = getSambanovaClient();
      return c ? { client: c, provider: 'sambanova' } : null;
    }),
    // 🤗 HuggingFace x5
    ...HF_KEYS.map(() => () => {
      const c = getHFClient();
      return c ? { client: c, provider: 'hf' } : null;
    }),
    // 🌟 Gemini x5
    ...GEMINI_KEYS.map(() => () => ({
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
    // ☁️ Cloudflare x1
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
      console.warn(`⚠️ Intento ${attempt + 1} falló: ${err?.message?.slice(0, 50)}`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error('AI_EXHAUSTED');
};
