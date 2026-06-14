export async function subirBase64AlStorage(
  base64: string,
  nombre: string,
  tipo: 'canvas' | 'fondo' | 'imagen' | 'doc' = 'imagen',
): Promise<string> {
  try {
    if (!base64.startsWith('data:')) return base64;
    if (base64.length < 13000) return base64;

    const response = await fetch(base64);
    const blob = await response.blob();

    const ext = blob.type.includes('png') ? 'png'
      : blob.type.includes('jpeg') ? 'jpg'
      : blob.type.includes('pdf') ? 'pdf'
      : 'png';

    const file = new File([blob], `${tipo}_${nombre}_${Date.now()}.${ext}`, {
      type: blob.type || 'application/octet-stream',
    });

    const form = new FormData();
    form.append('file', file);
    form.append('folder', 'archivos');

    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    return data.url || base64;
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
    const form = new FormData();
    form.append('file', file);
    form.append('folder', tipo === 'doc' ? 'archivos/docs' : 'archivos/imagenes');

    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    return data.url || null;
  } catch (err) {
    console.error('Error subiendo archivo:', err);
    return null;
  }
}

