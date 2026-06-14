import fs from "fs";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

let materias = fs.readFileSync("app/materias/page.tsx", "utf8");
materias = materias.replace(
`      const session = (await import('../../lib/supabase').then(m => m.supabase.auth.getSession())).data.session;
      await fetch(\`/api/materials/\${materialId}\`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: \`Bearer \${session.access_token}\` } : {},
      });`,
`      await fetch(\`/api/materials/\${materialId}\`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });`
);
fs.writeFileSync("app/materias/page.tsx", materias);
console.log("patched app/materias/page.tsx");

w("app/api/sync/route.ts", `
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    migrated: true,
    message: 'Sync legacy desactivado: materias, agenda, horario y settings ahora usan D1.',
  });
}

export async function POST() {
  return NextResponse.json({
    success: true,
    migrated: true,
    message: 'Sync legacy desactivado: datos gestionados por endpoints D1.',
  });
}
`);

w("lib/sync.ts", `
export async function syncFromCloud() {
  return {
    success: true,
    migrated: true,
    message: 'Sync legacy desactivado: StudyAL usa D1.',
  };
}

export async function syncToCloud() {
  return {
    success: true,
    migrated: true,
    message: 'Sync legacy desactivado: StudyAL usa D1.',
  };
}

export async function syncAll() {
  return {
    success: true,
    migrated: true,
    message: 'Sync legacy desactivado: StudyAL usa D1.',
  };
}
`);
