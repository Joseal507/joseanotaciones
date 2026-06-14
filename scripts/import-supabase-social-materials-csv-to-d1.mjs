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

function q(v) {
  if (v === undefined || v === null || v === '') return 'NULL';
  return `'${String(v).replaceAll("'", "''")}'`;
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function b(v) {
  return String(v).toLowerCase() === 'true' ? 1 : 0;
}

async function d1(sql) {
  const { execSync } = await import('child_process');
  const cmd = `cd cloudflare/studyal-api && npx wrangler d1 execute studyal-dev-db --remote --command ${JSON.stringify(sql)}`;
  execSync(cmd, { stdio: 'inherit' });
}

loadEnvLocal();

const report = {};

async function importRows(file, table, mapper) {
  if (!hasFile(file)) {
    report[table] = { rows: 0, ok: 0, fail: 0, skipped: 'missing_file' };
    return;
  }

  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  let ok = 0, fail = 0;

  for (const row of rows) {
    try {
      await d1(mapper(row));
      ok++;
    } catch (e) {
      fail++;
      console.error(`${table} FAIL`, row.id || row.material_id || '', e.message);
    }
  }

  report[table] = { rows: rows.length, ok, fail };
}

await importRows('materials_rows.csv', 'materials', r => `
INSERT OR REPLACE INTO materials (
  id,user_id,tema_id,materia_id,nombre,extension,mime_type,size_bytes,storage_key,kind,
  upload_status,text_status,extracted_chars,pages_count,content_hash,last_error,created_at,updated_at
) VALUES (
  ${q(r.id)},${q(r.user_id)},${q(r.tema_id)},${q(r.materia_id)},${q(r.nombre)},${q(r.extension)},
  ${q(r.mime_type)},${n(r.size_bytes)},${q(r.storage_key)},${q(r.kind)},${q(r.upload_status)},${q(r.text_status)},
  ${r.extracted_chars ? n(r.extracted_chars) : 'NULL'},${r.pages_count ? n(r.pages_count) : 'NULL'},
  ${q(r.content_hash)},${q(r.last_error)},${q(r.created_at)},${q(r.updated_at)}
);
`);

await importRows('material_texts_rows.csv', 'material_texts', r => `
INSERT OR REPLACE INTO material_texts (material_id,text,chunks,created_at,updated_at)
VALUES (${q(r.material_id)},${q(r.text)},${q(r.chunks)},${q(r.created_at)},${q(r.updated_at)});
`);

await importRows('flashcard_decks_rows.csv', 'flashcard_decks', r => `
INSERT OR REPLACE INTO flashcard_decks (
  id,user_id,nombre,fecha_creacion,flashcards,materia_nombre,materia_color,tema_color,created_at,updated_at
) VALUES (
  ${q(r.id)},${q(r.user_id)},${q(r.nombre)},${q(r.fecha_creacion)},${q(r.flashcards)},
  ${q(r.materia_nombre)},${q(r.materia_color)},${q(r.tema_color)},${q(r.created_at)},${q(r.updated_at)}
);
`);

await importRows('comunidad_posts_rows.csv', 'comunidad_posts', r => `
INSERT OR REPLACE INTO comunidad_posts (
  id,user_id,tipo,titulo,descripcion,contenido,created_at,updated_at,views,comments_activos,
  es_partner,estudiados,materia_nombre,materia_color,materia_emoji,portada_url,user_avatar,user_nombre,video_url
) VALUES (
  ${q(r.id)},${q(r.user_id)},${q(r.tipo)},${q(r.titulo)},${q(r.descripcion)},${q(r.contenido)},
  ${q(r.created_at)},${q(r.updated_at)},${n(r.views)},${b(r.comments_activos)},${b(r.es_partner)},${n(r.estudiados)},
  ${q(r.materia_nombre)},${q(r.materia_color)},${q(r.materia_emoji)},${q(r.portada_url)},
  ${q(r.user_avatar)},${q(r.user_nombre)},${q(r.video_url)}
);
`);

await importRows('partners_rows.csv', 'partners', r => `
INSERT OR REPLACE INTO partners (id,sender_id,receiver_id,status,created_at,updated_at)
VALUES (${q(r.id)},${q(r.sender_id)},${q(r.receiver_id)},${q(r.status)},${q(r.created_at)},${q(r.updated_at)});
`);

await importRows('partner_chats_rows.csv', 'partner_chats', r => `
INSERT OR REPLACE INTO partner_chats (
  id,user1_id,user2_id,last_message,last_message_at,created_at,user1_deleted_at,user2_deleted_at,wallpaper_url,wallpaper_set_by
) VALUES (
  ${q(r.id)},${q(r.user1_id)},${q(r.user2_id)},${q(r.last_message)},${q(r.last_message_at)},${q(r.created_at)},
  ${q(r.user1_deleted_at)},${q(r.user2_deleted_at)},${q(r.wallpaper_url)},${q(r.wallpaper_set_by)}
);
`);

await importRows('partner_messages_rows.csv', 'partner_messages', r => `
INSERT OR REPLACE INTO partner_messages (
  id,chat_id,sender_id,content,type,metadata,created_at,duration,expires_at
) VALUES (
  ${q(r.id)},${q(r.chat_id)},${q(r.sender_id)},${q(r.content)},${q(r.type)},${q(r.metadata)},
  ${q(r.created_at)},${r.duration ? n(r.duration) : 'NULL'},${q(r.expires_at)}
);
`);

console.log(JSON.stringify(report, null, 2));
