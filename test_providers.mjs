import OpenAI from 'openai';
import { readFileSync } from 'fs';

// Leer .env.local
const env = readFileSync('.env.local', 'utf-8');
const getEnv = (key) => {
  const match = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match ? match[1].trim() : null;
};

const TEST_MSG = [
  { role: 'user', content: 'Say exactly: OK' }
];

const test = async (name, client, model) => {
  try {
    const start = Date.now();
    const r = await client.chat.completions.create({
      model,
      messages: TEST_MSG,
      max_tokens: 10,
      temperature: 0,
    });
    const text = r.choices?.[0]?.message?.content || '';
    const ms = Date.now() - start;
    console.log(`✅ ${name.padEnd(30)} ${ms}ms  → "${text.trim().slice(0, 30)}"`);
    return true;
  } catch (err) {
    const msg = err?.message?.slice(0, 60) || 'unknown';
    const status = err?.status || '';
    console.log(`❌ ${name.padEnd(30)} [${status}] ${msg}`);
    return false;
  }
};

const results = { ok: 0, fail: 0 };

// ── CEREBRAS ──────────────────────────────────────────────────────────────────
const cerebrasKeys = ['CEREBRAS_API_KEY','CEREBRAS_API_KEY_2','CEREBRAS_API_KEY_3','CEREBRAS_API_KEY_4','CEREBRAS_API_KEY_5'];
for (const k of cerebrasKeys) {
  const key = getEnv(k);
  if (!key) { console.log(`⚪ ${k.padEnd(30)} no configurada`); continue; }
  const client = new OpenAI({ apiKey: key, baseURL: 'https://api.cerebras.ai/v1' });
  const ok = await test(`Cerebras (${k.slice(-1)})`, client, 'qwen-3-235b-a22b-instruct-2507');
  ok ? results.ok++ : results.fail++;
}

// ── GROQ ──────────────────────────────────────────────────────────────────────
const groqKeys = ['GROQ_API_KEY','GROQ_API_KEY_2','GROQ_API_KEY_3','GROQ_API_KEY_4','GROQ_API_KEY_5','GROQ_API_KEY_6','GROQ_API_KEY_7'];
for (const k of groqKeys) {
  const key = getEnv(k);
  if (!key) { console.log(`⚪ ${k.padEnd(30)} no configurada`); continue; }
  const client = new OpenAI({ apiKey: key, baseURL: 'https://api.groq.com/openai/v1' });
  const ok = await test(`Groq (${k.replace('GROQ_API_KEY','')||'1'})`, client, 'llama-3.3-70b-versatile');
  ok ? results.ok++ : results.fail++;
}

// ── TOGETHER ──────────────────────────────────────────────────────────────────
const togetherKeys = ['TOGETHER_API_KEY','TOGETHER_API_KEY_2','TOGETHER_API_KEY_3','TOGETHER_API_KEY_4'];
const seenTogether = new Set();
for (const k of togetherKeys) {
  const key = getEnv(k);
  if (!key || seenTogether.has(key)) { if(key) console.log(`⚪ ${k.padEnd(30)} duplicada`); continue; }
  seenTogether.add(key);
  const client = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
  const ok = await test(`Together (${k.replace('TOGETHER_API_KEY','')||'1'})`, client, 'meta-llama/Llama-3.3-70B-Instruct-Turbo');
  ok ? results.ok++ : results.fail++;
}

// ── SAMBANOVA ─────────────────────────────────────────────────────────────────
const sambanovaKeys = ['SAMBANOVA_API_KEY','SAMBANOVA_API_KEY_2','SAMBANOVA_API_KEY_3','SAMBANOVA_API_KEY_4','SAMBANOVA_API_KEY_5'];
for (const k of sambanovaKeys) {
  const key = getEnv(k);
  if (!key) continue;
  const client = new OpenAI({ apiKey: key, baseURL: 'https://api.sambanova.ai/v1' });
  const ok = await test(`SambaNova (${k.slice(-1)})`, client, 'Meta-Llama-3.3-70B-Instruct');
  ok ? results.ok++ : results.fail++;
}

