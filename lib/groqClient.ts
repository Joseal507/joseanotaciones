import OpenAI from 'openai';

const getKeys = (): string[] => {
  const keys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
  ].filter(Boolean) as string[];

  if (keys.length === 0) throw new Error('No GROQ API keys configured');
  return keys;
};

// ✅ Trackear qué keys están bloqueadas y cuándo se desbloquean
const keyStatus = new Map<string, number>(); // key → timestamp de desbloqueo

let currentIndex = 0;

const getNextAvailableKey = (): string | null => {
  const keys = getKeys();
  const now = Date.now();

  // Intentar encontrar una key disponible
  for (let i = 0; i < keys.length; i++) {
    const idx = (currentIndex + i) % keys.length;
    const key = keys[idx];
    const unblockAt = keyStatus.get(key) || 0;

    if (now >= unblockAt) {
      currentIndex = (idx + 1) % keys.length;
      return key;
    }
  }

  // Todas bloqueadas → usar la que se desbloquea más pronto
  let earliestKey = keys[0];
  let earliestTime = keyStatus.get(keys[0]) || 0;

  for (const key of keys) {
    const unblockAt = keyStatus.get(key) || 0;
    if (unblockAt < earliestTime) {
      earliestTime = unblockAt;
      earliestKey = key;
    }
  }

  return earliestKey;
};

export const markKeyAsBlocked = (apiKey: string, retryAfterSeconds = 60) => {
  const unblockAt = Date.now() + retryAfterSeconds * 1000;
  keyStatus.set(apiKey, unblockAt);
  console.warn(`🔴 Groq key bloqueada por ${retryAfterSeconds}s`);
};

export const getGroqClient = (): OpenAI & { _currentKey: string } => {
  const key = getNextAvailableKey()!;

  const client = new OpenAI({
    apiKey: key,
    baseURL: 'https://api.groq.com/openai/v1',
  }) as OpenAI & { _currentKey: string };

  // ✅ Guardar la key usada para poder marcarla como bloqueada si falla
  client._currentKey = key;

  return client;
};

// ✅ Helper para usar en las rutas de API con retry automático
export const groqRequest = async <T>(
  fn: (client: OpenAI) => Promise<T>,
  maxRetries = 4,
): Promise<T> => {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const client = getGroqClient();

    try {
      return await fn(client);
    } catch (err: any) {
      lastError = err;

      // Si es rate limit, marcar la key como bloqueada
      if (err?.status === 429 || err?.message?.includes('rate') || err?.message?.includes('429')) {
        const retryAfter = parseInt(err?.headers?.['retry-after'] || '60');
        markKeyAsBlocked((client as any)._currentKey, retryAfter);
        console.warn(`⚠️ Rate limit en attempt ${attempt + 1}, probando otra key...`);

        // Esperar un momento antes de reintentar
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Si no es rate limit, lanzar el error inmediatamente
      throw err;
    }
  }

  throw lastError;
};