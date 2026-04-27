import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6,
  process.env.GROQ_API_KEY_7,
].filter(Boolean) as string[];

const CEREBRAS_KEYS = [
  process.env.CEREBRAS_API_KEY, process.env.CEREBRAS_API_KEY_2,
  process.env.CEREBRAS_API_KEY_3, process.env.CEREBRAS_API_KEY_4,
  process.env.CEREBRAS_API_KEY_5,
].filter(Boolean) as string[];

const SAMBANOVA_KEYS = [
  process.env.SAMBANOVA_API_KEY, process.env.SAMBANOVA_API_KEY_2,
  process.env.SAMBANOVA_API_KEY_3, process.env.SAMBANOVA_API_KEY_4,
  process.env.SAMBANOVA_API_KEY_5,
].filter(Boolean) as string[];

const HF_KEYS = [
  process.env.HF_API_KEY, process.env.HF_API_KEY_2,
  process.env.HF_API_KEY_3, process.env.HF_API_KEY_4,
  process.env.HF_API_KEY_5,
].filter(Boolean) as string[];

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

const MISTRAL_KEY = process.env.MISTRAL_API_KEY || '';

const keyStatus = new Map<string, number>();

const getNextKey = (keys: string[]) => {
  if (keys.length === 0) return null;
  const now = Date.now();
  for (const key of keys) {
    if (!keyStatus.has(key) || now >= keyStatus.get(key)!) return key;
  }
  return keys[Math.floor(Math.random() * keys.length)];
};

export const markKeyAsBlocked = (key: string, seconds = 45) => {
  keyStatus.set(key, Date.now() + seconds * 1000);
};

export const getGroqClient = () => {
  const key = getNextKey(GROQ_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }) : null;
};

const getCerebrasClient = () => {
  const key = getNextKey(CEREBRAS_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.cerebras.ai/v1' }) : null;
};

const getSambanovaClient = () => {
  const key = getNextKey(SAMBANOVA_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.sambanova.ai/v1' }) : null;
};

const getHFClient = () => {
  const key = getNextKey(HF_KEYS);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://router.huggingface.co/v1' }) : null;
};

const getMistralClient = () => {
  return MISTRAL_KEY ? new OpenAI({ apiKey: MISTRAL_KEY, baseURL: 'https://api.mistral.ai/v1' }) : null;
};

const callGemini = async (messages: any[], maxTokens: number = 2000): Promise<string> => {
  const key = getNextKey(GEMINI_KEYS);
  if (!key) throw new Error('No Gemini keys');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { maxOutputTokens: maxTokens },
  });
  const prompt = messages.map((m: any) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${m.role}: ${content}`;
  }).join('\n');
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

const wrapAsOpenAI = (callFn: (msgs: any[], max?: number) => Promise<string>) => ({
  chat: {
    completions: {
      create: async (p: any) => ({
        choices: [{ message: { content: await callFn(p.messages, p.max_tokens) } }],
      }),
    },
  },
});

const adaptModel = (model: string, provider: string): string => {
  switch (provider) {
    case 'groq': return 'llama-3.3-70b-versatile';
    case 'cerebras': return 'qwen-3-235b-a22b-instruct-2507';
    case 'sambanova': return 'Meta-Llama-3.3-70B-Instruct';
    case 'hf': return 'meta-llama/Llama-3.3-70B-Instruct';
    case 'mistral': return 'mistral-small-latest';
    case 'gemini': return model;
    case 'cloudflare': return model;
    default: return model;
  }
};

export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>,
): Promise<T> => {
  let lastError: any;

  const providerFactories: Array<() => { client: any; provider: string } | null> = [
    // 1. Groq x7 (rápido, 70B)
    ...GROQ_KEYS.map(() => () => {
      const c = getGroqClient();
      return c ? { client: c, provider: 'groq' } : null;
    }),
    // 2. Cerebras x5 (rápido, 235B)
    ...CEREBRAS_KEYS.map(() => () => {
      const c = getCerebrasClient();
      return c ? { client: c, provider: 'cerebras' } : null;
    }),
    // 3. SambaNova x5 (70B)
    ...SAMBANOVA_KEYS.map(() => () => {
      const c = getSambanovaClient();
      return c ? { client: c, provider: 'sambanova' } : null;
    }),
    // 4. HuggingFace x5 (70B)
    ...HF_KEYS.map(() => () => {
      const c = getHFClient();
      return c ? { client: c, provider: 'hf' } : null;
    }),
    // 5. Gemini x5
    ...GEMINI_KEYS.map(() => () => ({
      client: wrapAsOpenAI(callGemini),
      provider: 'gemini',
    })),
    // 6. Mistral x1
    () => {
      const c = getMistralClient();
      return c ? { client: c, provider: 'mistral' } : null;
    },
    // 7. Cloudflare x1 (8B - último recurso)
    () => ({
      client: wrapAsOpenAI(callCloudflare),
      provider: 'cloudflare',
    }),
  ];

  for (let attempt = 0; attempt < providerFactories.length; attempt++) {
    try {
      const p = providerFactories[attempt]();
      if (!p) continue;
      const result = await fn(p.client, (m) => adaptModel(m, p.provider));
      console.log(`✅ ${p.provider} OK en intento ${attempt + 1}`);
      return result;
    } catch (err: any) {
      lastError = err;
      const msg = err?.message?.slice(0, 60) || 'unknown';
      console.warn(`⚠️ Intento ${attempt + 1} (${msg})`);
      await new Promise(r => setTimeout(r, 150));
    }
  }
  throw new Error('AI_EXHAUSTED');
};
