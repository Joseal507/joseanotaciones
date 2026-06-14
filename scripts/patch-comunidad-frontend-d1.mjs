import fs from "fs";

function patch(file, fn) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  s = fn(s);
  fs.writeFileSync(file, s);
  console.log((s === before ? "unchanged" : "patched"), file);
}

patch("components/comunidad/TikTokEstudio.tsx", (s) => {
  s = s.replace("import { supabase } from '@/lib/supabase';\n", "");

  s = s.replace(
/    try \{
      if \(liked\) \{
        await supabase\.from\('comunidad_likes'\)
          \.delete\(\)\.eq\('post_id', post\.id\)\.eq\('user_id', userId\);
        await supabase\.from\('comunidad_posts'\)
          \.update\(\{ likes_count: post\.likes_count - 1 \}\)\.eq\('id', post\.id\);
      \} else \{
        await supabase\.from\('comunidad_likes'\)
          \.upsert\(\{ post_id: post\.id, user_id: userId \}\);
        await supabase\.from\('comunidad_posts'\)
          \.update\(\{ likes_count: post\.likes_count \+ 1 \}\)\.eq\('id', post\.id\);
      \}
    \} catch \{\}/,
`    try {
      await fetch('/api/comunidad/likes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, user_id: userId }),
      });
    } catch {}`
  );

  s = s.replace(
/    try \{
      if \(guardado\) \{
        await supabase\.from\('comunidad_guardados'\)
          \.delete\(\)\.eq\('post_id', post\.id\)\.eq\('user_id', userId\);
      \} else \{
        await supabase\.from\('comunidad_guardados'\)
          \.upsert\(\{ post_id: post\.id, user_id: userId \}\);
      \}
    \} catch \{\}/,
`    try {
      await fetch('/api/comunidad/guardados', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, user_id: userId }),
      });
    } catch {}`
  );

  s = s.replace(
/    void supabase
      \.from\('comunidad_posts'\)
      \.update\(\{ views: \(post\.views \|\| 0\) \+ 1 \}\)
      \.eq\('id', post\.id\);/,
`    void fetch('/api/comunidad/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ post_id: post.id }),
    });`
  );

  return s;
});

patch("components/comunidad/StudyALBlinks.tsx", (s) => {
  s = s.replace("import { supabase } from '@/lib/supabase';\n", "");

  s = s.replace(
/      void supabase
        \.from\('comunidad_posts'\)
        \.update\(\{ views: \(post\.views \|\| 0\) \+ 1 \}\)
        \.eq\('id', post\.id\);/,
`      void fetch('/api/comunidad/views', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: post.id }),
      });`
  );

  s = s.replace(
/    try \{
      if \(liked\) \{
        await supabase\.from\('comunidad_likes'\)\.delete\(\)\.eq\('post_id', post\.id\)\.eq\('user_id', userId\);
        await supabase\.from\('comunidad_posts'\)\.update\(\{ likes_count: Math\.max\(0, post\.likes_count - 1\) \}\)\.eq\('id', post\.id\);
      \} else \{
        await supabase\.from\('comunidad_likes'\)\.upsert\(\{ post_id: post\.id, user_id: userId \}\);
        await supabase\.from\('comunidad_posts'\)\.update\(\{ likes_count: post\.likes_count \+ 1 \}\)\.eq\('id', post\.id\);
      \}
    \} catch \(e\) \{
      console\.error\('Error like:', e\);
    \}/,
`    try {
      await fetch('/api/comunidad/likes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, user_id: userId }),
      });
    } catch (e) {
      console.error('Error like:', e);
    }`
  );

  s = s.replace(
/    try \{
      if \(guardado\) \{
        await supabase\.from\('comunidad_guardados'\)\.delete\(\)\.eq\('post_id', post\.id\)\.eq\('user_id', userId\);
      \} else \{
        await supabase\.from\('comunidad_guardados'\)\.upsert\(\{ post_id: post\.id, user_id: userId \}\);
      \}
    \} catch \(e\) \{
      console\.error\('Error guardar:', e\);
    \}/,
`    try {
      await fetch('/api/comunidad/guardados', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, user_id: userId }),
      });
    } catch (e) {
      console.error('Error guardar:', e);
    }`
  );

  return s;
});
