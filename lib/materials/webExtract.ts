// Orquesta: fetch SSRF-safe → Readability (contenido principal, sin
// nav/footer/ads/scripts) → htmlToSections (misma autoridad de
// segmentación que DOCX) → [Seccion N: Título] listo para
// filterTextToSelectedUnits. No guardamos el HTML crudo como materialText
// — solo el texto normalizado por secciones.
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { fetchPublicHtml, WebFetchError } from './webFetch';
import { htmlToSections, hasUsableHeadings } from './htmlSections';

export { WebFetchError };

export interface WebExtractResult {
  title: string;
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  text: string; // ya con marcadores [Seccion N: Título] (o fallback de bloques)
  sectionsCount: number;
}

export async function extractWebMaterial(inputUrl: string): Promise<WebExtractResult> {
  const { html, finalUrl, contentType } = await fetchPublicHtml(inputUrl);

  const { document } = parseHTML(html);
  const pageTitle = String(document.querySelector('title')?.textContent || '').trim();

  let articleTitle = pageTitle;
  let contentHtml = html;
  try {
    const reader = new Readability(document, { charThreshold: 200 });
    const article = reader.parse();
    if (article?.content && article.content.trim().length > 0) {
      contentHtml = article.content;
      if (article.title) articleTitle = article.title;
    }
  } catch (e: any) {
    console.warn('extractWebMaterial: Readability falló, usando HTML completo como fallback:', e?.message);
  }

  const sections = htmlToSections(contentHtml);
  const withHeadings = hasUsableHeadings(sections);

  const text = sections.length
    ? sections
        .map((s, i) => `[Seccion ${i + 1}${s.title ? `: ${s.title}` : ''}]\n${s.text}`)
        .join('\n\n')
        .trim()
    : '';

  if (!text || text.length < 50) {
    throw new WebFetchError('No se pudo extraer contenido legible de esta página.', 'NO_CONTENT');
  }

  return {
    title: articleTitle || finalUrl,
    sourceUrl: inputUrl,
    finalUrl,
    contentType,
    text,
    sectionsCount: withHeadings ? sections.length : 1,
  };
}
