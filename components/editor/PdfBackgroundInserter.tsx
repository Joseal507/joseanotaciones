const subirDocumento = async (e: React.ChangeEvent<HTMLInputElement>) => {
  if (!e.target.files?.[0] || !temaActual) return;
  const file = e.target.files[0];
  setSubiendoDoc(true);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // ✅ Subir archivo al Storage en vez de guardar base64 en DB
    let archivoUrl: string | undefined;
    if (data.fileBase64 && data.mimeType) {
      try {
        const { subirBase64AlStorage } = await import('../../lib/storageUpload');
        const base64Full = `data:${data.mimeType};base64,${data.fileBase64}`;
        const urlStorage = await subirBase64AlStorage(
          base64Full,
          file.name.replace(/\.[^.]+$/, ''),
          'doc',
        );
        // Si subió al storage (URL de supabase), usarla
        if (urlStorage.startsWith('http')) {
          archivoUrl = urlStorage;
        } else {
          // fallback a blob URL local
          const byteCharacters = atob(data.fileBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: data.mimeType });
          archivoUrl = URL.createObjectURL(blob);
        }
      } catch {
        // fallback a blob URL local si falla el storage
        const byteCharacters = atob(data.fileBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: data.mimeType });
        archivoUrl = URL.createObjectURL(blob);
      }
    }

    const nombre = file.name.toLowerCase();
    const esImagen = nombre.match(/\.(jpg|jpeg|png|webp|gif)$/i);
    const tipo = esImagen ? 'imagen'
      : nombre.endsWith('.pdf') ? 'pdf'
      : nombre.endsWith('.docx') || nombre.endsWith('.doc') ? 'word'
      : nombre.endsWith('.pptx') || nombre.endsWith('.ppt') ? 'ppt'
      : 'txt';

    const nuevoDoc: Documento = {
      id: generateId(),
      nombre: file.name,
      contenido: data.content,
      tipo,
      fechaSubida: new Date().toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES'),
      archivoUrl,
      // ✅ NO guardar base64 si ya está en storage (ahorra mucho espacio en DB)
      archivoBase64: archivoUrl?.startsWith('http') ? undefined : data.fileBase64,
      archivoMime: data.mimeType,
    };

    actualizarTema({ ...temaActual, documentos: [...temaActual.documentos, nuevoDoc] });
  } catch (err: any) {
    alert('Error: ' + err.message);
  } finally {
    setSubiendoDoc(false);
    e.target.value = '';
  }
};