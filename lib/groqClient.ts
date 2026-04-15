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

let currentIndex = 0;

export const getGroqClient = (): OpenAI => {
  const keys = getKeys();
  const key = keys[currentIndex % keys.length];
  currentIndex = (currentIndex + 1) % keys.length;

  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.groq.com/openai/v1',
  });
};