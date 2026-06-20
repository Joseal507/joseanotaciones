import fs from 'fs';

function loadEnv(path = '.env.local') {
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#') || !raw.includes('=')) continue;
    const [k, ...rest] = raw.split('=');
    process.env[k.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

function firstKey(base) {
  const names = Object.keys(process.env)
    .filter(k => k === base || k.startsWith(base + '_'))
    .sort();
  for (const n of names) if (process.env[n]) return { name: n, key: process.env[n] };
  return null;
}

const candidates = [
  {
    provider: 'cerebras',
    key: firstKey('CEREBRAS_API_KEY'),
    url: 'https://api.cerebras.ai/v1/chat/completions',
    models: [
      process.env.CEREBRAS_MODEL,
      'gpt-oss-120b',
      'gpt-oss-20b',
      'llama3.1-8b',
      'llama-3.1-8b',
      'qwen-3-235b-a22b-instruct-2507',
      'qwen-3-32b',
    ].filter(Boolean),
  },
  {
    provider: 'sambanova',
    key: firstKey('SAMBANOVA_API_KEY'),
    url: 'https://api.sambanova.ai/v1/chat/completions',
    models: [
      process.env.SAMBANOVA_MODEL,
      'Meta-Llama-3.3-70B-Instruct',
      'Meta-Llama-3.1-8B-Instruct',
      'Llama-3.3-Swallow-70B-Instruct-v0.4',
      'Qwen3-32B',
      'DeepSeek-R1-Distill-Llama-70B',
      'DeepSeek-R1',
    ].filter(Boolean),
  },
  {
    provider: 'hf',
    key: firstKey('HF_API_KEY'),
    url: 'https://router.huggingface.co/v1/chat/completions',
    models: [
      process.env.HF_MODEL,
      'meta-llama/Llama-3.3-70B-Instruct',
      'meta-llama/Llama-3.1-8B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen2.5-7B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3',
    ].filter(Boolean),
  },
];

async function test(provider, url, key, model, extra = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Responde exactamente: OK' }],
      temperature: 0,
      max_tokens: 16,
      ...extra,
    }),
  });

  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';

  return {
    ok: res.ok && String(content).trim().length > 0,
    status: res.status,
    ms: Date.now() - started,
    content: String(content).trim(),
    msg: res.ok ? String(content).trim() : (data?.error?.message || raw).slice(0, 220),
    raw: raw.slice(0, 220),
  };
}

console.log('=== ALAI MODEL DISCOVERY ===');

const winners = [];

for (const c of candidates) {
  console.log(`\n## ${c.provider}`);
  if (!c.key) {
    console.log('SKIP no key');
    continue;
  }

  const seen = [...new Set(c.models)];
  for (const model of seen) {
    try {
      const r = await test(c.provider, c.url, c.key.key, model);
      console.log(`${r.ok ? '✅' : '❌'} ${model} status=${r.status} ms=${r.ms} msg=${r.msg || '(empty)'}`);

      if (!r.ok && c.provider === 'cerebras' && r.status === 200) {
        const r2 = await test(c.provider, c.url, c.key.key, model, {
          reasoning_effort: 'low',
        });
        console.log(`${r2.ok ? '✅' : '❌'} ${model} +reasoning_effort=low status=${r2.status} ms=${r2.ms} msg=${r2.msg || '(empty)'}`);
        if (r2.ok) winners.push({ provider: c.provider, model, extra: 'reasoning_effort=low' });
      }

      if (r.ok) winners.push({ provider: c.provider, model });
    } catch (e) {
      console.log(`❌ ${model} error=${String(e?.message || e).slice(0, 180)}`);
    }
  }
}

console.log('\n=== WINNERS ===');
if (!winners.length) {
  console.log('No winners found.');
} else {
  for (const w of winners) console.log(`${w.provider}: ${w.model}${w.extra ? ' (' + w.extra + ')' : ''}`);
}
