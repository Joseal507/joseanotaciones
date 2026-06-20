import fs from 'fs';

function loadEnv(path = '.env.local') {
  const txt = fs.readFileSync(path, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#') || !raw.includes('=')) continue;
    const [k, ...rest] = raw.split('=');
    const v = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    process.env[k.trim()] = v;
  }
}

loadEnv();

const mask = k => `${k.slice(0, 7)}...${k.slice(-4)}`;

function keys(base) {
  return Object.keys(process.env)
    .filter(k => k === base || k.startsWith(base + '_'))
    .sort((a,b) => {
      const na = a === base ? 1 : Number(a.replace(base + '_', '')) || 999;
      const nb = b === base ? 1 : Number(b.replace(base + '_', '')) || 999;
      return na - nb;
    })
    .map(name => ({ name, key: process.env[name] }))
    .filter(x => x.key);
}

function jitKeys() {
  return Object.keys(process.env)
    .filter(k => k === 'JIT' || /^JIT\d+$/.test(k))
    .sort((a,b) => {
      const na = a === 'JIT' ? 1 : Number(a.replace('JIT', '')) || 999;
      const nb = b === 'JIT' ? 1 : Number(b.replace('JIT', '')) || 999;
      return na - nb;
    })
    .map(name => ({ name, key: process.env[name] }))
    .filter(x => x.key);
}

const providers = [
  {
    provider: 'groq',
    keys: keys('GROQ_API_KEY'),
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    type: 'openai',
  },
  {
    provider: 'github/JIT',
    keys: jitKeys(),
    model: process.env.JIT_MODEL || process.env.GITHUB_MODEL || 'openai/gpt-4.1-mini',
    url: 'https://models.github.ai/inference/chat/completions',
    type: 'openai',
  },
  {
    provider: 'cerebras',
    keys: keys('CEREBRAS_API_KEY'),
    model: process.env.CEREBRAS_MODEL || 'qwen-3-235b-a22b-instruct-2507',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    type: 'openai',
  },
  {
    provider: 'sambanova',
    keys: keys('SAMBANOVA_API_KEY'),
    model: process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.3-70B-Instruct',
    url: 'https://api.sambanova.ai/v1/chat/completions',
    type: 'openai',
  },
  {
    provider: 'hf',
    keys: keys('HF_API_KEY'),
    model: process.env.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct',
    url: 'https://router.huggingface.co/v1/chat/completions',
    type: 'openai',
  },
  {
    provider: 'mistral',
    keys: keys('MISTRAL_API_KEY'),
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    url: 'https://api.mistral.ai/v1/chat/completions',
    type: 'openai',
  },
  {
    provider: 'gemini',
    keys: keys('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    type: 'gemini',
  },
];

async function testOpenAI(p, item) {
  const res = await fetch(p.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${item.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: 'user', content: 'Responde solo: OK' }],
      temperature: 0,
      max_tokens: 8,
    }),
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  const content = data?.choices?.[0]?.message?.content || '';

  return {
    ok: res.ok && !!content.trim(),
    status: res.status,
    msg: res.ok ? content.trim() : (data?.error?.message || text).slice(0, 160),
  };
}

async function testGemini(p, item) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${item.key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Responde solo: OK' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8 },
      }),
    }
  );

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return {
    ok: res.ok && !!content.trim(),
    status: res.status,
    msg: res.ok ? content.trim() : (data?.error?.message || text).slice(0, 160),
  };
}

console.log('=== ALAI ENV MODEL AUDIT ===');
console.log('No se imprimen secrets completos.\n');

for (const p of providers) {
  console.log(`\n## ${p.provider}`);
  console.log(`model: ${p.model}`);
  console.log(`keys: ${p.keys.length}`);

  if (!p.keys.length) {
    console.log('SKIP: no keys');
    continue;
  }

  for (const item of p.keys) {
    try {
      const r = p.type === 'gemini'
        ? await testGemini(p, item)
        : await testOpenAI(p, item);

      console.log(`${r.ok ? '✅' : '❌'} ${item.name} ${mask(item.key)} status=${r.status} msg=${r.msg}`);
    } catch (e) {
      console.log(`❌ ${item.name} ${mask(item.key)} error=${String(e?.message || e).slice(0, 160)}`);
    }
  }
}

console.log('\n=== MODELOS EN ENV ===');
for (const k of Object.keys(process.env).sort()) {
  if (/MODEL/.test(k)) console.log(`${k}=${process.env[k]}`);
}
