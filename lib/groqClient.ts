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

const keyStatus = new Map<string, number>();
let currentGroqIndex = 0;
let currentGeminiIndex = 0;
let currentCerebrasIndex = 0;
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

const callGemini = async (messages: any[], maxTokens: number = 2000): Promise<string> => {
  const key = getNextKey(GEMINI_KEYS, currentGeminiIndex, (i) => currentGeminiIndex = i);
  if (!key) throw new Error('No Gemini keys');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', generationConfig: { maxOutputTokens: maxTokens } });
  const prompt = messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');
  const result = await model.generateContent(prompt);
  return result.response.text();
};

const callCloudflare = async (messages: any[]): Promise<string> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('Cloudflare no configurado');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error('Cloudflare Error');
  return data.result.response;
};

export const getGroqClient = () => {
  const key = getNextKey(GROQ_KEYS, currentGroqIndex, (i) => currentGroqIndex = i);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }) : null;
};

export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>,
): Promise<T> => {
  let lastError: any;
  const providers: (() => { client: any; provider: string } | null)[] = [
    // 1. Groq (Velocidad)
    ...Array(6).fill(null).map(() => () => { const c = getGroqClient(); return c ? { client: c, provider: 'groq' } : null; }),
    // 2. Cerebras (Velocidad extrema)
    ...Array(4).fill(null).map(() => () => { 
        const k = getNextKey(CEREBRAS_KEYS, currentCerebrasIndex, (i) => currentCerebrasIndex = i);
        return k ? { client: new OpenAI({ apiKey: k, baseURL: 'https://api.cerebras.ai/v1' }), provider: 'cerebras' } : null;
    }),
    // 3. SambaNova (Inteligencia Llama 405B)
    ...Array(4).fill(null).map(() => () => { 
        const k = getNextKey(SAMBANOVA_KEYS, currentSambanovaIndex, (i) => currentSambanovaIndex = i);
        return k ? { client: new OpenAI({ apiKey: k, baseURL: 'https://api.sambanova.ai/v1' }), provider: 'sambanova' } : null;
    }),
    // 4. Gemini 2.0 (Fiabilidad)
    ...Array(4).fill(null).map(() => () => ({ client: { chat: { completions: { create: async (p: any) => ({ choices: [{ message: { content: await callGemini(p.messages, p.max_tokens) } }] }) } } }, provider: 'gemini' })),
    // 5. Cloudflare (Tanque de reserva)
    () => ({ client: { chat: { completions: { create: async (p: any) => ({ choices: [{ message: { content: await callCloudflare(p.messages) } }] }) } } }, provider: 'cloudflare' }),
  ];

  for (let attempt = 0; attempt < providers.length; attempt++) {
    try {
      const p = providers[attempt]();
      if (!p) continue;
      const modelAdapter = (m: string) => {
        if (p.provider === 'groq') return 'llama-3.3-70b-versatile';
        if (p.provider === 'cerebras') return 'llama3.1-8b';
        if (p.provider === 'sambanova') return 'Meta-Llama-3.3-70B-Instruct';
        return m;
      };
      const result = await fn(p.client, modelAdapter);
      console.log(`✅ ${p.provider} OK`);
      return result;
    } catch (err: any) {
      lastError = err;
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw lastError || new Error('All providers failed');
};