// ── HUGGINGFACE ───────────────────────────────────────────────────────────────
const hfKeys = ['HF_API_KEY','HF_API_KEY_2','HF_API_KEY_3','HF_API_KEY_4','HF_API_KEY_5'];
for (const k of hfKeys) {
  const key = getEnv(k);
  if (!key) continue;
  const client = new OpenAI({ apiKey: key, baseURL: 'https://router.huggingface.co/v1' });
  const ok = await test(`HuggingFace (${k.slice(-1)})`, client, 'meta-llama/Llama-3.3-70B-Instruct');
  ok ? results.ok++ : results.fail++;
}

// ── GEMINI ────────────────────────────────────────────────────────────────────
const geminiKeys = ['GEMINI_API_KEY','GEMINI_API_KEY_2','GEMINI_API_KEY_3','GEMINI_API_KEY_4','GEMINI_API_KEY_5'];
for (const k of geminiKeys) {
  const key = getEnv(k);
  if (!key) continue;
  try {
    const start = Date.now();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say exactly: OK' }] }], generationConfig: { maxOutputTokens: 10 } }),
    });
    const ms = Date.now() - start;
    if (res.status === 429) {
      console.log(`⚠️  ${'Gemini (' + k.slice(-1) + ')'.padEnd(28)} [429] rate limit`);
      results.fail++;
    } else if (res.ok) {
      const d = await res.json();
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log(`✅ ${'Gemini (' + k.slice(-1) + ')'.padEnd(28)} ${ms}ms  → "${text.trim().slice(0,30)}"`);
      results.ok++;
    } else {
      console.log(`❌ ${'Gemini (' + k.slice(-1) + ')'.padEnd(28)} [${res.status}]`);
      results.fail++;
    }
  } catch(e) {
    console.log(`❌ ${'Gemini (' + k.slice(-1) + ')'.padEnd(28)} ${e.message?.slice(0,50)}`);
    results.fail++;
  }
}

// ── OPENROUTER ────────────────────────────────────────────────────────────────
const orKey = getEnv('OPENROUTER_API_KEY');
if (orKey) {
  const client = new OpenAI({
    apiKey: orKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://studyal.com', 'X-Title': 'StudyAL' },
  });
  const ok = await test('OpenRouter', client, 'meta-llama/llama-3.3-70b-instruct');
  ok ? results.ok++ : results.fail++;
}

// ── COHERE ────────────────────────────────────────────────────────────────────
const cohereKey = getEnv('COHERE_API_KEY');
if (cohereKey) {
  const client = new OpenAI({ apiKey: cohereKey, baseURL: 'https://api.cohere.com/compatibility/v1' });
  const ok = await test('Cohere', client, 'command-r-plus');
  ok ? results.ok++ : results.fail++;
}

// ── MISTRAL ───────────────────────────────────────────────────────────────────
const mistralKey = getEnv('MISTRAL_API_KEY');
if (mistralKey) {
  const client = new OpenAI({ apiKey: mistralKey, baseURL: 'https://api.mistral.ai/v1' });
  const ok = await test('Mistral', client, 'mistral-small-latest');
  ok ? results.ok++ : results.fail++;
}

// ── CLOUDFLARE ────────────────────────────────────────────────────────────────
const cfAccount = getEnv('CLOUDFLARE_ACCOUNT_ID');
const cfToken = getEnv('CLOUDFLARE_API_TOKEN');
if (cfAccount && cfToken) {
  try {
    const start = Date.now();
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Say exactly: OK' }] }),
      }
    );
    const ms = Date.now() - start;
    const d = await res.json();
    const text = d?.result?.response || '';
    if (text) {
      console.log(`✅ ${'Cloudflare'.padEnd(30)} ${ms}ms  → "${text.trim().slice(0,30)}"`);
      results.ok++;
    } else {
      console.log(`❌ ${'Cloudflare'.padEnd(30)} sin respuesta: ${JSON.stringify(d).slice(0,60)}`);
      results.fail++;
    }
  } catch(e) {
    console.log(`❌ ${'Cloudflare'.padEnd(30)} ${e.message?.slice(0,50)}`);
    results.fail++;
  }
}

// ── RESUMEN ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(55));
console.log(`✅ Funcionando: ${results.ok}`);
console.log(`❌ Fallando:    ${results.fail}`);
console.log(`📊 Total:       ${results.ok + results.fail}`);
console.log('─'.repeat(55));
