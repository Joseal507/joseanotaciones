import OpenAI from 'openai';

// ==================== CONFIGURACIÓN DE KEYS ====================
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

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ==================== ESTADO DE KEYS ====================
const keyStatus = new Map<string, number>(); // key → timestamp de desbloqueo
let currentGroqIndex = 0;
let currentGeminiIndex = 0;

// ==================== FUNCIONES DE ROTACIÓN ====================
const getNextGroqKey = (): string => {
  const now = Date.now();
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const idx = (currentGroqIndex + i) % GROQ_KEYS.length;
    const key = GROQ_KEYS[idx];
    if (!keyStatus.has(key) || now >= keyStatus.get(key)!) {
      currentGroqIndex = (idx + 1) % GROQ_KEYS.length;
      return key;
    }
  }
  return GROQ_KEYS[0];
};

const getNextGeminiKey = (): string => {
  const now = Date.now();
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const idx = (currentGeminiIndex + i) % GEMINI_KEYS.length;
    const key = GEMINI_KEYS[idx];
    if (!keyStatus.has(key) || now >= keyStatus.get(key)!) {
      currentGeminiIndex = (idx + 1) % GEMINI_KEYS.length;
      return key;
    }
  }
  return GEMINI_KEYS[0];
};

export const markKeyAsBlocked = (key: string, seconds = 60) => {
  keyStatus.set(key, Date.now() + seconds * 1000);
  console.warn(`🔴 Key bloqueada por ${seconds}s → ${key.slice(0, 15)}...`);
};

// ==================== CLIENTES ====================
export const getGroqClient = () => {
  const key = getNextGroqKey();
  const client = new OpenAI({
    apiKey: key,
    baseURL: 'https://api.groq.com/openai/v1',
  }) as OpenAI & { _provider: string; _key: string };

  client._provider = 'groq';
  client._key = key;
  return client;
};

export const getGeminiClient = () => {
  const key = getNextGeminiKey();
  const client = new OpenAI({
    apiKey: key,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  }) as OpenAI & { _provider: string; _key: string };

  client._provider = 'gemini';
  client._key = key;
  return client;
};

export const getOpenRouterClient = () => {
  const client = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://joseanotacioness.vercel.app',
      'X-Title': 'Jose Anotaciones',
    },
  }) as OpenAI & { _provider: string };

  client._provider = 'openrouter';
  return client;
};

// ==================== REQUEST INTELIGENTE ====================
export const aiRequest = async <T>(
  fn: (client: OpenAI) => Promise<T>,
  maxRetries = 8
): Promise<T> => {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let client: OpenAI & { _provider?: string; _key?: string };

    if (attempt < 6) {
      client = getGroqClient();
    } else if (attempt < 7) {
      client = getGeminiClient();
    } else {
      client = getOpenRouterClient();
    }

    try {
      const result = await fn(client);
      console.log(`✅ Usando ${client._provider || 'unknown'} (attempt ${attempt + 1})`);
      return result;
    } catch (err: any) {
      lastError = err;

      if (err?.status === 429 || err?.message?.includes('rate') || err?.status === 413) {
        if (client._key) {
          const retryAfter = parseInt(err?.headers?.['retry-after'] || '60');
          markKeyAsBlocked(client._key, retryAfter);
        }
        console.warn(`⚠️ Rate limit en ${client._provider}, intentando siguiente proveedor...`);
        await new Promise(r => setTimeout(r, 800));
        continue;
      }

      throw err;
    }
  }

  console.error('❌ Todas las IAs fallaron');
  throw lastError;
};
