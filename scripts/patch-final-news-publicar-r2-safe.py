from pathlib import Path

# news
p = Path("app/news/page.tsx")
s = p.read_text()
s = s.replace("import { supabase } from '../../lib/supabase';\n", "")
start = s.find("    const ext = f.name.split('.').pop();")
end = s.find("  };\n\n  // 🔐 Click en publicar", start)
if start != -1 and end != -1:
    s = s[:start] + """    setUploadProgress(20);
    const form = new FormData();
    form.append('file', f);
    form.append('folder', 'news');
    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Error subiendo archivo');
    setUploadProgress(100);
    return data.url;
""" + s[end:]
p.write_text(s)
print("patched news")

# publicar comunidad
p = Path("components/PublicarComunidad.tsx")
s = p.read_text()
s = s.replace("import { supabase } from '../lib/supabase';\n", "")

old = """      const ext  = file.name.split('.').pop() || 'jpg';
      const path = `portadas/${userId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('comunidad-portadas').upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('comunidad-portadas').getPublicUrl(path);
      setPortadaUrl(publicUrl);"""
new = """      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'comunidad-portadas');
      const res = await fetch('/api/partner-upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Error subiendo portada');
      setPortadaUrl(data.url);"""
s = s.replace(old, new)

old = """                            const ext  = file.name.split('.').pop() || 'mp4';
                            const path = `videos/${userId}_${Date.now()}.${ext}`;
                            const { error: upErr } = await supabase.storage
                              .from('comunidad-videos')
                              .upload(path, file, { contentType: file.type, upsert: true });

                            if (upErr) {
                              if ((upErr as any).message?.toLowerCase().includes('bucket not found')) {
                                throw new Error('El bucket comunidad-videos no existe en Supabase');
                              }
                              throw upErr;
                            }
                            const { data: { publicUrl } } = supabase.storage.from('comunidad-videos').getPublicUrl(path);
                            setVideoUrl(publicUrl);"""
new = """                            const form = new FormData();
                            form.append('file', file);
                            form.append('folder', 'comunidad-videos');
                            const res = await fetch('/api/partner-upload', {
                              method: 'POST',
                              credentials: 'same-origin',
                              body: form,
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok || !data.url) throw new Error(data.error || 'Error subiendo video');
                            setVideoUrl(data.url);"""
s = s.replace(old, new)
p.write_text(s)
print("patched publicar")

# materias stubborn line
p = Path("app/materias/page.tsx")
s = p.read_text()
old = """      const session = (await import('../../lib/supabase').then(m => m.supabase.auth.getSession())).data.session;
      await fetch(`/api/materials/${materialId}`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });"""
new = """      await fetch(`/api/materials/${materialId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });"""
s = s.replace(old, new)
p.write_text(s)
print("patched materias")
