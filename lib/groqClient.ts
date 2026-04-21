import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4, process.env.GROQ_API_KEY_5, process.env.GROQ_API_KEY_6
].filter(Boolean) as string[];

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4
].filter(Boolean) as string[];

const keyStatus = new Map<string, number>();
let currentGroqIndex = 0;
let currentGeminiIndex = 0;

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

// --- CLIENTES ---
export const getGroqClient = () => {
  const key = getNextKey(GROQ_KEYS, currentGroqIndex, (i) => currentGroqIndex = i);
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' }) : null;
};

const getCerebrasClient = () => {
  if (!process.env.CEREBRAS_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.CEREBRAS_API_KEY, baseURL: 'https://api.cerebras.ai/v1' });
};

const getTogetherClient = () => {
  if (!process.env.TOGETHER_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.TOGETHER_API_KEY, baseURL: 'https://api.together.xyz/v1' });
};

const getCohereClient = () => {
  if (!process.env.COHERE_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.COHERE_API_KEY, baseURL: 'https://api.cohere.ai/v1' });
};

const getMistralClient = () => {
  if (!process.env.MISTRAL_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.MISTRAL_API_KEY, baseURL: 'https://api.mistral.ai/v1' });
};

const getOpenRouterClient = () => {
  if (!process.env.OPENROUTER_API_KEY) return null;
  return new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY, 
    baseURL: 'https://openrouter.ai/api/v1'
  });
};

// --- ADAPTADOR ---
const adaptModel = (model: string, provider: string): string => {
  if (provider === 'groq') return model;
  if (provider === 'cerebras') return 'llama3.1-70b';
  if (provider === 'together') return 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
  if (provider === 'cohere') return 'command-r-plus';
  if (provider === 'mistral') return 'mistral-small-latest';
  return 'meta-llama/llama-3.1-8b-instruct:free';
};

// --- FALLBACK ENGINE ---
export const groqRequest = async <T>(
  fn: (client: any, model: (m: string) => string) => Promise<T>,
  maxRetries = 18
): Promise<T> => {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      let client: any = null;
      let provider = '';

      if (attempt < 6) { client = getGroqClient(); provider = 'groq'; }
      else if (attempt < 8) { client = getCerebrasClient(); provider = 'cerebras'; }
      else if (attempt < 10) { client = getTogetherClient(); provider = 'together'; }
      else if (attempt < 12) { client = getCohereClient(); provider = 'cohere'; }
      else if (attempt < 15) {
        // Fallback Gemini
        const key = getNextKey(GEMINI_KEYS, currentGeminiIndex, (i) => currentGeminiIndex = i);
        if (key) {
          console.log('🔄 Usando Gemini...');
          const genAI = new GoogleGenerativeAI(key);
          const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
          const fakeClient = { chat: { completions: { create: async (p: any) => {
            const prompt = p.messages.map((m:any) => `${m.role}: ${m.content}`).join('\n');
            const res = await model.generateContent(prompt);
            return { choices: [{ message: { content: res.response.text() } }] };
          }}}};
          return await fn(fakeClient, m => m);
        }
        continue;
      }
      else { client = getOpenRouterClient(); provider = 'openrouter'; }

      if (!client) continue;
      return await fn(client, (m) => adaptModel(m, provider));
    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️ Fallo intento ${attempt + 1}, saltando al siguiente...`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw lastError || new Error('Todas las IAs fallaron');
};
