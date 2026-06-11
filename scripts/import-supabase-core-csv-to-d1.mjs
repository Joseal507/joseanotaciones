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
  const headers = rows.shift() || [];
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function jsonValue(v, fallback) {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

async function post(api, path, payload) {
  const res = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
}

function hasFile(path) {
  return fs.existsSync(path) && fs.statSync(path).size > 0;
}

loadEnvLocal();

const api = process.env.STUDYAL_API_URL;
if (!api) throw new Error('Falta STUDYAL_API_URL');

const report = {};

if (hasFile('user_profiles_rows.csv')) {
  const rows = parseCSV(fs.readFileSync('user_profiles_rows.csv', 'utf8'));
  let ok = 0, fail = 0;
  for (const r of rows) {
    const userId = r.id || r.user_id;
    if (!userId) { fail++; continue; }

    try {
      await post(api, '/profiles/upsert', {
        user_id: userId,
        nombre: r.nombre || null,
        email: r.email || null,
        avatar_url: r.avatar_url || null,
        descripcion: r.descripcion || null,
        genero: r.genero || null,
        tipo_estudiante: r.tipo_estudiante || null,
        universidad: r.universidad || null,
        carrera: r.carrera || null,
        onboarding_completo: String(r.onboarding_completo).toLowerCase() !== 'false',
      });
      ok++;
    } catch (e) {
      fail++;
      console.error('profiles FAIL', userId, e.message);
    }
  }
  report.user_profiles = { rows: rows.length, ok, fail };
}

if (hasFile('user_settings_rows.csv')) {
  const rows = parseCSV(fs.readFileSync('user_settings_rows.csv', 'utf8'));
  let ok = 0, fail = 0;
  for (const r of rows) {
    const userId = r.user_id || r.id;
    if (!userId) { fail++; continue; }

    try {
      await post(api, '/settings/upsert', {
        user_id: userId,
        settings: jsonValue(r.datos || r.settings, {}),
      });
      ok++;
    } catch (e) {
      fail++;
      console.error('settings FAIL', userId, e.message);
    }
  }
  report.user_settings = { rows: rows.length, ok, fail };
}

if (hasFile('perfil_estudio_rows.csv')) {
  const rows = parseCSV(fs.readFileSync('perfil_estudio_rows.csv', 'utf8'));
  let ok = 0, fail = 0;
  for (const r of rows) {
    const userId = r.user_id || r.id;
    if (!userId) { fail++; continue; }

    try {
      await post(api, '/study-profiles/upsert', {
        user_id: userId,
        profile: jsonValue(r.datos || r.profile, {}),
      });
      ok++;
    } catch (e) {
      fail++;
      console.error('study_profile FAIL', userId, e.message);
    }
  }
  report.perfil_estudio = { rows: rows.length, ok, fail };
}

if (hasFile('agenda_rows.csv')) {
  const rows = parseCSV(fs.readFileSync('agenda_rows.csv', 'utf8'));
  let ok = 0, fail = 0;
  for (const r of rows) {
    const userId = r.user_id || r.id;
    if (!userId) { fail++; continue; }

    try {
      await post(api, '/agenda/upsert', {
        user_id: userId,
        asignaciones: jsonValue(r.asignaciones, []),
        objetivos: jsonValue(r.objetivos, []),
      });
      ok++;
    } catch (e) {
      fail++;
      console.error('agenda FAIL', userId, e.message);
    }
  }
  report.agenda = { rows: rows.length, ok, fail };
}

if (hasFile('horario_rows.csv')) {
  const rows = parseCSV(fs.readFileSync('horario_rows.csv', 'utf8'));
  let ok = 0, fail = 0;
  for (const r of rows) {
    const userId = r.user_id || r.id;
    if (!userId) { fail++; continue; }

    try {
      await post(api, '/horario/upsert', {
        user_id: userId,
        horario: jsonValue(r.datos || r.horario, {}),
      });
      ok++;
    } catch (e) {
      fail++;
      console.error('horario FAIL', userId, e.message);
    }
  }
  report.horario = { rows: rows.length, ok, fail };
}

console.log(JSON.stringify(report, null, 2));
