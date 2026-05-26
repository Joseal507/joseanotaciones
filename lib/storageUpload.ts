import { supabase } from './supabase';

export async function subirBase64AlStorage(
  base64: string,
  nombre: string,
  tipo: 'canvas' | 'fondo' | 'imagen' | 'doc' = 'imagen',
): Promise<string> {
  try {
    if (!base64.startsWith('data:')) return base64;
    if (base64.length < 13000) return base64;

    const session = (await supabase.auth.getSession()).data.session;
    if (!session) return base64;

    const response = await fetch(base64);
    const blob = await response.blob();

    const ext = blob.type.includes('png') ? 'png'
      : blob.type.includes('jpeg') ? 'jpg'
      : blob.type.includes('pdf') ? 'pdf'
      : 'png';

    const filePath = `${session.user.id}/${tipo}_${nombre}_${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('archivos')
      .upload(filePath, blob, { contentType: blob.type, upsert: true });

    if (error) {
      console.error('Storage upload error:', error);
      return base64;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('archivos')
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (err) {
    console.error('Error subiendo al storage:', err);
    return base64;
  }
}

export async function subirFileAlStorage(
  file: File,
  tipo: 'doc' | 'imagen' = 'doc',
): Promise<string | null> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) return null;

    const ext = file.name.split('.').pop() || 'bin';
    const filePath = `${session.user.id}/${tipo}_${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('archivos')
      .upload(filePath, file, { contentType: file.type, upsert: true });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('archivos')
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (err) {
    console.error('Error subiendo archivo:', err);
    return null;
  }
}