import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
  process.env.GROQ_API_KEY_6,
].filter(Boolean) as string[];

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(Boolean) as string[];

const keyStatus = new Map<string, number>();
let currentGroqIndex = 0;
let currentGeminiIndex = 0;

// ── Contador global de tokens ──
let totalTokensHoy = 0;

const getNextGroqKey = (): string | null => {
  if (GROQ_KEYS.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const idx = (currentGroqIndex + i) % GROQ_KEYS.length;
    const key = GROQ_KEYS[idx];
    if (!keyStatus.has(key) || now >= keyStatus.get(key)!) {
      currentGroqIndex = (idx + 1) % GROQ_KEYS.length;
      return key;
    }
  }
  return null;
};

const getNextGeminiKey = (): string | null => {
  if (GEMINI_KEYS.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const idx = (currentGeminiIndex + i) % GEMINI_KEYS.length;
    const key = GEMINI_KEYS[idx];
    if (!keyStatus.has(key) || now >= keyStatus.get(key)!) {
      currentGeminiIndex = (idx + 1) % GEMINI_KEYS.length;
      return key;
    }
  }
  return null;
};

export const markKeyAsBlocked = (key: string, seconds = 60) => {
  keyStatus.set(key, Date.now() + seconds * 1000);
  console.warn(`🔴 Key bloqueada por ${seconds}s → ${key.slice(0, 15)}...`);
};

export const getGroqClient = () => {
  const key = getNextGroqKey();
  if (!key) return null;
  const client = new OpenAI({
    apiKey: key,
    baseURL: 'https://api.groq.com/openai/v1',
  }) as OpenAI & { _provider: string; _key: string };
  client._provider = 'groq';
  client._key = key;
  return client;
};

const getMistralClient = () => {
  if (!process.env.MISTRAL_API_KEY) return null;
  const client = new OpenAI({
    apiKey: process.env.MISTRAL_API_KEY,
    baseURL: 'https://api.mistral.ai/v1',
  }) as OpenAI & { _provider: string; _key: string };
  client._provider = 'mistral';
  client._key = process.env.MISTRAL_API_KEY;
  return client;
};

const getOpenRouterClient = () => {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://joseanotacioness.vercel.app',
      'X-Title': 'Jose Anotaciones',
    },
  }) as OpenAI & { _provider: string; _key: string };
  client._provider = 'openrouter';
  client._key = 'openrouter';
  return client;
};

const adaptModel = (model: string, provider: string): string => {
  if (provider === 'groq') return model;
  if (provider === 'mistral') {
    if (model.includes('vision') || model.includes('llama-4')) return 'pixtral-12b-2409';
    return 'mistral-small-latest';
  }
  if (provider === 'openrouter') {
    if (model.includes('vision') || model.includes('llama-4')) return 'meta-llama/llama-3.2-11b-vision-instruct:free';
    return 'meta-llama/llama-3.1-8b-instruct:free';
  }
  return model;
};

