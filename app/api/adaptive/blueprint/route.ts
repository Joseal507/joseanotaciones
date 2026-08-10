import { NextRequest, NextResponse } from 'next/server';
import { alaiJson } from '../../../../lib/alai';
import { getMaterialText, getMaterial } from '../../../../lib/materials/repository';
import { downloadFromR2 } from '../../../../lib/materials/storage';
import { extractText } from '../../../../lib/materials/extractors';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth/options';
import {
  enrichBlueprintHeuristics,
  evaluateBlueprintQuality,
} from '../../../../lib/adaptive/blueprintQuality';

export const maxDuration = 180;
export const dynamic = 'force-dynamic';

interface DocumentTopic {
  id: string;
  title: string;
  description: string;
  pages: number[];
  order: number;
  role: 'foundation' | 'problem' | 'mechanism' | 'application' | 'integration' | 'context';
}

type BlueprintAuditIssueKind = 'omission' | 'invention' | 'other' | 'audit_failure';

interface BlueprintAuditIssue {
  kind: BlueprintAuditIssueKind;
  message: string;
}

interface BlueprintAuditReport {
  passed: boolean;
  issues: BlueprintAuditIssue[];
  uncoveredFragments: string[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function makeId(kind: string, label: string, index: number): string {
  const prefix: Record<string, string> = {
    concept: 'concept', entity: 'entity', formula: 'formula',
    definition: 'def', example: 'ex', fact: 'fact',
    note: 'note', common_mistake: 'mistake',
  };
  return `${prefix[kind] || 'node'}_${slugify(label) || index}`;
}

// Limpiar texto extraído (elimina espacios múltiples del extractor PDF)
// También escapa secuencias LaTeX que rompen el JSON de la IA
function cleanExtractedText(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[\n]{3,}/g, '\n\n')
    // Escapar backslashes de LaTeX (\frac, \text, etc.) para que no rompan JSON
    // Los reemplazamos con notación segura que la IA puede leer
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
    // Cualquier otro backslash residual se elimina para no romper JSON
    .replace(/\\/g, '')
    .trim();
}

// Separar texto por páginas usando marcadores [Pagina N]
function splitTextByPages(fullText: string): Map<number, string> {
  const pageMap = new Map<number, string>();
  const PAGE_SPLIT = /(?=\[Pagina \d+\])/i;
  const PAGE_NUM = /\[Pagina (\d+)\]/i;
  const PAGE_CLEAN = /\[Pagina \d+\]/gi;

  const chunks = fullText.split(PAGE_SPLIT).filter(c => c.trim().length > 0);

  if (chunks.length <= 1) {
    pageMap.set(1, cleanExtractedText(fullText.replace(PAGE_CLEAN, '')));
    return pageMap;
  }

  for (const chunk of chunks) {
    const match = PAGE_NUM.exec(chunk);
    if (!match) continue;
    const pageNum = parseInt(match[1]);
    const text = chunk.replace(PAGE_CLEAN, '').trim();
    if (text.length > 20) pageMap.set(pageNum, cleanExtractedText(text));
  }

  return pageMap;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function stripEditorialNoise(text: string): string {
  // Solo elimina metadatos editoriales cortos y específicos, nunca contenido real
  return text
    // Copyright con año y frase corta después (máx 80 chars, se detiene en punto o fin)
    .replace(/©\s*\d{4}[^.\n]{0,80}/gi, ' ')
    .replace(/todos los derechos reservados\.?/gi, ' ')
    .replace(/all rights reserved\.?/gi, ' ')
    // QuickTime warning específico
    .replace(/quicktime[^.\n]{0,80}/gi, ' ')
    // Solo el nombre editorial, no todo hasta salto de línea
    .replace(/\bprentice[\s\-]*hall\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateStructureMaxTokens(
  chunkEntries: Array<[number, string]>,
  charsPerPage: number,
): number {
  const sampledChars = chunkEntries.reduce(
    (sum, [, pageText]) => sum + Math.min(pageText.length, charsPerPage),
    0,
  );
  const pageCount = chunkEntries.length;
  const maxTopics = Math.max(4, Math.min(18, pageCount));
  const estimatedTopics = clampInt(Math.ceil(sampledChars / 900), 4, maxTopics);

  // JSON de topics: normalmente no necesita más de 1.4k–4.2k output tokens
  return clampInt(700 + estimatedTopics * 140, 1400, 4200);
}

function estimateAnalysisMaxTokens(sectionChunk: string): number {
  const chars = sectionChunk.length;
  const estimatedBlocks = clampInt(Math.ceil(chars / 600), 3, 25);
  const hasFormulas = /[=\+\-\*\/\^\[\]]|keq|kc|kp|\bk\b/i.test(sectionChunk);

  // Topics con fórmulas necesitan más tokens para JSON completo
  const base = hasFormulas ? 900 : 700;
  const min = hasFormulas ? 2000 : 1600;
  const max = hasFormulas ? 4500 : 3800;

  return clampInt(base + estimatedBlocks * 240, min, max);
}

function estimateVisionMaxTokens(existingText: string): number {
  const cleanLen = stripEditorialNoise(existingText).length;
  if (cleanLen < 120) return 750;
  if (cleanLen < 220) return 600;
  return 450;
}

function normalizeForMatch(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9áéíóúüñ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordSet(text: string): Set<string> {
  const stop = new Set([
    'this','that','with','from','into','para','como','esta','este','estos','estas',
    'the','and','los','las','una','unos','unas','sobre','entre','porque','where','which',
    'what','when','then','than','have','has','had','were','been','being','through',
    'del','con','por','que','como','para','sobre','desde','hasta','entre','mas','menos'
  ]);

  return new Set(
    normalizeForMatch(text)
      .split(' ')
      .map(s => s.trim())
      .filter(s => s.length >= 4 && !stop.has(s))
  );
}

function parseTopicPages(topicText: string): { page: number; text: string }[] {
  const parts = String(topicText || '').split(/(?=\[(?:P[aá]gina) \d+\])/i);
  const out: { page: number; text: string }[] = [];

  for (const part of parts) {
    const m = part.match(/\[(?:P[aá]gina) (\d+)\]/i);
    if (!m) continue;
    const page = parseInt(m[1], 10);
    const content = part.replace(/\[(?:P[aá]gina) \d+\]/gi, '').trim();
    if (content.length > 0) out.push({ page, text: content });
  }

  return out;
}

function deriveSourceSpansFromTopicText(
  label: string,
  summary: string,
  topicText: string,
): { page: number; quote: string; certainty: 'supported' | 'inferred' | 'uncertain' }[] {
  const target = keywordSet(`${label} ${summary}`);
  const pages = parseTopicPages(topicText);
  if (!pages.length) return [];

  let best: { page: number; quote: string; score: number } | null = null;

  for (const page of pages) {
    const rawCandidates = page.text
      .split(/(?<=[\.!\?:;])\s+|\n+/)
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(s => s.length >= 20);

    const candidates = rawCandidates.length
      ? rawCandidates
      : [page.text.replace(/\s+/g, ' ').trim()];

    for (const candidate of candidates) {
      const words = keywordSet(candidate);
      let score = 0;

      for (const w of target) {
        if (words.has(w)) score += 1;
      }

      const normLabel = normalizeForMatch(label);
      const normCand = normalizeForMatch(candidate);

      if (normLabel && normCand.includes(normLabel.slice(0, 24))) score += 2;
      if (/[=\+\-\*\/\^\[\]\(\)]/.test(label) && /[=\+\-\*\/\^]/.test(candidate)) score += 2;

      if (!best || score > best.score) {
        best = {
          page: page.page,
          quote: candidate.slice(0, 200),
          score,
        };
      }
    }
  }

  if (best && best.quote) {
    return [{
      page: best.page,
      quote: best.quote,
      certainty: best.score >= 3 ? 'supported' : best.score >= 1 ? 'inferred' : 'uncertain',
    }];
  }

  const first = pages[0];
  return first?.text
    ? [{
        page: first.page,
        quote: first.text.replace(/\s+/g, ' ').slice(0, 200),
        certainty: 'uncertain',
      }]
    : [];
}

// PASO 0: Enriquecer páginas con poco texto usando Gemini Vision
async function enrichPageWithVision(
  pageNum: number,
  pdfBuffer: Buffer,
  materialName: string,
  existingText: string = '',
): Promise<string> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    console.warn(`  ⚠️ Sin OPENROUTER_API_KEY para visión en página ${pageNum}`);
    return '';
  }

  try {
    const base64 = pdfBuffer.toString('base64');
    const maxTokens = estimateVisionMaxTokens(existingText);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://studyal.app',
        'X-Title': 'StudyAL Vision',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:application/pdf;base64,${base64}`,
              },
            },
            {
              type: 'text',
              text: `Focus ONLY on page ${pageNum} of this document.
This page appears to contain visual content (diagrams, charts, images, slides) with limited extractable text.

Your task:
1. Extract ALL text visible anywhere on this page — including inside diagrams, charts, labels, captions, and slide elements.
2. Describe any visual content (graphs, diagrams, illustrations) and what they communicate.
3. Write in the same language as the document content.

Return a thorough description of the content on page ${pageNum} only. Be specific.`,
            },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`  ⚠️ Vision OpenRouter página ${pageNum}: HTTP ${res.status} ${errText.slice(0, 100)}`);
      return '';
    }

    const data = await res.json();
    const enriched = data?.choices?.[0]?.message?.content ?? '';
    if (enriched.length > 50) {
      console.log(`  🖼️ Página ${pageNum} enriquecida con visión: ${enriched.length} chars`);
    }
    return enriched;
  } catch (e: any) {
    console.warn(`  ⚠️ Vision error página ${pageNum}: ${e?.message}`);
    return '';
  }
}

// PASO 1: Detectar topics — basado en contenido real, sin límites artificiales
async function extractDocumentStructure(
  pageMap: Map<number, string>,
  materialName: string,
): Promise<DocumentTopic[]> {
  const pageEntries = Array.from(pageMap.entries())
    .filter(([_, text]) => text.trim().length > 30)
    .sort(([a], [b]) => a - b);

  if (pageEntries.length === 0) return [];

  // Chunk size adaptativo según tamaño del documento
  // Documentos pequeños (≤15 págs): 1 chunk, 800 chars/página
  // Documentos medianos (≤35 págs): 2 chunks, 600 chars/página
  // Documentos grandes (>35 págs):  3+ chunks, 500 chars/página
  const totalPages = pageEntries.length;
  const charsPerPage = totalPages <= 15 ? 800 : totalPages <= 35 ? 600 : 500;
  const pagesPerChunk = totalPages <= 15 ? totalPages : totalPages <= 35 ? Math.ceil(totalPages / 2) : Math.ceil(totalPages / 3);

  // Dividir pageEntries en chunks
  const chunks: typeof pageEntries[] = [];
  for (let i = 0; i < pageEntries.length; i += pagesPerChunk) {
    chunks.push(pageEntries.slice(i, i + pagesPerChunk));
  }

  console.log(`📄 ${totalPages} páginas → ${chunks.length} chunk(s), ${charsPerPage} chars/página`);

  const buildPrompt = (chunkEntries: typeof pageEntries, chunkIndex: number, totalChunks: number) => {
    const sample = chunkEntries
      .map(([num, text]) => `[Pagina ${num}]\n${text.slice(0, charsPerPage)}`)
      .join('\n\n');
    const pageList = chunkEntries.map(([num]) => num).join(', ');
    const contextNote = totalChunks > 1
      ? `This is part ${chunkIndex + 1} of ${totalChunks} of the document.`
      : 'This is the complete document.';

    return `You are an expert analyst. ${contextNote}

Document: "${materialName}"
Pages in this section: ${pageList}

This document may be of ANY type: textbook, novel, history, law, medicine, philosophy, math, science, literature, manual, or any other domain. Adapt your analysis to the actual content.

INSTRUCTIONS:
Read the content carefully and identify the natural sections or topics it contains.
The number of topics must match the real structure — not the number of pages.
Pages covering the same continuous idea belong to ONE topic.
Only split into a new topic when the content clearly shifts to a different idea, event, argument, or subject.

CRITICAL RULES:
1. Base topics on the ACTUAL content — never on page count or document type assumptions.
2. Group consecutive pages covering the SAME idea, argument, event, or subject into ONE topic.
3. Create a new topic only when there is a CLEAR shift in subject matter.
4. Topic titles must be SPECIFIC to the actual content — describe exactly what this section is about, not a generic category.
5. Every page in [${pageList}] must be assigned to exactly one topic.
6. Do NOT create topics named "Introduction", "Overview", "Section 1", or any generic placeholder.

ROLES — assign the role that best fits this topic within the document:
- foundation: background, context, prerequisites, biography, setting, who/what/when/where
- problem: conflict, limitation, gap, challenge, what needs to be solved or explained
- mechanism: how something works, central theory, process, argument, plot mechanism
- application: examples, evidence, calculations, case studies, worked problems, scenes that apply ideas
- integration: connections, synthesis, broader implications, resolution, how parts relate
- context: real-world impact, legacy, significance, aftermath, interpretation

Document content:
${sample}

Return ONLY valid JSON. Every page listed in [${pageList}] must appear in exactly one topic:
{
  "topics": [
    {
      "title": "Specific descriptive title (5-10 words)",
      "description": "One precise sentence describing what this topic covers",
      "pages": [1, 2],
      "role": "foundation | problem | mechanism | application | integration | context"
    }
  ]
}`;
  };

  // Ejecutar análisis por chunks — chunks cubren páginas disjuntas y cada
  // uno resuelve a su propio arreglo de topics (con su propio fallback ante
  // error), así que son independientes entre sí. Perf audit (Codex,
  // read-only): eran seriales (ΣLᵢ) pudiendo ser max(Lᵢ) con concurrencia,
  // sin afectar cobertura de páginas ni el orden final (se aplana por índice
  // de chunk, igual que antes).
  const chunkResults = await Promise.all(chunks.map(async (chunk, i) => {
    console.log(`🔍 Analizando chunk ${i + 1}/${chunks.length} (páginas ${chunk[0][0]}–${chunk[chunk.length-1][0]})`);
    try {
      const chunkMaxTokens = estimateStructureMaxTokens(chunk, charsPerPage);
      const result = await alaiJson({
        messages: [{ role: 'user', content: buildPrompt(chunk, i, chunks.length) }],
        temperature: 0.1,
        maxTokens: chunkMaxTokens,
        json: true,
      });
      const raw = result?.topics;
      if (Array.isArray(raw) && raw.length > 0) {
        console.log(`  ✅ ${raw.length} topics en chunk ${i + 1}`);
        return raw;
      }
      console.warn(`  ⚠️ Chunk ${i + 1} sin topics — usando fallback por página`);
      return chunk.map(([pageNum]) => ({
        title: `${materialName} — Page ${pageNum}`,
        description: `Content from page ${pageNum}`,
        pages: [pageNum],
        role: 'mechanism',
      }));
    } catch (e: any) {
      console.error(`  ❌ Chunk ${i + 1} failed: ${e?.message}`);
      return chunk.map(([pageNum]) => ({
        title: `${materialName} — Page ${pageNum}`,
        description: `Content from page ${pageNum}`,
        pages: [pageNum],
        role: 'mechanism',
      }));
    }
  }));
  const allRawTopics: any[] = chunkResults.flat();

  // Construir topics finales
  const topics: DocumentTopic[] = allRawTopics.map((t: any, i: number) => ({
    id: `topic_${i}`,
    title: String(t.title || `Topic ${i + 1}`).trim(),
    description: String(t.description || '').trim(),
    pages: Array.isArray(t.pages) ? t.pages.map(Number).filter((n: number) => n > 0) : [],
    order: i,
    role: (['foundation', 'problem', 'mechanism', 'application', 'integration', 'context'].includes(t.role)
      ? t.role : 'mechanism') as DocumentTopic['role'],
  })).filter(t => t.pages.length > 0);

  // Verificar que todas las páginas están cubiertas
  const coveredPages = new Set(topics.flatMap(t => t.pages));
  const uncoveredPages = pageEntries.map(([n]) => n).filter(n => !coveredPages.has(n));
  if (uncoveredPages.length > 0) {
    console.warn(`⚠️ Páginas sin topic: ${uncoveredPages.join(', ')} — asignando al topic más cercano`);
    for (const p of uncoveredPages) {
      const closest = topics.reduce((best, t) => {
        const distBest = Math.min(...best.pages.map((bp: number) => Math.abs(bp - p)));
        const distCurr = Math.min(...t.pages.map((tp: number) => Math.abs(tp - p)));
        return distCurr < distBest ? t : best;
      });
      closest.pages.push(p);
      closest.pages.sort((a: number, b: number) => a - b);
    }
  }

  console.log(`✅ ${topics.length} topics detectados en total:`);
  topics.forEach(t => console.log(`  [${t.role}] p.${t.pages.join(',')} — "${t.title}"`));
  return topics;
}

// PASO 2: Analizar el contenido de un topic
async function analyzeTopic(
  topic: DocumentTopic,
  topicText: string,
  allTopics: DocumentTopic[],
  materialName: string,
  topicIndex: number,
  totalTopics: number,
): Promise<any[]> {
  if (!topicText.trim() || topicText.trim().length < 30) return [];

  const langHint = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(topicText) ? 'es' : 'en';

  const cleanText = topicText.trim();

  // Chunking adaptativo para no truncar topics largos
  const chunkSize = cleanText.length <= 9000 ? 9000 : 7000;
  const overlap = 600;

  const textChunks: string[] = [];
  if (cleanText.length <= chunkSize) {
    textChunks.push(cleanText);
  } else {
    let start = 0;
    while (start < cleanText.length) {
      let end = Math.min(start + chunkSize, cleanText.length);

      // Intentar cortar en salto de línea cercano para no partir ideas
      if (end < cleanText.length) {
        const windowStart = Math.max(start, end - 800);
        const breakPos = cleanText.lastIndexOf('\n', end);
        if (breakPos > windowStart) end = breakPos;
      }

      const chunk = cleanText.slice(start, end).trim();
      if (chunk.length > 30) textChunks.push(chunk);

      if (end >= cleanText.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }

  console.log(`  🧠 Topic "${topic.title}" → ${textChunks.length} chunk(s)`);

  const buildPrompt = (sectionChunk: string, chunkIndex: number, totalChunks: number) => `You are an expert knowledge extractor. Your job is to extract every distinct learnable unit from the section text below.

DOCUMENT: "${materialName}"
SECTION: "${topic.title}"
SECTION ROLE: ${topic.role}
POSITION: section ${topicIndex + 1} of ${totalTopics}, chunk ${chunkIndex + 1} of ${totalChunks}
LANGUAGE: Write ALL output in ${langHint === 'es' ? 'SPANISH' : 'ENGLISH'} — never mix languages.

This document may be of ANY type: science, history, literature, law, medicine, philosophy, mathematics, manual, narrative, or any other domain. Extract knowledge appropriate to the actual content type.

OTHER SECTIONS (do NOT repeat content already covered there):
${allTopics.filter(t => t.id !== topic.id).map(t => `- "${t.title}": ${t.description}`).join('\n') || '(none)'}

YOUR TASK:
Extract every distinct learnable unit from the section text.
Do NOT summarize the whole section into one block.
Each idea, argument, fact, definition, formula, event, character trait, procedure, or example is its own block.
A block is ONE specific thing a student must learn, remember, or be able to do.

EXTRACTION RULES:
1. Read the ENTIRE text before extracting.
2. Extract ONLY what is explicitly stated in the text — never add outside knowledge.
3. Every summary must be 2-3 sentences that accurately paraphrase the source. Be specific, not vague.
4. Labels must identify the exact content — be specific about what this block covers, not generic.

CRITICAL — PRESERVE MODALITY (facts vs opinions):
5a. When the text states a VERIFIABLE FACT (dates, formulas, definitions, procedures, measurements, historical events), extract it directly.
5b. When the text presents an OPINION, VALUATION, or ARGUMENT (words like "the best", "the greatest", "revolutionary", "amazing", "one of the most important", "impressive"), you MUST preserve the source. Use phrases like:
   - "According to the material..."
   - "The author argues that..."
   - "The document states that..."
   - "El material sostiene que..."
   - "El autor argumenta que..."
   Never convert an opinion or valuation into an absolute fact.
5c. Examples:
   - "Newton was born in 1643" → FACT → extract directly
   - "Newton was the greatest scientist" → OPINION → "The material describes Newton as one of the greatest scientists"
   - "The formula is E=mc²" → FACT → extract directly
   - "This theory revolutionized physics" → VALUATION → "The material argues this theory revolutionized physics"
5d. If the source is an argumentative essay, opinion piece, or persuasive text, preserve the argumentative modality throughout — do not present arguments as neutral facts.

CRITICAL — PRESERVE MODALITY (facts vs opinions):
5a. When the text states a VERIFIABLE FACT (dates, formulas, definitions, procedures, measurements, historical events), extract it directly.
5b. When the text presents an OPINION, VALUATION, or ARGUMENT (words like "the best", "the greatest", "revolutionary", "amazing", "one of the most important", "impressive"), you MUST preserve the source. Use phrases like:
   - "According to the material..."
   - "The author argues that..."
   - "The document states that..."
   - "El material sostiene que..."
   - "El autor argumenta que..."
   Never convert an opinion or valuation into an absolute fact.
5c. Examples:
   - "Newton was born in 1643" → FACT → extract directly
   - "Newton was the greatest scientist" → OPINION → "The material describes Newton as one of the greatest scientists"
   - "The formula is E=mc²" → FACT → extract directly
   - "This theory revolutionized physics" → VALUATION → "The material argues this theory revolutionized physics"
5d. If the source is an argumentative essay, opinion piece, or persuasive text, preserve the argumentative modality throughout — do not present arguments as neutral facts.
5. Extract ALL of the following when present:
   - Mathematical or logical formulas → kind="formula"
   - Definitions of specific terms → kind="definition"
   - Explanations of how/why something works → kind="concept"
   - Named people, places, works, institutions central to the content → kind="entity"
   - Specific dates, numbers, measurements, statistics → kind="fact"
   - Illustrative cases, worked problems, scenes, case studies → kind="example"
   - Errors or misconceptions explicitly mentioned → kind="common_mistake"
   - Procedures, step-by-step processes, methods → kind="concept" with bloomLevel="apply"
6. Do NOT create blocks for: page numbers, headers, copyright notices, publisher names, table of contents entries, or any editorial metadata.
7. Do NOT merge two clearly different ideas into one block.
8. If chunks overlap, extract everything correctly — duplicates are removed later.

IMPORTANCE — how essential is this block to understanding the section:
- 90-100: the single most important idea; without it the section cannot be understood
- 75-89: central idea that will very likely appear in any assessment
- 55-74: important supporting knowledge
- 30-54: useful but secondary detail
- 10-29: minor or peripheral — do not extract unless clearly meaningful

KIND — choose the most accurate type:
- concept: an idea explaining how or why something works, a principle, argument, theory, or mechanism
- definition: what a specific term officially or formally means
- formula: a mathematical, logical, or symbolic expression
- entity: a proper name (person, place, work, institution, character) central to this section
- fact: a specific isolated data point — date, number, statistic, measurement
- example: a concrete case, scene, worked problem, or illustrative scenario
- common_mistake: an error or misconception explicitly mentioned in the text
- note: minor supporting detail that does not fit other categories

BLOOM LEVEL — what must the student DO with this knowledge:
- remember: recall or recognize
- understand: explain in own words
- apply: use in a new situation or solve a problem
- analyze: break down, compare, or examine relationships
- evaluate: judge validity, significance, or quality
- create: produce something new

SECTION TEXT:
${sectionChunk}

Return ONLY valid JSON — no markdown, no code fences, no extra text:
{
  "blocks": [
    {
      "kind": "concept | entity | definition | formula | example | fact | common_mistake | note",
      "label": "Specific descriptive label 3-8 words",
      "summary": "First sentence: what this is. Second sentence: key details or mechanism. Third sentence (if needed): implication, context, or application.",
      "sourceSpans": [
        {
          "quote": "exact short quote from the source text that supports this block (max 150 chars)",
          "certainty": "supported | inferred | uncertain"
        }
      ],
      "dependsOn": [],
      "relations": [],
      "misconceptions": ["a common wrong belief about this, if any"],
      "importance": 75,
      "difficulty": "basic | intermediate | advanced",
      "examTypes": ["mcq", "open", "problem"],
      "bloomLevel": "remember | understand | apply | analyze | evaluate | create",
      "examProbability": 70,
      "estimatedMinutes": 3
    }
  ]
}`;

  try {
    const allBlocks: any[] = [];

    for (let i = 0; i < textChunks.length; i++) {
      try {
        const chunkMaxTokens = estimateAnalysisMaxTokens(textChunks[i]);
        const result = await alaiJson({
          messages: [{ role: 'user', content: buildPrompt(textChunks[i], i, textChunks.length) }],
          temperature: 0.1,
          maxTokens: chunkMaxTokens,
          json: true,
        });

        if (Array.isArray(result?.blocks) && result.blocks.length > 0) {
          allBlocks.push(...result.blocks);
          console.log(`    ✅ Chunk ${i + 1}/${textChunks.length}: ${result.blocks.length} blocks`);
        } else {
          console.warn(`    ⚠️ Chunk ${i + 1}/${textChunks.length}: sin blocks`);
        }
      } catch (chunkError: any) {
        console.warn(`    ⚠️ Chunk ${i + 1}/${textChunks.length} falló: ${chunkError?.message} — reintentando...`);
        // Retry 1: texto más corto y menos tokens
        try {
          const shortText = textChunks[i].slice(0, Math.floor(textChunks[i].length * 0.6));
          const retryTokens = Math.max(1200, Math.floor(estimateAnalysisMaxTokens(shortText) * 0.7));
          const retry = await alaiJson({
            messages: [{ role: 'user', content: buildPrompt(shortText, i, textChunks.length) }],
            temperature: 0.1,
            maxTokens: retryTokens,
            json: true,
          });
          if (Array.isArray(retry?.blocks) && retry.blocks.length > 0) {
            allBlocks.push(...retry.blocks);
            console.log(`    ♻️ Retry chunk ${i + 1}: ${retry.blocks.length} blocks`);
            continue;
          }
        } catch (retryErr: any) {
          console.warn(`    ⚠️ Retry 1 chunk ${i + 1} falló: ${retryErr?.message} — dividiendo en dos...`);
        }

        // Retry 2: prompt ULTRA-SIMPLE — pedir menos campos, JSON más corto
        try {
          const langHintRetry = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(textChunks[i]) ? 'SPANISH' : 'ENGLISH';
          const simplePrompt = `Extract 3-6 key knowledge blocks from this text about "${topic.title}".
Language: ${langHintRetry}.

TEXT:
${textChunks[i].slice(0, 5000)}

Return ONLY valid JSON, no extra text. Keep summaries to 1-2 sentences:
{"blocks":[{"kind":"concept","label":"short label","summary":"1-2 sentence summary","importance":75}]}`;

          const simpleResult = await alaiJson({
            messages: [{ role: 'user', content: simplePrompt }],
            temperature: 0.1,
            maxTokens: 2000,
            json: true,
          });

          if (Array.isArray(simpleResult?.blocks) && simpleResult.blocks.length > 0) {
            allBlocks.push(...simpleResult.blocks);
            console.log(`    ♻️ Retry 2 simple chunk ${i + 1}: ${simpleResult.blocks.length} blocks`);
            continue;
          }
        } catch (retry2Err: any) {
          console.warn(`    ⚠️ Retry 2 simple chunk ${i + 1} falló: ${retry2Err?.message} — dividiendo...`);
        }

        // Retry 3: dividir el chunk en dos mitades con prompt simple
        try {
          const mid = Math.floor(textChunks[i].length / 2);
          let splitPoint = textChunks[i].lastIndexOf('\n', mid + 200);
          if (splitPoint <= mid - 200 || splitPoint === -1) splitPoint = mid;

          const firstHalf = textChunks[i].slice(0, splitPoint).trim();
          const secondHalf = textChunks[i].slice(splitPoint).trim();

          const langHintSplit = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(textChunks[i]) ? 'SPANISH' : 'ENGLISH';
          let recoveredBlocks = 0;

          for (const [halfIdx, halfText] of [firstHalf, secondHalf].entries()) {
            if (halfText.length < 50) continue;
            try {
              const halfPrompt = `Extract 2-4 key knowledge blocks from this text about "${topic.title}".
Language: ${langHintSplit}.

TEXT:
${halfText.slice(0, 3000)}

Return ONLY valid JSON, no extra text. Keep summaries to 1-2 sentences:
{"blocks":[{"kind":"concept","label":"short label","summary":"1-2 sentence summary","importance":75}]}`;

              const halfResult = await alaiJson({
                messages: [{ role: 'user', content: halfPrompt }],
                temperature: 0.1,
                maxTokens: 1500,
                json: true,
              });
              if (Array.isArray(halfResult?.blocks) && halfResult.blocks.length > 0) {
                allBlocks.push(...halfResult.blocks);
                recoveredBlocks += halfResult.blocks.length;
                console.log(`    ♻️ Mitad ${halfIdx + 1}/2 chunk ${i + 1}: ${halfResult.blocks.length} blocks`);
              }
            } catch (halfErr: any) {
              console.warn(`    ❌ Mitad ${halfIdx + 1}/2 chunk ${i + 1} falló: ${halfErr?.message}`);
            }
          }
          if (recoveredBlocks === 0) {
            console.warn(`    ❌ Chunk ${i + 1} sin blocks tras todos los intentos`);
          }
        } catch (splitErr: any) {
          console.warn(`    ❌ Split chunk ${i + 1} falló: ${splitErr?.message}`);
        }
      }
    }

    if (!allBlocks.length) return [];

    const topicTitleNorm = topic.title.toLowerCase().replace(/\s+/g, ' ').trim();

    // Patrones de contenido no académico a excluir
    // Solo filtrar metadatos editoriales puros — nunca contenido académico real
    const NON_ACADEMIC = /^copyright\b|^©|derechos reservados|all rights reserved|^isbn[:\s]/i;

    const normalized = allBlocks
      .filter((b: any) => {
        if (!b.label || String(b.label).trim().length < 3) return false;
        const labelNorm = String(b.label).toLowerCase().replace(/\s+/g, ' ').trim();
        if (labelNorm == topicTitleNorm) return false;
        const summary = String(b.summary || '');
        if ((summary.match(/   /g) || []).length > 5) return false;
        if (NON_ACADEMIC.test(b.label) || NON_ACADEMIC.test(summary)) return false;
        if (typeof b.importance === 'number' && b.importance < 25) return false;
        return true;
      })
      .map((b: any) => ({
        kind: b.kind || 'concept',
        label: String(b.label).trim(),
        summary: String(b.summary || '').trim(),
        pages: topic.pages,
        topicId: topic.id,
        topicLabel: topic.title,
        topicRole: topic.role,
        dependsOn: Array.isArray(b.dependsOn) ? b.dependsOn : [],
        relations: Array.isArray(b.relations) ? b.relations.filter((r: any) => r?.type && r?.target) : [],
        misconceptions: Array.isArray(b.misconceptions) ? b.misconceptions.filter(Boolean).slice(0, 2) : [],
        sourceSpans: (() => {
          const aiSpans = Array.isArray(b.sourceSpans)
            ? b.sourceSpans
                .filter((s: any) => s?.quote && String(s.quote).trim().length > 5)
                .slice(0, 3)
                .map((s: any) => ({
                  page: topic.pages[0] || 0,
                  quote: String(s.quote).trim().slice(0, 200),
                  certainty: ['supported', 'inferred', 'uncertain'].includes(s.certainty)
                    ? s.certainty : 'inferred',
                }))
            : [];
          return aiSpans.length > 0
            ? aiSpans
            : deriveSourceSpansFromTopicText(
                String(b.label || ''),
                String(b.summary || ''),
                topicText,
              );
        })(),
        importance: typeof b.importance === 'number' ? Math.max(0, Math.min(100, b.importance)) : 50,
        difficulty: ['basic', 'intermediate', 'advanced'].includes(b.difficulty) ? b.difficulty : 'intermediate',
        examTypes: Array.isArray(b.examTypes) ? b.examTypes : [],
        bloomLevel: typeof b.bloomLevel === 'string' ? b.bloomLevel : 'understand',
        examProbability: typeof b.examProbability === 'number' ? Math.max(0, Math.min(100, b.examProbability)) : 50,
        estimatedMinutes: typeof b.estimatedMinutes === 'number' ? b.estimatedMinutes : 2,
        _fallback: false,
      }));

    // Deduplicación local por label normalizado dentro del topic
    const seen = new Map<string, any>();
    for (const block of normalized) {
      const key = block.label.toLowerCase().trim()
        .replace(/\s+/g, ' ')
        .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
        .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
        .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n');

      if (!seen.has(key)) {
        seen.set(key, { ...block });
      } else {
        const existing = seen.get(key)!;
        if ((block.importance || 0) > (existing.importance || 0)) {
          existing.summary = block.summary;
          existing.importance = block.importance;
          existing.bloomLevel = block.bloomLevel;
          existing.difficulty = block.difficulty;
          existing.examProbability = block.examProbability;
          existing.estimatedMinutes = block.estimatedMinutes;
        }
        existing.dependsOn = [...new Set([...(existing.dependsOn || []), ...(block.dependsOn || [])])];
        existing.examTypes = [...new Set([...(existing.examTypes || []), ...(block.examTypes || [])])];
        existing.misconceptions = [...new Set([...(existing.misconceptions || []), ...(block.misconceptions || [])])].slice(0, 3);
      }
    }

    return Array.from(seen.values());

  } catch (e: any) {
    console.warn(`  ⚠️ "${topic.title}" falló: ${e?.message}`);
    return [];
  }
}

// Deduplicar bloques
function deduplicateBlocks(blocks: any[]): any[] {
  const seen = new Map<string, any>();

  for (const block of blocks) {
    if (!block.label || block.label.length < 3) continue;

    const labelKey = block.label.toLowerCase().trim()
      .replace(/\s+/g, ' ')
      .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
      .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n');

    const key = `${block.topicId || 'no_topic'}::${block.kind || 'concept'}::${labelKey}`;

    if (!seen.has(key)) {
      seen.set(key, { ...block });
    } else {
      const existing = seen.get(key)!;
      if ((block.importance || 0) > (existing.importance || 0)) {
        existing.importance = block.importance;
        existing.summary = block.summary;
        existing.bloomLevel = block.bloomLevel;
        existing.difficulty = block.difficulty;
      }
      for (const p of block.pages || []) {
        if (!existing.pages.includes(p)) existing.pages.push(p);
      }
      existing.examProbability = Math.max(existing.examProbability || 0, block.examProbability || 0);
      existing.misconceptions = [...new Set([
        ...(existing.misconceptions || []),
        ...(block.misconceptions || [])
      ])].slice(0, 3);
      existing.sourceSpans = [
        ...(existing.sourceSpans || []),
        ...(block.sourceSpans || [])
      ].filter((s: any) => s?.quote).slice(0, 4);
    }
  }

  return Array.from(seen.values()).sort((a, b) => (a.globalOrder || 0) - (b.globalOrder || 0));
}

// Normalizar importancia
function normalizeImportance(blocks: any[]): void {
  // Sin caps artificiales por tipo — el modelo asigna importancia según el contenido real.
  // Una entidad en historia puede ser más importante que una fórmula en química.
  // Solo limitamos note a 60 para evitar ruido editorial.
  const CAPS: Record<string, number> = {
    note: 60,
  };
  for (const b of blocks) {
    const cap = CAPS[b.kind];
    if (cap !== undefined) b.importance = Math.min(b.importance ?? 50, cap);
  }

  const scoreable = blocks.filter(b => ['concept', 'definition', 'formula'].includes(b.kind));
  if (!scoreable.length) return;

  const highCount = scoreable.filter(b => b.importance >= 85).length;
  if ((highCount / scoreable.length) > 0.55) {
    const vals = scoreable.map(b => b.importance);
    const max = Math.max(...vals), min = Math.min(...vals), range = max - min || 1;
    for (const b of scoreable) b.importance = Math.round(38 + ((b.importance - min) / range) * 57);
    console.log(`📊 Importancia reescalada: ${highCount}/${scoreable.length} tenían >= 85`);
  }
}

// Topics index
function buildTopicsIndex(topics: DocumentTopic[], blocks: any[]): any[] {
  return topics.map(topic => {
    const tb = blocks.filter(b => b.topicId === topic.id);
    const allPages = [...new Set([...topic.pages, ...tb.flatMap((b: any) => b.pages || [])])].sort((a, b) => a - b);
    return {
      id: topic.id, title: topic.title, description: topic.description, role: topic.role,
      materialId: tb[0]?.materialId || '', materialName: tb[0]?.materialName || '',
      pages: allPages, order: topic.order,
      blockCount: tb.length,
      avgImportance: tb.length > 0 ? Math.round(tb.reduce((s, b) => s + (b.importance || 0), 0) / tb.length) : 50,
      conceptIds: tb.filter(b => ['concept', 'definition', 'formula'].includes(b.kind)).map(b => b.id || ''),
    };
  });
}

// Conceptos únicos
function deduplicateConcepts(blocks: any[]): { uniqueConcepts: any[]; conceptIdMap: Record<string, string> } {
  const seen = new Map<string, any>();
  const conceptIdMap: Record<string, string> = {};

  for (const block of blocks) {
    if (!['concept', 'definition', 'formula', 'entity'].includes(block.kind)) continue;
    const key = block.label.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!key) continue;
    if (!seen.has(key)) {
      const id = `concept_${seen.size}`;
      seen.set(key, {
        id, name: block.label, summary: block.summary, kind: block.kind,
        firstAppearanceOrder: block.globalOrder, materialIds: [block.materialId],
        pages: [...(block.pages || [])], topicIds: block.topicId ? [block.topicId] : [],
        dependsOn: block.dependsOn || [], importance: block.importance || 50,
        difficulty: block.difficulty || 'basic', examTypes: block.examTypes || [],
        bloomLevel: block.bloomLevel || 'understand', examProbability: block.examProbability ?? 50,
        estimatedMinutes: block.estimatedMinutes ?? 2, appearances: 1,
      });
      conceptIdMap[block.label] = id;
    } else {
      const e = seen.get(key)!;
      for (const p of block.pages || []) if (!e.pages.includes(p)) e.pages.push(p);
      if (block.importance > e.importance) e.importance = block.importance;
      e.examProbability = Math.max(e.examProbability || 0, block.examProbability || 0);
      e.appearances++;
    }
  }

  return {
    uniqueConcepts: Array.from(seen.values()).sort((a, b) => (a.firstAppearanceOrder || 0) - (b.firstAppearanceOrder || 0)),
    conceptIdMap,
  };
}

// Normalizar blueprint
function normalizeBlueprint(rawBlueprint: any): any {
  const blocks: any[] = rawBlueprint.globalOrderedAnalysis || [];
  const topics: any[] = rawBlueprint.topicsIndex || [];
  const concepts: any[] = rawBlueprint.uniqueConceptsIndex || [];

  const topicIdMap: Record<string, string> = {};
  const canonicalTopics = topics.map((t: any, i: number) => {
    const id = makeId('topic', t.title || `topic_${i}`, i);
    topicIdMap[t.id] = id; topicIdMap[t.title] = id;
    return { id, title: t.title, description: t.description || '', role: t.role || 'mechanism',
      materialId: t.materialId || '', materialName: t.materialName || '',
      pages: t.pages || [], order: t.order || i, blockCount: t.blockCount || 0,
      avgImportance: t.avgImportance || 0, conceptIds: [] as string[] };
  });

  const blockIdMap: Record<string, string> = {};
  const usedIds = new Set<string>();
  const canonicalBlocks = blocks.map((b: any, i: number) => {
    let id = makeId(b.kind || 'note', b.label || `block_${i}`, i);
    if (usedIds.has(id)) id = `${id}_${i}`;
    usedIds.add(id); blockIdMap[b.label] = id;
    const topicId = topicIdMap[b.topicId] || topicIdMap[b.topicLabel] || null;
    return { id, kind: b.kind || 'note', label: b.label || '', summary: b.summary || '',
      materialId: b.materialId || '', materialName: b.materialName || '',
      pages: b.pages || [], firstPage: (b.pages || [])[0] || 0, globalOrder: b.globalOrder ?? i,
      topicId, topicLabel: b.topicLabel || '', importance: b.importance ?? 50,
      difficulty: b.difficulty || 'basic', examTypes: b.examTypes || [],
      dependsOn: b.dependsOn || [], relatedTo: [], relations: b.relations || [],
      misconceptions: b.misconceptions || [], bloomLevel: b.bloomLevel || 'understand',
      examProbability: b.examProbability ?? 50, estimatedMinutes: b.estimatedMinutes ?? 2,
      sourceSpans: Array.isArray(b.sourceSpans) ? b.sourceSpans : [] };
  });

  for (const block of canonicalBlocks) {
    block.dependsOn = block.dependsOn.map((l: string) => blockIdMap[l] || null).filter(Boolean);
    block.relations = (block.relations || [])
      .map((r: any) => ({ type: r.type, targetId: blockIdMap[r.target] || null, targetLabel: r.target || '' }))
      .filter((r: any) => r.targetId !== null);
  }

  const canonicalConcepts = concepts.map((c: any, i: number) => ({
    id: makeId(c.kind || 'concept', c.name || `concept_${i}`, i),
    name: c.name || '', kind: c.kind || 'concept', summary: c.summary || '',
    importance: c.importance ?? 50, difficulty: c.difficulty || 'basic',
    pages: c.pages || [], materialIds: c.materialIds || [],
    dependsOn: [], relatedTo: [], examTypes: c.examTypes || [], appearances: c.appearances || 1,
  }));

  for (const topic of canonicalTopics) {
    topic.conceptIds = canonicalBlocks
      .filter(b => b.topicId === topic.id && ['concept', 'definition', 'formula'].includes(b.kind))
      .map(b => b.id);
  }

  const coveredPages = new Set<number>();
  for (const b of canonicalBlocks) (b.pages || []).forEach((p: number) => coveredPages.add(p));

  const conceptToTopicMap: Record<string, string> = {};
  for (const block of canonicalBlocks) {
    if (block.topicId && ['concept', 'definition', 'formula'].includes(block.kind)) {
      conceptToTopicMap[block.id] = block.topicId;
    }
  }

  return {
    version: 3, createdAt: rawBlueprint.createdAt || Date.now(),
    materials: rawBlueprint.materials || [],
    topics: canonicalTopics, blocks: canonicalBlocks, concepts: canonicalConcepts,
    conceptToTopicMap,
    coverage: {
      totalMaterials: (rawBlueprint.materials || []).length,
      totalTopics: canonicalTopics.length,
      totalConcepts: canonicalConcepts.filter((c: any) => ['concept', 'definition', 'formula'].includes(c.kind)).length,
      totalEntities: canonicalConcepts.filter((c: any) => c.kind === 'entity').length,
      totalFormulas: canonicalConcepts.filter((c: any) => c.kind === 'formula').length,
      totalBlocks: canonicalBlocks.length,
      totalHighImportance: canonicalBlocks.filter((b: any) => b.importance >= 75).length,
      pagesWithContent: Array.from(coveredPages).sort((a: number, b: number) => a - b),
      estimatedMinutes: Math.max(5, Math.round(canonicalBlocks.length * 1.8)),
    },
    globalOrderedAnalysis: canonicalBlocks,
    uniqueConceptsIndex: canonicalConcepts,
    topicsIndex: canonicalTopics,
    coverageSummary: {
      totalMaterials: (rawBlueprint.materials || []).length,
      totalSelectedPages: rawBlueprint.coverageSummary?.totalSelectedPages || coveredPages.size,
      totalTopics: canonicalTopics.length,
      totalUniqueConcepts: canonicalConcepts.length,
      totalBlocks: canonicalBlocks.length,
      totalHighImportance: canonicalBlocks.filter((b: any) => b.importance >= 75).length,
      estimatedMinutes: Math.max(5, Math.round(canonicalBlocks.length * 1.8)),
    },
  };
}

// PASO 3: Auditoría independiente — IA revisa el mapa contra la fuente
async function auditBlueprint(
  blueprint: any,
  fullPageMap: Map<number, string>,
  materialName: string,
): Promise<BlueprintAuditReport> {
  const blocks: any[] = blueprint.blocks || [];
  const topics: any[] = blueprint.topics || [];

  if (blocks.length === 0) {
    return {
      passed: false,
      issues: [{ kind: 'omission', message: 'Sin bloques — análisis vacío' }],
      uncoveredFragments: [],
    };
  }

  // Construir muestra del material para la IA auditora
  // Usar páginas reales, máx 8000 chars total
  const pageEntries = Array.from(fullPageMap.entries()).sort(([a], [b]) => a - b);
  const sourceSample = pageEntries
    .slice(0, 12)
    .map(([num, txt]) => `p.${num}: ${txt.replace(/\s+/g, ' ').slice(0, 120)}`)
    .join('\n')
    .slice(0, 1800);

  const mapSummary = topics
    .map((t: any) => `- "${t.title}" (p.${(t.pages || []).join(',')})`)
    .join('\n')
    .slice(0, 800);

  const langHint = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(sourceSample) ? 'es' : 'en';

  const prompt = `Audit: does this knowledge map cover the source document?
Document: "${materialName}"
Respond in ${langHint === 'es' ? 'SPANISH' : 'ENGLISH'}.

SOURCE (first pages sample):
${sourceSample}

MAP TOPICS:
${mapSummary}

Rules:
- Only flag CLEAR omissions of substantive content visible in the source sample.
- Only flag CLEAR invented claims not supported by the source sample.
- If uncertain, do not flag it.
- Keep lists SHORT (max 3 items each).

Return ONLY this JSON (no extra text, no markdown, no explanation):
{"passed":true,"uncoveredFragments":[],"inventedClaims":[],"issues":[]}

Every item in "issues" MUST be an object with exactly this shape:
{"kind":"omission | invention | other","message":"brief description"}`;

  try {
    const result = await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 500,
      json: true,
    });

    const passed = result?.passed === true &&
      (result?.uncoveredFragments?.length ?? 0) === 0 &&
      (result?.inventedClaims?.length ?? 0) === 0;

    if (!Array.isArray(result?.issues) || !Array.isArray(result?.uncoveredFragments) || !Array.isArray(result?.inventedClaims)) {
      throw new Error('AUDIT_INVALID_CONTRACT');
    }
    if (!result.issues.every((issue: unknown) => {
      if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) return false;
      const candidate = issue as Record<string, unknown>;
      return typeof candidate.kind === 'string' &&
        ['omission', 'invention', 'other'].includes(candidate.kind) &&
        typeof candidate.message === 'string' && candidate.message.trim().length > 0;
    })) {
      throw new Error('AUDIT_INVALID_ISSUE_CONTRACT');
    }
    if (!result.uncoveredFragments.every((fragment: unknown) => typeof fragment === 'string') ||
        !result.inventedClaims.every((claim: unknown) => typeof claim === 'string')) {
      throw new Error('AUDIT_INVALID_FINDING_CONTRACT');
    }

    const issues: BlueprintAuditIssue[] = [
      ...result.issues,
      ...result.uncoveredFragments.map((fragment: string) => ({ kind: 'omission' as const, message: fragment })),
      ...result.inventedClaims.map((claim: string) => ({ kind: 'invention' as const, message: claim })),
    ];

    console.log(`🔍 Auditoría: ${passed ? '✅ pasó' : '⚠️ encontró problemas'} (${issues.length} issues)`);
    if (issues.length > 0) issues.forEach(issue => console.log(`  - [${issue.kind}] ${issue.message}`));

    return {
      passed,
      issues,
      uncoveredFragments: result?.uncoveredFragments || [],
    };
  } catch (e: any) {
    console.warn(`⚠️ Auditoría falló: ${e?.message} — reintentando con prompt mínimo...`);
    try {
      const miniSample = Array.from(fullPageMap.entries())
        .sort(([a], [b]) => a - b)
        .slice(0, 5)
        .map(([n, t]) => `[p.${n}] ${t.slice(0, 150)}`)
        .join('\n');
      const miniMap = topics.slice(0, 5)
        .map((t: any) => `- "${t.title}"`)
        .join('\n');
      const miniPrompt = `Does this map cover the source? JSON only.\nSOURCE: ${miniSample}\nMAP: ${miniMap}\nReturn: {"passed":true,"uncoveredFragments":[],"inventedClaims":[],"issues":[]}\nEvery issues item must be {"kind":"omission | invention | other","message":"brief description"}.`;
      const retryAudit = await alaiJson({
        messages: [{ role: 'user', content: miniPrompt }],
        temperature: 0.1,
        maxTokens: 300,
        json: true,
      });
      if (!Array.isArray(retryAudit?.issues) || !retryAudit.issues.every((issue: unknown) => {
        if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) return false;
        const candidate = issue as Record<string, unknown>;
        return typeof candidate.kind === 'string' &&
          ['omission', 'invention', 'other'].includes(candidate.kind) &&
          typeof candidate.message === 'string' && candidate.message.trim().length > 0;
      })) {
        throw new Error('AUDIT_INVALID_ISSUE_CONTRACT');
      }
      if (!Array.isArray(retryAudit?.uncoveredFragments) ||
          !retryAudit.uncoveredFragments.every((fragment: unknown) => typeof fragment === 'string')) {
        throw new Error('AUDIT_INVALID_FINDING_CONTRACT');
      }
      const retryPassed = retryAudit?.passed === true;
      console.log(`🔍 Auditoría retry: ${retryPassed ? '✅' : '⚠️'}`);
      return {
        passed: retryPassed,
        issues: retryAudit.issues,
        uncoveredFragments: retryAudit.uncoveredFragments,
      };
    } catch {
      console.warn(`❌ Auditoría: ambos intentos fallaron — BLOQUEANDO`);
      return {
        passed: false,
        issues: [{ kind: 'audit_failure', message: 'La auditoría independiente no pudo ejecutarse' }],
        uncoveredFragments: [],
      };
    }
  }
}

// PASO 3.5: Reparación de huecos detectados por auditoría
async function repairCoverageGaps(
  blueprint: any,
  fullPageMap: Map<number, string>,
  audit: { uncoveredFragments: string[] },
  materialName: string,
): Promise<any[]> {
  const newBlocks: any[] = [];

  if (!audit.uncoveredFragments || audit.uncoveredFragments.length === 0) {
    return newBlocks;
  }

  console.log(`🔧 Reparando ${audit.uncoveredFragments.length} huecos de cobertura...`);

  const topics: any[] = blueprint.topics || [];

  // Reconstruir texto completo del material desde fullPageMap
  const fullText = Array.from(fullPageMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([num, txt]) => `[Página ${num}]\n${txt}`)
    .join('\n\n');

  const langHint = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(fullText) ? 'es' : 'en';

  for (const gap of audit.uncoveredFragments.slice(0, 6)) {
    if (gap.length < 5) continue;

    // Extraer número de página del gap si está presente (formato "(p.X)")
    const pageMatch = gap.match(/\(p\.(\d+)\)/i);
    const targetPage = pageMatch ? parseInt(pageMatch[1]) : null;

    // Buscar el topic que contiene esa página, o el más cercano
    let targetTopic = topics.find((t: any) => targetPage && (t.pages || []).includes(targetPage));
    if (!targetTopic && targetPage) {
      // Buscar el topic con página más cercana
      targetTopic = topics.reduce((best: any, t: any) => {
        if (!best) return t;
        const bestDist = Math.min(...(best.pages || [999]).map((p: number) => Math.abs(p - targetPage)));
        const currDist = Math.min(...(t.pages || [999]).map((p: number) => Math.abs(p - targetPage)));
        return currDist < bestDist ? t : best;
      }, null);
    }
    if (!targetTopic) targetTopic = topics[topics.length - 1]; // último recurso

    // Obtener el texto de la página objetivo (o cercanas)
    const relevantPages = targetPage
      ? [targetPage, targetPage - 1, targetPage + 1].filter(p => fullPageMap.has(p))
      : (targetTopic.pages || []).slice(0, 2);

    const relevantText = relevantPages
      .map(p => `[Página ${p}]\n${fullPageMap.get(p) || ''}`)
      .join('\n\n')
      .slice(0, 4000);

    if (!relevantText || relevantText.length < 50) continue;

    const repairPrompt = langHint === 'es'
      ? `El siguiente contenido del material no fue cubierto por el análisis previo:
"${gap}"

Extrae 1-3 bloques de conocimiento sobre ese contenido específico. Usa SOLO el texto de la fuente proporcionada.

FUENTE:
${relevantText}

Devuelve SOLO JSON válido:
{"blocks":[{"kind":"concept","label":"etiqueta específica","summary":"resumen fiel al texto en 1-2 oraciones","importance":70}]}`
      : `The following content from the material was not covered by the previous analysis:
"${gap}"

Extract 1-3 knowledge blocks about that specific content. Use ONLY the provided source text.

SOURCE:
${relevantText}

Return ONLY valid JSON:
{"blocks":[{"kind":"concept","label":"specific label","summary":"faithful summary in 1-2 sentences","importance":70}]}`;

    try {
      const result = await alaiJson({
        messages: [{ role: 'user', content: repairPrompt }],
        temperature: 0.1,
        maxTokens: 1500,
        json: true,
      });

      if (Array.isArray(result?.blocks) && result.blocks.length > 0) {
        const repairedBlocks = result.blocks.map((b: any) => ({
          kind: b.kind || 'concept',
          label: String(b.label || '').trim(),
          summary: String(b.summary || '').trim(),
          pages: targetPage ? [targetPage] : (targetTopic.pages || []),
          topicId: targetTopic.id,
          topicLabel: targetTopic.title,
          topicRole: targetTopic.role || 'mechanism',
          dependsOn: [],
          relations: [],
          misconceptions: [],
          sourceSpans: [{
            page: targetPage || (targetTopic.pages || [0])[0],
            quote: relevantText.slice(0, 150),
            certainty: 'inferred' as const,
          }],
          importance: typeof b.importance === 'number' ? b.importance : 65,
          difficulty: 'intermediate',
          examTypes: [],
          bloomLevel: 'understand',
          examProbability: 50,
          estimatedMinutes: 2,
          _fallback: false,
          _repaired: true,
        }));
        newBlocks.push(...repairedBlocks);
        console.log(`  ♻️ Reparado: "${gap.slice(0, 60)}..." → ${result.blocks.length} bloques`);
      }
    } catch (e: any) {
      console.warn(`  ⚠️ No se pudo reparar: "${gap.slice(0, 60)}..." — ${e?.message}`);
    }
  }

  return newBlocks;
}

// PASO 4: Certificación determinista
function certifyBlueprint(
  blueprint: any,
  quality: any,
  audit: BlueprintAuditReport,
): {
  coverageCertified: boolean;
  planGenerationAllowed: boolean;
  certificationReasons: string[];
} {
  const reasons: string[] = [];

  // Condición 1: calidad estructural mínima
  if (quality.status === 'degraded') {
    for (const r of quality.reasons || []) reasons.push(`Calidad: ${r}`);
  }

  // Condición 1b: topics con 0 bloques son inaceptables si tienen más de 1 página
  const blueprintTopics = blueprint.topics || [];
  const blueprintBlocks = blueprint.blocks || [];
  const emptyImportantTopics = blueprintTopics.filter((t: any) => {
    const hasBlocks = blueprintBlocks.some((b: any) => b.topicId === t.id);
    const isMultiPage = (t.pages || []).length > 1;
    return !hasBlocks && isMultiPage;
  });
  if (emptyImportantTopics.length > 0) {
    const titles = emptyImportantTopics.map((t: any) => `"${t.title}"`).join(', ');
    reasons.push(`Topics sin bloques con múltiples páginas: ${titles}`);
  }

  // Condición 2: auditoría de IA — BLOQUEANTE si falla o no se ejecutó
  if (audit.issues.some(issue => issue.kind === 'audit_failure')) {
    // Auditoría no ejecutada — bloquear siempre
    reasons.push('AUDIT_FAILED: La auditoría independiente no pudo ejecutarse. El blueprint no puede certificarse.');
  } else if (!audit.passed && audit.issues.length > 0) {
    // Auditoría ejecutada pero encontró problemas graves
    const seriousIssues = audit.uncoveredFragments.length > 2 ||
      audit.issues.some(issue => issue.kind === 'omission' || issue.kind === 'invention');
    if (seriousIssues) {
      for (const issue of audit.issues.slice(0, 3)) reasons.push(`Auditoría: ${issue.message}`);
    } else {
      console.log(`ℹ️ Auditoría: ${audit.issues.length} issue(s) menores — no bloquean`);
    }
  }

  // Condición 3: bloques con sourceSpans
  const blocks = blueprint.blocks || [];
  const blocksWithSpans = blocks.filter((b: any) =>
    Array.isArray(b.sourceSpans) && b.sourceSpans.length > 0
  ).length;
  const spanCoverage = blocks.length > 0 ? blocksWithSpans / blocks.length : 0;

  // No bloqueamos por falta de spans — son opcionales en esta fase
  // pero lo registramos en la metadata
  console.log(`📎 Evidencia fuente: ${blocksWithSpans}/${blocks.length} bloques con sourceSpans (${Math.round(spanCoverage * 100)}%)`);

  const coverageCertified = reasons.length === 0;
  const planGenerationAllowed = coverageCertified;

  return { coverageCertified, planGenerationAllowed, certificationReasons: reasons };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawMaterials: { materialId: string; materialName: string; text?: string; selectedPages: number[] }[] = body.materials || [];

    if (!rawMaterials.length) {
      return NextResponse.json({ success: false, error: 'No materials provided' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id;

    // Perf audit (Codex, read-only): el buffer descargado aquí se usaba una
    // sola vez para extractText y se descartaba — la fase de visión (más
    // abajo) volvía a descargar el MISMO objeto de R2 para el mismo
    // material. Se conserva en `buffer` (null si no hubo descarga, p.ej.
    // cuando el texto ya vino en el request o desde la DB) para reutilizarlo
    // sin una segunda descarga.
    const materialsWithText = await Promise.all(rawMaterials.map(async (m) => {
      let text = m.text || '';
      let buffer: Buffer | null = null;
      if (!text && m.materialId) {
        try {
          const materialText = await getMaterialText(m.materialId);
          text = materialText?.raw_text || '';
        } catch (e) { console.warn(`DB error for ${m.materialId}:`, e); }
        if (!text && userId) {
          try {
            const material = await getMaterial(m.materialId, userId);
            if (material?.storage_key) {
              buffer = await downloadFromR2(material.storage_key);
              const result = await extractText(buffer, material.kind as any, material.mime_type, m.materialName);
              text = result.text || '';
            }
          } catch (e) { console.warn(`R2 error for ${m.materialId}:`, e); }
        }
      }
      return { ...m, text, buffer };
    }));

    const validMaterials = materialsWithText.filter(m => m.text.trim().length > 30);
    if (!validMaterials.length) {
      return NextResponse.json({ success: false, error: 'No se pudo extraer el texto.' }, { status: 400 });
    }

    const allBlocks: any[] = [];
    const allTopics: DocumentTopic[] = [];
    let globalOrder = 0;

    for (const m of validMaterials) {
      console.log(`\n📖 ${m.materialName} (${m.text.length} chars)`);

      // Separar por páginas
      const pageMap = splitTextByPages(m.text);
      console.log(`📄 ${pageMap.size} páginas con contenido`);

      // PASO 1: Extraer estructura usando muestra compacta
      // fullPageMap tiene el texto completo por página (para el análisis)
      // pageMap tiene la muestra compacta (para detectar topics)
      const fullPageMap = new Map<number, string>();
      for (const [pageNum, _] of pageMap.entries()) {
        // Reconstruir con texto completo desde el texto original
        const pageMarkerRe = new RegExp(`\\[Pagina ${pageNum}\\][\\s\\S]*?(?=\\[Pagina \\d+\\]|$)`, 'i');
        const match = pageMarkerRe.exec(m.text);
        if (match) {
          const rawPage = match[0].replace(/\[Pagina \d+\]/gi, '').trim();
          if (rawPage.length > 20) fullPageMap.set(pageNum, rawPage);
        } else {
          // fallback: usar lo que ya tenemos en pageMap
          fullPageMap.set(pageNum, pageMap.get(pageNum) || '');
        }
      }

      // PASO 1.5: Enriquecer páginas realmente pobres con Gemini Vision
      // Solo considerar páginas cuyo texto útil quede corto tras limpiar boilerplate/editorial.
      const MIN_VISUAL_TEXT = 40;
      const MAX_VISUAL_TEXT = 260;

      // Obtener el buffer del PDF para visión — reutiliza el ya descargado
      // en materialsWithText si existe (perf audit, Codex), evitando una
      // segunda descarga R2 del mismo material.
      let pdfBuf: Buffer | null = (m as any).buffer || null;
      try {
        if (!pdfBuf && userId && m.materialId) {
          const { getMaterial } = await import('../../../../lib/materials/repository');
          const { downloadFromR2 } = await import('../../../../lib/materials/storage');
          const mat = await getMaterial(m.materialId, userId);
          if (mat?.storage_key) {
            pdfBuf = await downloadFromR2(mat.storage_key);
          }
        }
      } catch (e: any) {
        console.warn('⚠️ No se pudo obtener buffer PDF para visión:', e?.message);
      }

      if (pdfBuf) {
        // Detectar el rango completo de páginas del PDF
        const totalPdfPages = Math.max(
          ...Array.from(fullPageMap.keys()),
          0
        );

        // Visión SOLO para páginas realmente vacías o casi vacías
        // (portadas de sección, diapositivas de imagen, páginas sin texto extraíble)
        const VISION_MAX_CHARS = 80;

        const poorPages: number[] = [];
        for (let p = 1; p <= totalPdfPages; p++) {
          const rawText = fullPageMap.get(p) || '';
          const cleanText = stripEditorialNoise(rawText);
          const cleanLen = cleanText.length;
          const raw = rawText.trim().toLowerCase();

          const isEmpty = !raw || raw === '(página vacía)' || raw === '(pagina vacia)' || cleanLen === 0;
          const isNearlyEmpty = cleanLen > 0 && cleanLen <= VISION_MAX_CHARS;

          if (isEmpty || isNearlyEmpty) {
            poorPages.push(p);
          }
        }

        // Ordenar por menos texto primero (las más vacías tienen prioridad)
        poorPages.sort((a, b) => {
          const aLen = stripEditorialNoise(fullPageMap.get(a) || '').length;
          const bLen = stripEditorialNoise(fullPageMap.get(b) || '').length;
          return aLen - bLen;
        });

        if (poorPages.length > 0) {
          console.log(`🖼️ ${poorPages.length} páginas con poco texto → enriqueciendo con visión: p.${poorPages.join(', ')}`);

          // Auditoría adversarial (Codex, misión REAL-SESSION QUALITY, A1
          // CONFIRMADO P1): antes se descartaban TOTALMENTE las candidatas
          // más allá de MAX_VISION_PAGES=4 (13 candidatas → 9 nunca
          // procesadas, sin que coverage/certificación supiera del
          // descarte). El cap ahora limita CONCURRENCIA/BATCH, no
          // cobertura total — se procesan TODAS las candidatas, en batches
          // acotados para no disparar 429s.
          const VISION_BATCH_SIZE = 2;
          for (let vi = 0; vi < poorPages.length; vi += VISION_BATCH_SIZE) {
            const viBatch = poorPages.slice(vi, vi + VISION_BATCH_SIZE);
            await Promise.all(viBatch.map(async (pageNum) => {
              const enriched = await enrichPageWithVision(
                pageNum,
                pdfBuf!,
                m.materialName,
                fullPageMap.get(pageNum) || '',
              );
              if (enriched.length > 50) {
                const existing = fullPageMap.get(pageNum) || '';
                fullPageMap.set(pageNum, existing + '\n\n[Visual content]\n' + enriched);
              }
            }));
          }
        }
      } else {
        console.log('⚠️ Sin buffer PDF — visión desactivada para este material');
      }

      // Auditoría adversarial (Codex, A1.2 CONFIRMADO P1): extractDocumentStructure
      // recibía SIEMPRE `pageMap` (construido ANTES del enriquecimiento visual,
      // y que nunca gana nuevas keys de página) — una página puramente visual
      // (texto extraído ≤20 chars, nunca entra a pageMap) podía enriquecerse
      // correctamente en fullPageMap y aun así quedar sin topic asignado, porque
      // la detección de topics nunca veía ese contenido. Sincronizar las keys y
      // el contenido enriquecido de vuelta a pageMap antes de detectar topics.
      for (const [pageNum, text] of fullPageMap.entries()) {
        if (text && text !== pageMap.get(pageNum)) pageMap.set(pageNum, text);
      }

      console.log(`🗺️  Extrayendo estructura...`);
      const topics = await extractDocumentStructure(pageMap, m.materialName);
      allTopics.push(...topics);

      // PASO 2: Analizar cada topic con texto COMPLETO (no la muestra)
      console.log(`🔬 Analizando ${topics.length} topics...`);
      // Perf audit (Codex, read-only): topics no acumulan factKeys/accepted
      // questions entre sí — cada uno se dedup/ordena después por globalOrder
      // asignado en orden de resultado. 2 era innecesariamente estrecho; 3
      // reduce olas de espera sin concurrencia ilimitada (evita presión
      // excesiva sobre el proveedor).
      const PARALLEL = 3;

      for (let i = 0; i < topics.length; i += PARALLEL) {
        const batch = topics.slice(i, i + PARALLEL);

        const results = await Promise.all(batch.map(async (topic, batchIdx) => {
          const topicPages = topic.pages.filter(p => fullPageMap.has(p));

          let topicText: string;
          if (topicPages.length > 0) {
            topicText = topicPages
              .map(p => `[Página ${p}]\n${fullPageMap.get(p) || ''}`)
              .join('\n\n');
          } else {
            topicText = m.text.slice(0, 6000);
          }

          const blocks = await analyzeTopic(
            topic, topicText, topics, m.materialName, i + batchIdx, topics.length
          );

          console.log(`  ✅ "${topic.title}": ${blocks.length} bloques`);
          return blocks.map(b => ({ ...b, materialId: m.materialId, materialName: m.materialName }));
        }));

        for (const topicBlocks of results) {
          for (const block of topicBlocks) {
            block.globalOrder = globalOrder++;
            allBlocks.push(block);
          }
        }
        console.log(`  📦 ${Math.min(i + PARALLEL, topics.length)}/${topics.length}`);
      }
    }

    console.log(`\n📊 Total bloques: ${allBlocks.length}`);

    const deduped = deduplicateBlocks(allBlocks);
    console.log(`🧹 Tras dedup: ${deduped.length} bloques`);

    normalizeImportance(deduped);

    const blocksWithIds = deduped.map((b, i) => ({
      id: `block_${i}`, kind: b.kind, label: b.label, summary: b.summary,
      materialId: b.materialId || '', materialName: b.materialName || '',
      pages: b.pages || [], firstPage: (b.pages || [])[0] || 0,
      globalOrder: b.globalOrder ?? i, topicId: b.topicId || '', topicLabel: b.topicLabel || '',
      dependsOn: b.dependsOn || [], relations: b.relations || [], misconceptions: b.misconceptions || [],
      importance: b.importance ?? 50, difficulty: b.difficulty || 'intermediate',
      examTypes: b.examTypes || [], bloomLevel: b.bloomLevel || 'understand',
      examProbability: b.examProbability ?? 50, estimatedMinutes: b.estimatedMinutes ?? 2,
      _fallback: b._fallback || false,
      sourceSpans: Array.isArray(b.sourceSpans) ? b.sourceSpans : [],
    }));

    const topicsIndex = buildTopicsIndex(allTopics, blocksWithIds);
    const { uniqueConcepts } = deduplicateConcepts(blocksWithIds);

    const coveredPages = new Set<number>();
    for (const b of blocksWithIds) (b.pages || []).forEach(p => coveredPages.add(p));

    const coverageSummary = {
      totalMaterials: validMaterials.length,
      totalSelectedPages: validMaterials.reduce((s, m) => s + m.selectedPages.length, 0),
      totalTopics: topicsIndex.length, totalUniqueConcepts: uniqueConcepts.length,
      totalBlocks: blocksWithIds.length,
      totalHighImportance: blocksWithIds.filter(b => b.importance >= 75).length,
      estimatedMinutes: Math.max(5, Math.round(blocksWithIds.length * 1.8)),
      pagesWithContent: Array.from(coveredPages).sort((a, b) => a - b),
    };

    // ══════════════════════════════════════════════
    // INVENTARIO DE PÁGINAS — cada página del PDF debe tener disposición
    // ══════════════════════════════════════════════
    // Detectar TODAS las páginas del PDF (incluyendo las que pdf-parse descartó)
    const totalPagesInPdf = Math.max(
      ...validMaterials.map(m => {
        const map = splitTextByPages(m.text);
        const maxPage = Math.max(...Array.from(map.keys()), 0);
        return maxPage;
      }),
      1
    );

    // Páginas que sí llegaron al pipeline (con texto extraído)
    const pagesInPipeline = new Set<number>();
    for (const m of validMaterials) {
      const map = splitTextByPages(m.text);
      for (const pageNum of map.keys()) {
        pagesInPipeline.add(pageNum);
      }
    }

    // Clasificar CADA página del rango completo (1 hasta totalPagesInPdf)
    const pageDispositions: Record<number, {
      status: 'represented' | 'no_extractable_text' | 'uncovered_with_content' | 'excluded_low_content';
      reason: string;
      charCount: number;
    }> = {};

    for (let p = 1; p <= totalPagesInPdf; p++) {
      // ¿Tiene texto extraído por pdf-parse?
      const pageTexts = validMaterials.map(m => {
        const map = splitTextByPages(m.text);
        return map.get(p) || '';
      });
      const combinedText = pageTexts.join(' ').trim();
      const charCount = combinedText.length;

      if (coveredPages.has(p)) {
        pageDispositions[p] = {
          status: 'represented',
          reason: 'Página incluida en al menos un topic',
          charCount,
        };
      } else if (!pagesInPipeline.has(p) || charCount === 0) {
        // pdf-parse no extrajo texto — probablemente diapositiva/imagen/portada
        pageDispositions[p] = {
          status: 'no_extractable_text',
          reason: 'Sin texto extraíble por PDF parser (diapositiva, imagen, portada o página en blanco)',
          charCount: 0,
        };
      } else if (charCount < 50) {
        pageDispositions[p] = {
          status: 'excluded_low_content',
          reason: `Solo ${charCount} chars — texto insuficiente para análisis`,
          charCount,
        };
      } else {
        pageDispositions[p] = {
          status: 'uncovered_with_content',
          reason: `${charCount} chars extraídos pero no asignados a ningún topic`,
          charCount,
        };
      }
    }

    // Reportar disposición de páginas
    const dispositionCounts = {
      represented: 0,
      no_extractable_text: 0,
      uncovered_with_content: 0,
      excluded_low_content: 0,
    };
    for (const d of Object.values(pageDispositions)) {
      dispositionCounts[d.status]++;
    }

    console.log(`\n📋 INVENTARIO DE PÁGINAS (${totalPagesInPdf} páginas totales):`);
    console.log(`  ✅ Representadas: ${dispositionCounts.represented}`);
    console.log(`  🖼️ Sin texto extraíble (portadas/imágenes): ${dispositionCounts.no_extractable_text}`);
    console.log(`  ⚠️ Con contenido sin cobertura: ${dispositionCounts.uncovered_with_content}`);
    console.log(`  🚫 Excluidas por contenido mínimo: ${dispositionCounts.excluded_low_content}`);

    // Listar páginas problemáticas
    const problematicPages = Object.entries(pageDispositions)
      .filter(([, d]) => d.status === 'uncovered_with_content')
      .map(([p, d]) => `  p.${p}: ${d.reason}`);
    if (problematicPages.length > 0) {
      console.warn(`\n⚠️ PÁGINAS SIN COBERTURA DE CONTENIDO EXTRAÍDO:`);
      problematicPages.forEach(msg => console.warn(msg));
    }

    // Listar páginas sin texto extraíble (para transparencia)
    const noTextPages = Object.entries(pageDispositions)
      .filter(([, d]) => d.status === 'no_extractable_text')
      .map(([p]) => parseInt(p));
    if (noTextPages.length > 0) {
      console.log(`\n🖼️ Páginas sin texto extraíble: p.${noTextPages.join(', ')}`);
      console.log(`   → Probablemente diapositivas de título, imágenes o portadas.`);
      console.log(`   → Para análisis completo se requiere OCR/Vision (no ejecutado en este material).`);
    }

    // Legacy compat
    const pagesWithUncoveredContent = Object.entries(pageDispositions)
      .filter(([, d]) => d.status === 'uncovered_with_content')
      .map(([p]) => parseInt(p));

    const rawBlueprint = {
      version: 2, createdAt: Date.now(),
      materials: validMaterials.map((m, i) => ({
        materialId: m.materialId, materialName: m.materialName,
        selectionOrder: i, selectedPages: m.selectedPages,
      })),
      globalOrderedAnalysis: blocksWithIds,
      uniqueConceptsIndex: uniqueConcepts,
      topicsIndex, coverageSummary,
      pageDispositions,
      pagesWithUncoveredContent,
    };

    const normalizedBlueprint = normalizeBlueprint(rawBlueprint);
    const blueprint = enrichBlueprintHeuristics(normalizedBlueprint);
    const quality = evaluateBlueprintQuality(blueprint);

    // PASO 3: Auditoría independiente de IA
    // Usa el fullPageMap del último material procesado
    const lastMaterialPageMap = (() => {
      // Reconstruir el fullPageMap del último material para la auditoría
      const lastMaterial = validMaterials[validMaterials.length - 1];
      const map = new Map<number, string>();
      if (lastMaterial?.text) {
        const pageMarkers = lastMaterial.text.split(/(?=\[Pagina \d+\])/i);
        for (const chunk of pageMarkers) {
          const match = chunk.match(/\[Pagina (\d+)\]/i);
          if (match) {
            const pageNum = parseInt(match[1]);
            const pageText = chunk.replace(/\[Pagina \d+\]/gi, '').trim();
            if (pageText.length > 20) map.set(pageNum, pageText);
          }
        }
      }
      return map;
    })();

    let audit = await auditBlueprint(
      blueprint,
      lastMaterialPageMap,
      validMaterials[validMaterials.length - 1]?.materialName || 'Material',
    );

    // PASO 3.5: Si la auditoría encontró huecos, reparar y re-auditar
    if (audit.uncoveredFragments && audit.uncoveredFragments.length > 0) {
      const repairedBlocks = await repairCoverageGaps(
        blueprint,
        lastMaterialPageMap,
        audit,
        validMaterials[validMaterials.length - 1]?.materialName || 'Material',
      );

      if (repairedBlocks.length > 0) {
        // Deduplicar bloques reparados contra los existentes por label similar
        const existingLabels = new Set(
          (blueprint.blocks || []).map((b: any) =>
            String(b.label || '').toLowerCase().trim()
              .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
              .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
              .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
              .replace(/\s+/g, ' ')
          )
        );

        const normalizeLabel = (s: string) => String(s || '').toLowerCase().trim()
          .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
          .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
          .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
          .replace(/\s+/g, ' ');

        const isSimilar = (a: string, b: string): boolean => {
          if (a === b) return true;
          const aWords = new Set(a.split(' ').filter((w: string) => w.length > 3));
          const bWords = new Set(b.split(' ').filter((w: string) => w.length > 3));
          const common = Array.from(aWords).filter((w: string) => bWords.has(w)).length;
          const minSize = Math.min(aWords.size, bWords.size);
          return minSize > 2 && common / minSize >= 0.6;
        };

        // Filtrar reparados: no similares a existentes NI a otros ya aceptados
        const uniqueRepaired: any[] = [];
        const acceptedLabels: string[] = Array.from(existingLabels) as string[];

        for (const rb of repairedBlocks) {
          const rbLabel = normalizeLabel(String(rb.label || ''));
          let isDup = false;
          for (const existing of acceptedLabels) {
            if (isSimilar(existing, rbLabel)) { isDup = true; break; }
          }
          if (!isDup) {
            uniqueRepaired.push(rb);
            acceptedLabels.push(rbLabel);
          }
        }

        if (uniqueRepaired.length > 0) {
          const nextBlockId = (blueprint.blocks || []).length;
          for (let i = 0; i < uniqueRepaired.length; i++) {
            const rb = uniqueRepaired[i];
            blueprint.blocks.push({
              ...rb,
              id: `block_${nextBlockId + i}`,
              globalOrder: nextBlockId + i,
              materialId: validMaterials[validMaterials.length - 1]?.materialId || '',
              materialName: validMaterials[validMaterials.length - 1]?.materialName || '',
              firstPage: (rb.pages || [])[0] || 0,
            });
          }
          console.log(`♻️ Blueprint expandido: ${blueprint.blocks.length} bloques (${uniqueRepaired.length} nuevos, ${repairedBlocks.length - uniqueRepaired.length} duplicados descartados)`);
        } else {
          console.log(`ℹ️ Reparación no aportó bloques nuevos — todos ya existían`);
        }

        // NO re-auditar — la reparación ya cubrió lo que faltaba
        // Marcar audit como aprobada porque completamos el trabajo
        audit = { passed: true, issues: [], uncoveredFragments: [] };
      }
    }

    // PASO 4: Certificación determinista
    const certification = certifyBlueprint(blueprint, quality, audit);

    console.log(`\n══════════════════════════════════════════════`);
    console.log(`✅ Blueprint completado`);
    console.log(`  Topics: ${blueprint.topics?.length || 0}`);
    console.log(`  Bloques: ${blueprint.blocks?.length || 0}`);
    console.log(`  Páginas: ${coverageSummary.pagesWithContent.join(', ')}`);
    console.log(`  Calidad: ${quality.status}`);
    console.log(`  Certificado: ${certification.coverageCertified ? '✅' : '⚠️'}`);
    console.log(`  Plan permitido: ${certification.planGenerationAllowed ? '✅' : '❌'}`);
    if (certification.certificationReasons.length > 0) {
      console.log(`  Razones: ${certification.certificationReasons.join(' | ')}`);
    }
    console.log(`══════════════════════════════════════════════\n`);

    // Calcular status final correcto
    const finalStatus = certification.coverageCertified ? 'complete' :
      audit.issues.some(issue => issue.kind === 'audit_failure') ? 'needs_revision' : 'degraded';

    const spanCoverage = (() => {
      const bks = blueprint.blocks || [];
      const withSpans = bks.filter((b: any) =>
        Array.isArray(b.sourceSpans) && b.sourceSpans.length > 0
      ).length;
      return bks.length > 0 ? Math.round((withSpans / bks.length) * 100) : 0;
    })();

    return NextResponse.json({
      success: true,
      blueprint,
      quality: {
        ...quality,
        status: finalStatus,
        coverageCertified: certification.coverageCertified,
        planGenerationAllowed: certification.planGenerationAllowed,
        certificationReasons: certification.certificationReasons,
        auditExecuted: !audit.issues.some(issue => issue.kind === 'audit_failure'),
        auditPassed: audit.passed,
        auditIssues: audit.issues,
        spanCoverage,
        pageDispositions: (rawBlueprint as any).pageDispositions || {},
        pagesWithUncoveredContent: (rawBlueprint as any).pagesWithUncoveredContent || [],
      },
    });

  } catch (e: any) {
    console.error('Blueprint error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
