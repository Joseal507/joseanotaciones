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

const key =
  process.env.CEREBRAS_API_KEY ||
  process.env.CEREBRAS_API_KEY_2 ||
  process.env.CEREBRAS_API_KEY_3 ||
  process.env.CEREBRAS_API_KEY_4 ||
  process.env.CEREBRAS_API_KEY_5;

if (!key) throw new Error('No hay CEREBRAS_API_KEY');

async function testPayload(name, body) {
  const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const txt = await res.text();
  console.log(`\n=== ${name} status=${res.status} ===`);
  console.log(txt.slice(0, 2500));

  try {
    const data = JSON.parse(txt);
    console.log('CHOICE0:', JSON.stringify(data?.choices?.[0], null, 2)?.slice(0, 1500));
  } catch {}
}

for (const url of [
  'https://api.cerebras.ai/v1/models',
  'https://api.cerebras.ai/public/v1/models',
]) {
  try {
    const res = await fetch(url, {
      headers: url.includes('/public/') ? {} : { Authorization: `Bearer ${key}` },
    });
    console.log(`\n=== MODELS ${res.status} ${url} ===`);
    console.log((await res.text()).slice(0, 2500));
  } catch (e) {
    console.log('MODELS ERROR:', e.message);
  }
}

const model = process.env.CEREBRAS_MODEL || 'gpt-oss-120b';

await testPayload('basic', {
  model,
  messages: [{ role: 'user', content: 'Say exactly OK.' }],
  temperature: 0,
  max_tokens: 32,
});

await testPayload('max_completion_tokens', {
  model,
  messages: [{ role: 'user', content: 'Say exactly OK.' }],
  temperature: 0,
  max_completion_tokens: 32,
});

await testPayload('with system', {
  model,
  messages: [
    { role: 'system', content: 'Output only the answer. No reasoning.' },
    { role: 'user', content: 'Say exactly OK.' },
  ],
  temperature: 0,
  max_tokens: 32,
});

await testPayload('longer', {
  model,
  messages: [{ role: 'user', content: 'Reply with one short sentence saying the system works.' }],
  temperature: 0.2,
  max_tokens: 128,
});
