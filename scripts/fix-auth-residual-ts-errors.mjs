import fs from "fs";

function patch(file, fn) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  s = fn(s);
  fs.writeFileSync(file, s);
  console.log((s === before ? "unchanged" : "fixed"), file);
}

patch("components/materias/AnalisisTeorico.tsx", (s) => {
  s = s.replace("          authToken = session?.access_token || '';", "          authToken = '';");
  return s;
});

patch("components/materias/FlashcardSourceViewer.tsx", (s) => {
  s = s.replace(/const authHeader: HeadersInit = session\?\.access_token\s*\?\s*\{\s*Authorization:\s*`Bearer \$\{session\.access_token\}`\s*\}\s*:\s*\{\};/g, "const authHeader: HeadersInit = {};");
  s = s.replace(/headers:\s*authHeader,/g, "credentials: 'same-origin',");
  return s;
});

patch("components/materias/FlashcardsPage.tsx", (s) => {
  s = s.replace(/headers:\s*session\s*\?\s*\{\s*\}\s*:\s*\{\},/g, "credentials: 'same-origin',");
  s = s.replace(/if \(!session\) \{\s*console\.warn\(`⚠️ \[Flashcards\][\s\S]*?continue;\s*\}/g, "");
  s = s.replace(/\.\.\.\(session \? \{\s*\} : \{\}\),/g, "");
  return s;
});

patch("components/materias/QuizPage.tsx", (s) => {
  s = s.replace(/headers:\s*session\s*\?\s*\{\s*\}\s*:\s*\{\},/g, "credentials: 'same-origin',");
  s = s.replace(/if \(!session\) \{\s*console\.warn\(`⚠️ \[Quiz\][\s\S]*?continue;\s*\}/g, "");
  return s;
});

patch("components/materias/RepasarViewer.tsx", (s) => {
  s = s.replace(/headers:\s*session\s*\?\s*\{\s*\}\s*:\s*\{\},/g, "credentials: 'same-origin',");
  return s;
});

patch("components/materias/SeleccionPaginas.tsx", (s) => {
  s = s.replace("          token = s?.access_token || null;", "          token = null;");
  return s;
});

patch("app/materias/page.tsx", (s) => {
  s = s.replace(/      const session = \(await import\('\.\.\/\.\.\/lib\/supabase'\)\.then\(m => m\.supabase\.auth\.getSession\(\)\)\)\.data\.session;\n      await fetch\(`\/api\/materials\/\$\{materialId\}`, \{\n        method: 'DELETE',\n        headers: session\?\.access_token \? \{ Authorization: `Bearer \$\{session\.access_token\}` \} : \{\},\n      \}\);/g, `      await fetch(\`/api/materials/\${materialId}\`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });`);
  return s;
});
