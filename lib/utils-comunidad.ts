export function timeAgo(date: string) {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  if (seconds < 3600) return "Hace un momento";
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return hours + "h";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + "d";
  return new Date(date).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export const renderTextoLimpio = (contenido: any) => {
  if (!contenido) return "";
  let data = contenido;
  if (typeof contenido === 'string') {
    try { data = JSON.parse(contenido); } catch (e) { return contenido; }
  }
  if (data.paginas) {
    return data.paginas.flatMap((p: any) => p.bloques || []).map((b: any) => b.html || "").join(" ").replace(/<[^>]*>?/gm, "");
  }
  return data.texto || data.descripcion || "";
};