const callGemini = async (messages: any[], maxTokens: number = 2000): Promise<string> => {
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const key = getNextGeminiKey();
    if (!key) break;
    try {
      const genAI = new GoogleGenerativeAI(key);
      const geminiModel = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      });
      const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
      const userMsg = messages.find((m) => m.role === 'user')?.content || '';
      const prompt = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg;
      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text();

      // 📊 Log de tokens de Gemini
      const usage = result.response.usageMetadata;
      if (usage) {
        totalTokensHoy += usage.totalTokenCount || 0;
        console.log(`📊 Gemini Tokens → Prompt: ${usage.promptTokenCount} | Output: ${usage.candidatesTokenCount} | Total: ${usage.totalTokenCount} | 🔥 Acumulado hoy: ${totalTokensHoy}`);
      }

      return text;
    } catch (err: any) {
      if (err?.message?.includes('429') || err?.message?.includes('quota')) {
        markKeyAsBlocked(key, 60);
        console.warn(`⚠️ Gemini key agotada, probando siguiente...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Todas las keys de Gemini agotadas');
};

const runWithGemini = async <T>(
  fn: (client: OpenAI, model: (m: string) => string) => Promise<T>
): Promise<T> => {
  const fakeClient = {
    chat: {
      completions: {
        create: async (params: any) => {
          const text = await callGemini(params.messages, params.max_tokens);
          return {
            choices: [{ message: { content: text, role: 'assistant' }, finish_reason: 'stop', index: 0 }],
            usage: { total_tokens: 0 },
          };
        },
      },
    },
  } as unknown as OpenAI;
  return await fn(fakeClient, (m) => m);
};

export const groqRequest = async <T>(
  fn: (client: OpenAI, model: (m: string) => string) => Promise<T>,
  maxRetries = 10,
): Promise<T> => {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {

    // ── Groq (0-5) ──
    if (attempt < 6) {
      const client = getGroqClient();
      if (!client) {
        console.warn('⚠️ No hay keys de Groq, saltando a Gemini...');
        attempt = 5;
        continue;
      }
      try {
        const result = await fn(client, (m) => adaptModel(m, 'groq'));

        // 📊 Log de tokens de Groq
        if ((result as any)?.usage) {
          const usage = (result as any).usage;
          totalTokensHoy += usage.total_tokens || 0;
          console.log(`📊 Groq Tokens → Prompt: ${usage.prompt_tokens} | Completion: ${usage.completion_tokens} | Total: ${usage.total_tokens} | 🔥 Acumulado hoy: ${totalTokensHoy}`);
        }

        if (attempt > 0) console.log(`✅ groq funcionó en attempt ${attempt + 1}`);
        return result;
      } catch (err: any) {
        lastError = err;
        if (err?.status === 429 || err?.status === 413 || err?.message?.includes('rate')) {
          const retryAfter = parseInt(err?.headers?.['retry-after'] || '60');
          markKeyAsBlocked(client._key, retryAfter);
          console.warn(`⚠️ Rate limit groq attempt ${attempt + 1}, probando siguiente...`);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw err;
      }
    }

    // ── Gemini (6-7) ──
    if (attempt >= 6 && attempt < 8) {
      try {
        console.log(`🔄 Intentando Gemini...`);
        const result = await runWithGemini(fn);
        console.log(`✅ gemini funcionó en attempt ${attempt + 1}`);
        return result;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ Gemini falló: ${err?.message}, probando Mistral...`);
        attempt = 7;
        continue;
      }
    }

    // ── Mistral (8) ──
    if (attempt === 8) {
      const client = getMistralClient();
      if (client) {
        try {
          const result = await fn(client, () => 'mistral-small-latest');

          // 📊 Log de tokens de Mistral
          if ((result as any)?.usage) {
            const usage = (result as any).usage;
            totalTokensHoy += usage.total_tokens || 0;
            console.log(`📊 Mistral Tokens → Prompt: ${usage.prompt_tokens} | Completion: ${usage.completion_tokens} | Total: ${usage.total_tokens} | 🔥 Acumulado hoy: ${totalTokensHoy}`);
          }

          console.log(`✅ mistral funcionó en attempt ${attempt + 1}`);
          return result;
        } catch (err: any) {
          lastError = err;
          console.warn(`⚠️ Mistral falló: ${err?.message}, probando OpenRouter...`);
          continue;
        }
      }
    }

    // ── OpenRouter (9) ──
    if (attempt === 9) {
      const client = getOpenRouterClient();
      if (client) {
        try {
          const result = await fn(client, () => 'meta-llama/llama-3.1-8b-instruct:free');

          // 📊 Log de tokens de OpenRouter
          if ((result as any)?.usage) {
            const usage = (result as any).usage;
            totalTokensHoy += usage.total_tokens || 0;
            console.log(`📊 OpenRouter Tokens → Total: ${usage.total_tokens} | 🔥 Acumulado hoy: ${totalTokensHoy}`);
          }

          console.log(`✅ openrouter funcionó en attempt ${attempt + 1}`);
          return result;
        } catch (err: any) {
          lastError = err;
          console.warn(`⚠️ OpenRouter falló: ${err?.message}`);
        }
      }
    }
  }

  throw lastError || new Error('Todos los proveedores fallaron');
};
