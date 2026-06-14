import fs from "fs";

const files = [
  "app/api/materials/[id]/route.ts",
  "app/api/materials/[id]/download-url/route.ts",
  "app/api/materials/upload/init/route.ts",
  "app/api/materials/upload/complete/route.ts",
  "app/api/enfoques/teorico/start/route.ts",
];

for (const file of files) {
  let s = fs.readFileSync(file, "utf8");

  s = s.replace(/import \{ createClient \} from '@supabase\/supabase-js';\n/g, "");
  s = s.replace(
    /import \{ NextRequest, NextResponse \} from 'next\/server';\n/,
    "import { NextRequest, NextResponse } from 'next/server';\nimport { getServerSession } from 'next-auth';\n"
  );

  const depth = file.includes("app/api/materials/[id]/download-url")
    ? "../../../../../lib/auth/options"
    : file.includes("app/api/materials/upload/")
      ? "../../../../../lib/auth/options"
      : file.includes("app/api/materials/[id]/")
        ? "../../../../lib/auth/options"
        : "../../../../../lib/auth/options";

  if (!s.includes("authOptions")) {
    s = s.replace(
      /import \{ getServerSession \} from 'next-auth';\n/,
      `import { getServerSession } from 'next-auth';\nimport { authOptions } from '${depth}';\n`
    );
  }

  const helper = `
async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}
`;

  if (!s.includes("async function getUser()")) {
    s = s.replace(/export const dynamic = 'force-dynamic';/, `${helper}\nexport const dynamic = 'force-dynamic';`);
  }

  s = s.replace(
    /\/\/ ─── Auth ───\s*const authHeader = req\.headers\.get\('authorization'\) \?\? '';\s*const token = authHeader\.replace\('Bearer ', ''\);\s*if \(!token\) \{\s*return NextResponse\.json\(\{ error: 'No autorizado' \}, \{ status: 401 \}\);\s*\}\s*const supabase = createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\s*\);\s*const \{ data: \{ user \}, error: authError \} = await supabase\.auth\.getUser\(token\);\s*if \(authError \|\| !user\) \{\s*return NextResponse\.json\(\{ error: 'Token inválido' \}, \{ status: 401 \}\);\s*\}/g,
    "const user = await getUser();\n    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });"
  );

  s = s.replace(
    /\/\/ ─── Auth ───\s*const token = \(req\.headers\.get\('authorization'\) \?\? ''\)\.replace\('Bearer ', ''\);\s*if \(!token\) \{\s*return NextResponse\.json\(\{ error: 'No autorizado' \}, \{ status: 401 \}\);\s*\}\s*const supabase = createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\s*\);\s*const \{ data: \{ user \}, error \} = await supabase\.auth\.getUser\(token\);\s*if \(error \|\| !user\) \{\s*return NextResponse\.json\(\{ error: 'Token inválido' \}, \{ status: 401 \}\);\s*\}/g,
    "const user = await getUser();\n    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });"
  );

  s = s.replace(
    /const token = \(req\.headers\.get\('authorization'\) \?\? ''\)\.replace\('Bearer ', ''\);\s*if \(!token\) return NextResponse\.json\(\{ error: 'No autorizado' \}, \{ status: 401 \}\);\s*const supabase = createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\s*\);\s*const \{ data: \{ user \}, error \} = await supabase\.auth\.getUser\(token\);\s*if \(error \|\| !user\) return NextResponse\.json\(\{ error: 'Token inválido' \}, \{ status: 401 \}\);/g,
    "const user = await getUser();\n    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });"
  );

  s = s.replace(
    /const token = \(req\.headers\.get\('authorization'\) \?\? ''\)\.replace\('Bearer ', ''\);\s*const supabase = createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\s*\);\s*const \{ data: \{ user \}, error \} = await supabase\.auth\.getUser\(token\);\s*if \(error \|\| !user\) \{\s*return NextResponse\.json\(\{ error: 'No autorizado' \}, \{ status: 401 \}\);\s*\}/g,
    "const user = await getUser();\n    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });"
  );

  fs.writeFileSync(file, s);
  console.log("patched", file);
}
