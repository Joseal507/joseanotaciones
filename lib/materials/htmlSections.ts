// Autoridad única para "convertir HTML estructurado en secciones con
// título". Usada tanto por DOCX (HTML que produce mammoth a partir de los
// estilos Heading 1-6 de Word) como por materiales Web (HTML ya limpiado
// por Readability). Un solo caminante de DOM evita tener dos heurísticas
// de "qué es una sección" que puedan divergir entre formatos.
import { parseHTML } from 'linkedom';

export interface HtmlSection {
  title: string | null;
  text: string;
}

export function htmlToSections(html: string): HtmlSection[] {
  const { document } = parseHTML(`<!doctype html><body>${html || ''}</body>`);
  const sections: HtmlSection[] = [];
  let current: HtmlSection = { title: null, text: '' };

  const flush = () => {
    const text = current.text.trim();
    if (text) sections.push({ title: current.title, text });
  };

  const walk = (node: any) => {
    for (const child of Array.from(node.children || []) as any[]) {
      const tag = String(child.tagName || '').toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        flush();
        const title = String(child.textContent || '').trim();
        current = { title: title || null, text: '' };
      } else if (tag === 'p') {
        const t = String(child.textContent || '').trim();
        if (t) current.text += t + '\n\n';
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of Array.from(child.querySelectorAll('li')) as any[]) {
          const t = String(li.textContent || '').trim();
          if (t) current.text += `- ${t}\n`;
        }
        current.text += '\n';
      } else if (tag === 'table') {
        for (const row of Array.from(child.querySelectorAll('tr')) as any[]) {
          const cells = (Array.from(row.querySelectorAll('td,th')) as any[])
            .map(c => String(c.textContent || '').trim());
          if (cells.some(Boolean)) current.text += cells.join(' | ') + '\n';
        }
        current.text += '\n';
      } else if (tag === 'blockquote' || tag === 'pre') {
        const t = String(child.textContent || '').trim();
        if (t) current.text += t + '\n\n';
      } else {
        // Contenedor genérico (div/section/article/figure...) — recorrer
        // dentro en vez de tratarlo como hoja, así no se pierde contenido
        // anidado bajo wrappers.
        walk(child);
      }
    }
  };

  walk(document.body);
  flush();
  return sections;
}

// true si al menos una sección tiene título real — condición para usar el
// camino "secciones semánticas" en vez del fallback de bloques por chars.
export function hasUsableHeadings(sections: HtmlSection[]): boolean {
  return sections.some(s => !!s.title);
}
