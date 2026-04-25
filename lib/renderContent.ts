export const renderPostContent = (contenido: any) => {
  if (!contenido) return "";
  let data = contenido;
  if (typeof contenido === 'string') {
    try { data = JSON.parse(contenido); } catch (e) { return contenido; }
  }

  // Si es un Apunte (Editor de bloques/dibujos)
  if (data.paginas && Array.isArray(data.paginas)) {
    return data.paginas.map((pagina: any) => {
      return `<div class="pagina-apunte" style="background:white; color:black; padding:40px; margin-bottom:20px; border-radius:12px; min-height:400px; position:relative; overflow:hidden;">
        ${(pagina.bloques || []).map((b: any) => {
          // Intentamos mantener la posición si existe x,y, pero en móvil lo ponemos uno bajo otro
          return `<div style="margin-bottom:15px; font-size:16px;">${b.html || ''}</div>`;
        }).join('')}
      </div>`;
    }).join('');
  }

  // Si es texto plano
  return data.texto || data.descripcion || "";
};
