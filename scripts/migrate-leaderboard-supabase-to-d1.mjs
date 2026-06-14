import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const raw = fs.readFileSync('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    process.env[key] = value;
  }
}

loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const api = process.env.STUDYAL_API_URL;

console.log({
  hasSupabaseUrl: !!supabaseUrl,
  hasServiceKey: !!serviceKey,
  hasApi: !!api,
});

if (!supabaseUrl || !serviceKey || !api) {
  console.error('Faltan envs');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const { data, error } = await supabase
  .from('leaderboard')
  .select('*')
  .order('xp_total', { ascending: false });

if (error) {
  console.error('Error leyendo leaderboard Supabase:', error);
  process.exit(1);
}

const rows = data || [];
const backupPath = `backups/supabase-export/leaderboard-${Date.now()}.json`;
fs.mkdirSync('backups/supabase-export', { recursive: true });
fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));

console.log('Backup creado:', backupPath);
console.log('Filas encontradas:', rows.length);

let ok = 0;
let fail = 0;

for (const row of rows) {
  const payload = {
    user_id: row.user_id,
    nombre: row.nombre,
    email: row.email,
    avatar_url: row.avatar_url,
    xp_total: row.xp_total ?? 0,
    flashcards_estudiadas: row.flashcards_estudiadas ?? 0,
    racha_actual: row.racha_actual ?? 0,
    mejor_racha: row.mejor_racha ?? 0,
    precision_global: row.precision_global ?? 0,
    visible_leaderboard: row.visible_leaderboard !== false,
    descripcion: row.descripcion,
    genero: row.genero,
    tipo_estudiante: row.tipo_estudiante,
    universidad: row.universidad,
    carrera: row.carrera,
    quizzes_completados: row.quizzes_completados ?? 0,
  };

  try {
    const res = await fetch(`${api}/leaderboard/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      fail++;
      console.error('FAIL', row.user_id, await res.text());
    } else {
      ok++;
    }
  } catch (err) {
    fail++;
    console.error('FAIL', row.user_id, err);
  }
}

console.log({ ok, fail });
