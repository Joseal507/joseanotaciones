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

function hasFile(path) {
  return fs.existsSync(path) && fs.statSync(path).size > 0;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v) {
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 't';
}

function jsonMaybe(v, fallback = null) {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return v; }
}

async function post(api, path, payload) {
  const res = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

async function importFile(api, file, path, mapper) {
  if (!hasFile(file)) return { rows: 0, ok: 0, fail: 0, skipped: 'missing_file' };
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      await post(api, path, mapper(r));
      ok++;
    } catch (e) {
      fail++;
      console.error('FAIL', file, r.id || r.material_id || '', e.message);
    }
  }
  return { rows: rows.length, ok, fail };
}

loadEnvLocal();

const api = process.env.STUDYAL_API_URL;
if (!api) throw new Error('Falta STUDYAL_API_URL');

const report = {};

report.materials = await importFile(api, 'materials_rows.csv', '/materials/upsert', r => ({
  id: r.id,
  user_id: r.user_id,
  tema_id: r.tema_id,
  materia_id: r.materia_id,
  nombre: r.nombre,
  extension: r.extension,
  mime_type: r.mime_type,
  size_bytes: num(r.size_bytes),
  storage_key: r.storage_key,
  kind: r.kind,
  upload_status: r.upload_status || 'uploaded',
  text_status: r.text_status || 'pending',
  extracted_chars: r.extracted_chars ? num(r.extracted_chars) : null,
  pages_count: r.pages_count ? num(r.pages_count) : null,
  content_hash: r.content_hash || null,
  last_error: r.last_error || null,
  created_at: r.created_at || null,
}));

report.material_texts = await importFile(api, 'material_texts_rows.csv', '/material-texts/upsert', r => ({
  material_id: r.material_id,
  text: r.text || r.raw_text || null,
  chunks: jsonMaybe(r.chunks, null),
  created_at: r.created_at || null,
}));

report.flashcard_decks = await importFile(api, 'flashcard_decks_rows.csv', '/flashcard-decks/upsert', r => ({
  id: r.id,
  user_id: r.user_id,
  nombre: r.nombre,
  fecha_creacion: r.fecha_creacion || null,
  flashcards: jsonMaybe(r.flashcards, []),
  materia_nombre: r.materia_nombre || null,
  materia_color: r.materia_color || null,
  tema_color: r.tema_color || null,
  created_at: r.created_at || null,
}));

report.comunidad_posts = await importFile(api, 'comunidad_posts_rows.csv', '/comunidad-posts/upsert', r => ({
  id: r.id,
  user_id: r.user_id || null,
  tipo: r.tipo,
  titulo: r.titulo,
  descripcion: r.descripcion || null,
  contenido: r.contenido,
  created_at: r.created_at || null,
  views: num(r.views),
  comments_activos: !String(r.comments_activos).toLowerCase().includes('false'),
  es_partner: bool(r.es_partner),
  estudiados: num(r.estudiados),
  materia_nombre: r.materia_nombre || null,
  materia_color: r.materia_color || null,
  materia_emoji: r.materia_emoji || null,
  portada_url: r.portada_url || null,
  user_avatar: r.user_avatar || null,
  user_nombre: r.user_nombre || null,
  video_url: r.video_url || null,
}));

report.partners = await importFile(api, 'partners_rows.csv', '/partners/upsert', r => ({
  id: r.id,
  sender_id: r.sender_id,
  receiver_id: r.receiver_id,
  status: r.status,
  created_at: r.created_at || null,
}));

report.partner_chats = await importFile(api, 'partner_chats_rows.csv', '/partner-chats/upsert', r => ({
  id: r.id,
  user1_id: r.user1_id,
  user2_id: r.user2_id,
  last_message: r.last_message || null,
  last_message_at: r.last_message_at || null,
  created_at: r.created_at || null,
  user1_deleted_at: r.user1_deleted_at || null,
  user2_deleted_at: r.user2_deleted_at || null,
  wallpaper_url: r.wallpaper_url || null,
  wallpaper_set_by: r.wallpaper_set_by || null,
}));

report.partner_messages = await importFile(api, 'partner_messages_rows.csv', '/partner-messages/upsert', r => ({
  id: r.id,
  chat_id: r.chat_id,
  sender_id: r.sender_id,
  content: r.content,
  type: r.type || null,
  metadata: jsonMaybe(r.metadata, null),
  created_at: r.created_at || null,
  duration: r.duration ? num(r.duration) : null,
  expires_at: r.expires_at || null,
}));

console.log(JSON.stringify(report, null, 2));
