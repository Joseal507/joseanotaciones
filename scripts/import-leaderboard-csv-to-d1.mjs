import fs from 'fs';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    process.env[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, '');
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { cell += '"'; i++; continue; }
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { row.push(cell); cell = ''; continue; }
    if ((c === '\n' || c === '\r') && !q) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.length)) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v) {
  return String(v).toLowerCase() !== 'false';
}

loadEnvLocal();

const api = process.env.STUDYAL_API_URL;
if (!api) throw new Error('Falta STUDYAL_API_URL');

const rows = parseCSV(fs.readFileSync('leaderboard_rows.csv', 'utf8'));
console.log('Filas CSV:', rows.length);

let ok = 0, fail = 0;

for (const row of rows) {
  const payload = {
    user_id: row.user_id,
    nombre: row.nombre || null,
    email: row.email || null,
    avatar_url: row.avatar_url || null,
    xp_total: num(row.xp_total),
    flashcards_estudiadas: num(row.flashcards_estudiadas),
    racha_actual: num(row.racha_actual),
    mejor_racha: num(row.mejor_racha),
    precision_global: num(row.precision_global),
    visible_leaderboard: bool(row.visible_leaderboard),
    descripcion: row.descripcion || null,
    genero: row.genero || null,
    tipo_estudiante: row.tipo_estudiante || null,
    universidad: row.universidad || null,
    carrera: row.carrera || null,
    quizzes_completados: 0,
  };

  const res = await fetch(`${api}/leaderboard/upsert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) ok++;
  else {
    fail++;
    console.log('FAIL:', row.user_id, await res.text());
  }
}

console.log({ ok, fail });
