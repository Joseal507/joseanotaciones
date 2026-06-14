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

  // quitar imports duplicados de getServerSession
  s = s.replace(/(?:import \{ getServerSession \} from 'next-auth';\n)+/g, "import { getServerSession } from 'next-auth';\n");

  // quitar cualquier bloque Supabase residual
  s = s.replace(/import \{ createClient \} from '@supabase\/supabase-js';\n/g, "");

  s = s.replace(
    /const supabase = createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\s*\);\s*const \{ data: \{ user \}, error \} = await supabase\.auth\.getUser\(token\);\s*if \(error \|\| !user\) return NextResponse\.json\(\{ error: 'Token invalido' \}, \{ status: 401 \}\);/g,
    "const user = await getUser();\n    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });"
  );

  s = s.replace(
    /const supabase = createClient\(\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL!,\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY!,\s*\);\s*const \{ data: \{ user \}, error \} = await supabase\.auth\.getUser\(token\);\s*if \(error \|\| !user\) return NextResponse\.json\(\{ error: 'Token inválido' \}, \{ status: 401 \}\);/g,
    "const user = await getUser();\n    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });"
  );

  s = s.replace(
    /const token = \(req\.headers\.get\('authorization'\) \?\? ''\)\.replace\('Bearer ', ''\);\s*if \(!token\) return NextResponse\.json\(\{ error: 'No autorizado' \}, \{ status: 401 \}\);\s*const user = await getUser\(\);/g,
    "const user = await getUser();"
  );

  s = s.replace(
    /const token = \(req\.headers\.get\('authorization'\) \?\? ''\)\.replace\('Bearer ', ''\);\s*const user = await getUser\(\);/g,
    "const user = await getUser();"
  );

  // quitar variables token colgadas si quedaron
  s = s.replace(/const token = \(req\.headers\.get\('authorization'\) \?\? ''\)\.replace\('Bearer ', ''\);\n\s*/g, "");

  fs.writeFileSync(file, s);
  console.log("fixed", file);
}
