import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest, alaiJson } from '../../../../lib/alai';
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

// ─── Tipos ───────────────────────────────────────────────────
interface RawSegment {
  text: string;
  pageHint: number;
  order: number;
  materialId: string;
  materialName: string;
}

interface EnrichedBlock {
  id: string;
  kind: 'topic' | 'concept' | 'entity' | 'definition' | 'formula' | 'example' | 'fact' | 'common_mistake' | 'note';
  label: string;
  summary: string;
  materialId: string;
  materialName: string;
  pages: number[];
  firstPage: number;
  globalOrder: number;
  topicId: string | null;
  topicLabel: string;
  dependsOn: string[];
  relatedTo: string[];
  importance: number;
  difficulty: 'basic' | 'intermediate' | 'advanced';
  examTypes: string[];
  relations?: { type: string; target: string }[] | { type: string; targetId: string | null; targetLabel: string }[];
  misconceptions?: string[];
  bloomLevel?: string;
  examProbability?: number;
  estimatedMinutes?: number;
}

// ─── Paso 1: dividir texto en segmentos por código (sin IA) ──
function segmentTextByCode(
  text: string,
  materialId: string,
  materialName: string,
  selectedPages: number[],
): RawSegment[] {
  const segments: RawSegment[] = [];
  let order = 0;

  const PAGE_MARKER_DETECT = /\[(?:Pagina|Página|Page|pág|pg|p)\.?\s*(\d+)\]/i;
  const PAGE_MARKER_SPLIT = /(?=\[(?:Pagina|Página|Page|pág|pg|p)\.?\s*\d+\])/gi;
  const PAGE_MARKER_CLEAN = /\[(?:Pagina|Página|Page|pág|pg|p)\.?\s*\d+\]/gi;

  const rawText = String(text || '');
  if (rawText.startsWith('%PDF') || rawText.includes('obj\n<<')) {
    console.error('❌ ERROR: Se recibió binario de PDF en lugar de texto extraído');
    return []; 
  }
  const normalizedText = rawText
    .replace(/\f/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const splitIntoSentenceUnits = (pageText: string): string[] => {
    const merged = pageText
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/([.!?])\s+([A-ZÁÉÍÓÚÜÑ])/g, '$1\n$2')
      .replace(/([:;])\s+([A-ZÁÉÍÓÚÜÑ])/g, '$1\n$2')
      .trim();

    const units = merged
      .split('\n')
      .map(x => x.trim())
      .filter(x => x.length > 25);

    if (units.length > 0) return units;

    const fallback = pageText.replace(/\s+/g, ' ').trim();
    return fallback ? [fallback] : [];
  };

  const pushChunkedPage = (pageNumber: number, cleanPageText: string) => {
    const units = splitIntoSentenceUnits(cleanPageText);

    const MIN_SEGMENT = 140;
    const MAX_SEGMENT = 420;

    let buffer = '';

    for (const unit of units) {
      const candidate = buffer ? `${buffer} ${unit}` : unit;

      if (buffer && candidate.length > MAX_SEGMENT) {
        segments.push({
          text: buffer.trim(),
          pageHint: pageNumber,
          order: order++,
          materialId,
          materialName,
        });
        buffer = unit;
        continue;
      }

      buffer = candidate;

      if (buffer.length >= MIN_SEGMENT) {
        segments.push({
          text: buffer.trim(),
          pageHint: pageNumber,
          order: order++,
          materialId,
          materialName,
        });
        buffer = '';
      }
    }

    if (buffer.trim().length > 40) {
      segments.push({
        text: buffer.trim(),
        pageHint: pageNumber,
        order: order++,
        materialId,
        materialName,
      });
    }
  };

  const hasPageMarkers = PAGE_MARKER_DETECT.test(normalizedText);
  const pageChunks = hasPageMarkers
    ? normalizedText.split(PAGE_MARKER_SPLIT).map(x => x.trim()).filter(Boolean)
    : [normalizedText];

  let fallbackPage = selectedPages[0] || 1;

  for (const rawChunk of pageChunks) {
    const pageMatch = PAGE_MARKER_DETECT.exec(rawChunk);
    const pageNumber = pageMatch ? parseInt(pageMatch[1], 10) : fallbackPage;
    if (!isNaN(pageNumber)) fallbackPage = pageNumber;

    const cleanPageText = rawChunk.replace(PAGE_MARKER_CLEAN, '').trim();
    if (cleanPageText.length < 20) continue;

    pushChunkedPage(fallbackPage, cleanPageText);
  }

  if (segments.length < 8 && normalizedText.length > 800) {
    const denseSegments: RawSegment[] = [];
    let denseOrder = 0;

    for (const rawChunk of pageChunks) {
      const pageMatch = PAGE_MARKER_DETECT.exec(rawChunk);
      const pageNumber = pageMatch ? parseInt(pageMatch[1], 10) : (selectedPages[0] || 1);

      const cleanPageText = rawChunk.replace(PAGE_MARKER_CLEAN, '').trim();
      if (!cleanPageText) continue;

      const sentenceish = cleanPageText
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/([.!?])\s+([A-ZÁÉÍÓÚÜÑ])/g, '$1\n$2')
        .split('\n')
        .map(x => x.trim())
        .filter(x => x.length > 20);

      let bucket: string[] = [];
      let bucketLen = 0;

      for (const s of sentenceish) {
        if (bucketLen + s.length > 260 && bucket.length > 0) {
          denseSegments.push({
            text: bucket.join(' ').trim(),
            pageHint: pageNumber,
            order: denseOrder++,
            materialId,
            materialName,
          });
          bucket = [];
          bucketLen = 0;
        }
        bucket.push(s);
        bucketLen += s.length + 1;
      }

      if (bucket.length > 0) {
        denseSegments.push({
          text: bucket.join(' ').trim(),
          pageHint: pageNumber,
          order: denseOrder++,
          materialId,
          materialName,
        });
      }
    }

    if (denseSegments.length > segments.length) {
      console.log(`Dense fallback segmentation: ${denseSegments.length} segments`);
      return denseSegments;
    }
  }

  console.log(`Segmented ${materialName}: ${pageChunks.length} page-chunks -> ${segments.length} segments`);
  return segments;
}

// ─── Paso 2: agrupar segmentos en chunks para IA ─────────────
function groupSegmentsIntoChunks(
  segments: RawSegment[],
  maxCharsPerChunk = 7000, // igual que flashcards: más contexto por pasada
): RawSegment[][] {
  const chunks: RawSegment[][] = [];
  let current: RawSegment[] = [];
  let currentLen = 0;

  for (const seg of segments) {
    if (currentLen + seg.text.length > maxCharsPerChunk && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(seg);
    currentLen += seg.text.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ─── Paso 3: IA enriquece cada chunk ─────────────────────────
async function enrichChunkWithAI(
  segments: RawSegment[],
  chunkIndex: number,
  totalChunks: number,
  materialName: string,
): Promise<any[]> {
  const toNumberedText = (segs: RawSegment[]) =>
    segs.map((s, i) => `[${i}] (p.${s.pageHint}) ${s.text}`).join('\n\n');

  const toPrompt = (numberedText: string) => `You are a pedagogical knowledge modeler for an adaptive study system.

I will give you ${segments.length} numbered text segments from "${materialName}".
Your job: classify and enrich each segment as a knowledge block.

CLASSIFICATION RULES:
- topic: a main section or theme that groups other blocks
- concept: a teachable IDEA describing what something DOES or WHY it matters
- entity: a person, institution, place, date — just "who/where/when"
- definition: a formal explanation of a specific term
- formula: a mathematical or scientific expression
- example: a concrete case illustrating a concept
- fact: a specific isolated data point
- common_mistake: a frequent student misconception
- note: supporting context, restatements, or redundant content

ANTI-REDUNDANCY RULES:
- Each label must be UNIQUE. Never repeat a label.
- If two segments say similar things, merge into ONE block.
- If a segment restates a previous one → classify as "note", importance 30-45.
- Maximum 1 block per core idea in this chunk.

IMPORTANCE SCALE:
- 90-100: most testable concept in document
- 75-89: important, likely on exam
- 55-74: useful context
- 30-54: background
- 0-29: redundant or decorative
- No two blocks can have the exact same importance score.

DIFFICULTY:
- basic: facts, names, dates, simple definitions
- intermediate: mechanisms, causes, effects, processes
- advanced: formulas, interpretations, philosophical implications

Chunk ${chunkIndex + 1} of ${totalChunks} from "${materialName}":

${numberedText}

KNOWLEDGE GRAPH RULES:
- relations: list of directional edges from this block to others
- relation types:
  * "requires"
  * "explains"
  * "causes"
  * "contrasts"
  * "extends"
  * "example_of"
- Only add relations that are EXPLICIT in the text.
- misconceptions: max 2 per block

Return ONLY valid JSON:
{
  "blocks": [
    {
      "segmentIndex": 0,
      "kind": "concept",
      "label": "Unique label max 10 words",
      "summary": "2-3 sentences",
      "topicLabel": "parent topic from actual text, max 6 words",
      "dependsOn": ["prerequisite concept label"],
      "relatedTo": ["related concept label"],
      "relations": [
        { "type": "requires | explains | causes | contrasts | extends | example_of", "target": "label of target block" }
      ],
      "misconceptions": ["common student mistake"],
      "importance": 80,
      "difficulty": "intermediate",
      "examTypes": ["mcq", "open_ended"],
      "bloomLevel": "remember | understand | apply | analyze | evaluate | create",
      "examProbability": 75,
      "estimatedMinutes": 3
    }
  ]
}`;

  const mapParsedBlocks = (parsedBlocks: any[], segs: RawSegment[]) => {
    return parsedBlocks.map((b: any) => {
      const segIdx = typeof b.segmentIndex === 'number' ? b.segmentIndex : 0;
      const seg = segs[segIdx] || segs[0];

      return {
        kind: b.kind || 'note',
        label: String(b.label || '').trim(),
        summary: String(b.summary || '').trim(),
        materialId: seg.materialId,
        materialName: seg.materialName,
        pages: [seg.pageHint],
        pageHint: seg.pageHint,
        globalOrder: seg.order,
        topicLabel: String(b.topicLabel || b.label || '').trim(),
        dependsOn: Array.isArray(b.dependsOn) ? b.dependsOn : [],
        relatedTo: Array.isArray(b.relatedTo) ? b.relatedTo : [],
        relations: Array.isArray(b.relations)
          ? b.relations.filter((r: any) => r && typeof r.type === 'string' && typeof r.target === 'string')
          : [],
        misconceptions: Array.isArray(b.misconceptions)
          ? b.misconceptions.filter((m: any) => typeof m === 'string')
          : [],
        importance: typeof b.importance === 'number' ? Math.max(0, Math.min(100, b.importance)) : 50,
        difficulty: ['basic', 'intermediate', 'advanced'].includes(b.difficulty) ? b.difficulty : 'basic',
        examTypes: Array.isArray(b.examTypes) ? b.examTypes : [],
        bloomLevel: typeof b.bloomLevel === 'string' ? b.bloomLevel : 'understand',
        examProbability: typeof b.examProbability === 'number' ? Math.max(0, Math.min(100, b.examProbability)) : 50,
        estimatedMinutes: typeof b.estimatedMinutes === 'number' ? b.estimatedMinutes : 2,
        _fallback: false,
      };
    });
  };

  const numberedText = toNumberedText(segments);
  const prompt = toPrompt(numberedText);

  try {
    const parsed = await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 4000,
      json: true,
    });

    if (!parsed?.blocks) return [];

    const hasRelations = parsed.blocks.some((b: any) => Array.isArray(b.relations) && b.relations.length > 0);
    const hasMisc = parsed.blocks.some((b: any) => Array.isArray(b.misconceptions) && b.misconceptions.length > 0);
    const hasBloom = parsed.blocks.some((b: any) => typeof b.bloomLevel === 'string' && b.bloomLevel.length > 0);
    const hasExamProb = parsed.blocks.some((b: any) => typeof b.examProbability === 'number');
    console.log(`AI response debug: blocks=${parsed.blocks.length} relations=${hasRelations} misconceptions=${hasMisc} bloom=${hasBloom} examProbability=${hasExamProb}`);

    return mapParsedBlocks(parsed.blocks, segments);
  } catch (e: any) {
    console.error(`Chunk ${chunkIndex + 1} AI error:`, e?.message);
    console.log(`Chunk ${chunkIndex + 1}: reintentando secuencialmente (${segments.length} segmentos)...`);

    const allRetried: any[] = [];

    const retrySizes = segments.length > 8
      ? [Math.ceil(segments.length / 2), 1]
      : [1];

    for (const size of retrySizes) {
      for (let startSeg = 0; startSeg < segments.length; startSeg += size) {
        const part = segments.slice(startSeg, startSeg + size);
        const partText = toNumberedText(part);

        try {
          const retried = await alaiJson({
            messages: [{ role: 'user', content: toPrompt(partText) }],
            temperature: 0,
            maxTokens: Math.min(2200, 500 + part.length * 350),
            json: true,
          });

          if (retried?.blocks?.length) {
            allRetried.push(...mapParsedBlocks(retried.blocks, part));
          }
        } catch (retryErr: any) {
          console.warn(`Chunk ${chunkIndex + 1} subparte ${startSeg}-${startSeg + size} falló: ${retryErr?.message}`);
        }
      }

      if (allRetried.length > 0) {
        console.log(`Chunk ${chunkIndex + 1}: retry exitoso con ${allRetried.length} bloques`);
        return allRetried;
      }
    }

    console.warn(`Chunk ${chunkIndex + 1}: usando fallback mínimo para ${segments.length} segmentos`);
    return segments.slice(0, Math.min(segments.length, 3)).map((seg, i) => ({
      kind: 'concept' as const,
      label: `Bloque recuperado ${chunkIndex + 1}.${i + 1}`,
      summary: `Contenido recuperado de la página ${seg.pageHint}.`,
      materialId: seg.materialId,
      materialName: seg.materialName,
      pages: [seg.pageHint],
      pageHint: seg.pageHint,
      globalOrder: seg.order,
      topicLabel: `Sección ${chunkIndex + 1}`,
      dependsOn: [],
      relatedTo: [],
      relations: [],
      misconceptions: [],
      importance: 40,
      difficulty: 'basic',
      examTypes: [],
      bloomLevel: 'understand',
      examProbability: 30,
      estimatedMinutes: 2,
      _fallback: true,
    }));
  }
}


// ─── Paso 4: deduplicar conceptos por código ─────────────────
function deduplicateConcepts(blocks: any[]): {
  uniqueConcepts: any[];
  conceptIdMap: Record<string, string>;
} {
  const seen = new Map<string, any>();
  const conceptIdMap: Record<string, string> = {};

  for (const block of blocks) {
    if (!['concept', 'definition', 'formula', 'entity'].includes(block.kind)) continue;

    const key = block.label.toLowerCase().trim().replace(/\s+/g, ' ');

    if (!seen.has(key)) {
      const id = `concept_${seen.size}`;
      seen.set(key, {
        id,
        name: block.label,
        summary: block.summary,
        kind: block.kind,
        firstAppearanceOrder: block.globalOrder,
        materialIds: [block.materialId],
        pages: [...block.pages],
        topicIds: [],
        dependsOn: block.dependsOn || [],
        relatedTo: block.relatedTo || [],
        relations: block.relations || [],
        misconceptions: block.misconceptions || [],
        importance: block.importance || 50,
        difficulty: block.difficulty || 'basic',
        examTypes: block.examTypes || [],
        bloomLevel: block.bloomLevel || 'understand',
        examProbability: block.examProbability ?? 50,
        estimatedMinutes: block.estimatedMinutes ?? 2,
        appearances: block.pages.length,
      });
      conceptIdMap[block.label] = id;
    } else {
      const existing = seen.get(key)!;
      // Acumular páginas
      for (const p of block.pages) {
        if (!existing.pages.includes(p)) existing.pages.push(p);
      }
      // Acumular materialIds
      if (!existing.materialIds.includes(block.materialId)) {
        existing.materialIds.push(block.materialId);
      }
      // Actualizar importancia al máximo encontrado
      if (block.importance > existing.importance) {
        existing.importance = block.importance;
      }
      existing.examProbability = Math.max(existing.examProbability || 0, block.examProbability || 0);
      existing.estimatedMinutes = Math.max(existing.estimatedMinutes || 0, block.estimatedMinutes || 0);
      existing.bloomLevel = existing.bloomLevel || block.bloomLevel || 'understand';
      existing.misconceptions = Array.from(new Set([...(existing.misconceptions || []), ...(block.misconceptions || [])]));
      existing.relations = [...(existing.relations || []), ...(block.relations || [])];
      existing.appearances++;
    }
  }

  return {
    uniqueConcepts: Array.from(seen.values())
      .sort((a, b) => a.firstAppearanceOrder - b.firstAppearanceOrder),
    conceptIdMap,
  };
}

// ─── Paso 5: construir topics por código ─────────────────────
function buildTopicsIndex(blocks: any[]): any[] {
  const topicsMap = new Map<string, any>();
  let topicOrder = 0;

  for (const block of blocks) {
    const tLabel = block.topicLabel || block.label;
    if (!topicsMap.has(tLabel)) {
      topicsMap.set(tLabel, {
        id: `topic_${topicOrder++}`,
        title: tLabel,
        materialId: block.materialId,
        materialName: block.materialName,
        pages: [...block.pages],
        order: topicOrder,
        summary: block.kind === 'topic' ? block.summary : '',
        blockCount: 0,
        avgImportance: 0,
        importanceSum: 0,
      });
    }

    const topic = topicsMap.get(tLabel)!;
    for (const p of block.pages) {
      if (!topic.pages.includes(p)) topic.pages.push(p);
    }
    topic.blockCount++;
    topic.importanceSum += block.importance || 0;
    topic.avgImportance = Math.round(topic.importanceSum / topic.blockCount);
  }

  return Array.from(topicsMap.values()).sort((a, b) => a.order - b.order);
}


// ─── Paso 4b: consolidación semántica por código ─────────────
function consolidateTopics(blocks: any[]): any[] {
  // NO usar macrotemas hardcodeados de Bohr.
  // Usar los topicLabels reales que la IA asignó a cada bloque.
  // Consolidar blocks con el mismo topicLabel en un solo topic.

  const topicsMap = new Map<string, any>();

  for (const block of blocks) {
    const tLabel = (block.topicLabel || block.label || "Sin clasificar").trim();
    const tId = block.topicId || `topic_${tLabel.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40)}`;

    if (!topicsMap.has(tId)) {
      topicsMap.set(tId, {
        id: tId,
        title: tLabel,
        materialId: block.materialId,
        materialName: block.materialName,
        pages: [],
        order: topicsMap.size,
        summary: "",
        blockCount: 0,
        avgImportance: 0,
        importanceSum: 0,
        conceptIds: [],
      });
    }

    const topic = topicsMap.get(tId)!;
    for (const pg of block.pages || []) {
      if (!topic.pages.includes(pg)) topic.pages.push(pg);
    }
    topic.blockCount++;
    topic.importanceSum += block.importance || 0;
    topic.avgImportance = Math.round(topic.importanceSum / topic.blockCount);

    // Sincronizar topicId en el block para que quede consistente
    block.topicId = tId;
  }

  return Array.from(topicsMap.values())
    .filter(t => t.blockCount > 0)
    .sort((a, b) => a.order - b.order);
}

// ─── Paso 4c: normalizar importancia con distribución real ────
function normalizeImportance(blocks: any[]): any[] {
  if (!blocks.length) return blocks;

  // Separar por kind — entidades y notas tienen techo más bajo
  const CAPS: Record<string, number> = {
    concept: 100,
    definition: 100,
    formula: 100,
    entity: 75,
    fact: 70,
    example: 65,
    note: 50,
    common_mistake: 80,
    topic: 90,
  };

  // Aplicar cap por kind
  for (const b of blocks) {
    const cap = CAPS[b.kind] ?? 80;
    b.importance = Math.min(b.importance ?? 50, cap);
  }

  // Detectar inflación: si más del 60% tiene importance >= 90, reescalar
  const concepts = blocks.filter(b => ["concept","definition","formula"].includes(b.kind));
  const highCount = concepts.filter(b => b.importance >= 90).length;
  const inflated = concepts.length > 0 && (highCount / concepts.length) > 0.6;

  if (inflated) {
    // Reescalar: el máximo real se mapea a 98, el mínimo a 40
    const vals = concepts.map(b => b.importance);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const range = max - min || 1;
    for (const b of concepts) {
      b.importance = Math.round(40 + ((b.importance - min) / range) * 58);
    }
  }

  return blocks;
}


// ─── Normalizer: Raw Blueprint → Canonical Blueprint ─────────
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

function makeCanonicalId(kind: string, label: string, index: number): string {
  const prefix: Record<string, string> = {
    concept: 'concept', entity: 'entity', formula: 'formula',
    definition: 'def', example: 'ex', fact: 'fact',
    note: 'note', topic: 'topic', common_mistake: 'mistake',
  };
  const p = prefix[kind] || 'node';
  const slug = slugify(label) || String(index);
  return `${p}_${slug}`;
}

function normalizeBlueprint(rawBlueprint: any): any {
  const blocks: any[] = rawBlueprint.globalOrderedAnalysis || [];
  const topics: any[] = rawBlueprint.topicsIndex || [];
  const concepts: any[] = rawBlueprint.uniqueConceptsIndex || [];

  const topicIdMap: Record<string, string> = {};
  const canonicalTopics = topics.map((t: any, i: number) => {
    const id = makeCanonicalId('topic', t.title || `topic_${i}`, i);
    topicIdMap[t.title] = id;
    return {
      id,
      title: t.title,
      materialId: t.materialId,
      materialName: t.materialName,
      pages: t.pages || [],
      order: t.order || i,
      blockCount: t.blockCount || 0,
      avgImportance: t.avgImportance || 0,
      conceptIds: [] as string[],
    };
  });

  const blockIdMap: Record<string, string> = {};
  const usedIds = new Set<string>();
  const canonicalBlocks = blocks.map((b: any, i: number) => {
    let id = makeCanonicalId(b.kind || 'note', b.label || `block_${i}`, i);
    if (usedIds.has(id)) id = `${id}_${i}`;
    usedIds.add(id);
    blockIdMap[b.label] = id;
    const topicId = topicIdMap[b.topicLabel || ''] || null;
    return {
      id,
      kind: b.kind || 'note',
      label: b.label || '',
      summary: b.summary || '',
      materialId: b.materialId || '',
      materialName: b.materialName || '',
      pages: b.pages || [],
      firstPage: (b.pages || [])[0] || 0,
      globalOrder: b.globalOrder ?? i,
      topicId,
      topicLabel: b.topicLabel || '',
      importance: b.importance ?? 50,
      difficulty: b.difficulty || 'basic',
      examTypes: b.examTypes || [],
      dependsOn: b.dependsOn || [],
      relatedTo: b.relatedTo || [],
      relations: b.relations || [],
      misconceptions: b.misconceptions || [],
      bloomLevel: b.bloomLevel || 'understand',
      examProbability: b.examProbability ?? 50,
      estimatedMinutes: b.estimatedMinutes ?? 2,
    };
  });

  for (const block of canonicalBlocks) {
    block.dependsOn = block.dependsOn
      .map((label: string) => blockIdMap[label] || null)
      .filter(Boolean);
    block.relatedTo = block.relatedTo
      .map((label: string) => blockIdMap[label] || null)
      .filter(Boolean);
    // Resolver relations del grafo
    block.relations = (block.relations || [])
      .map((r: any) => ({
        type: r.type,
        targetId: blockIdMap[r.target] || null,
        targetLabel: r.target,
      }))
      .filter((r: any) => r.targetId !== null);
  }

  const canonicalConcepts = concepts.map((c: any, i: number) => {
    const id = makeCanonicalId(c.kind || 'concept', c.name || `concept_${i}`, i);
    return {
      id,
      name: c.name || '',
      kind: c.kind || 'concept',
      summary: c.summary || '',
      importance: c.importance ?? 50,
      difficulty: c.difficulty || 'basic',
      pages: c.pages || [],
      materialIds: c.materialIds || [],
      dependsOn: (c.dependsOn || []).map((l: string) => blockIdMap[l] || null).filter(Boolean),
      relatedTo: (c.relatedTo || []).map((l: string) => blockIdMap[l] || null).filter(Boolean),
      examTypes: c.examTypes || [],
      appearances: c.appearances || 1,
    };
  });

  for (const topic of canonicalTopics) {
    topic.conceptIds = canonicalBlocks
      .filter(b => b.topicId === topic.id && ['concept','definition','formula'].includes(b.kind))
      .map(b => b.id);
  }

  const conceptToTopicMap: Record<string, string> = {};
  for (const block of canonicalBlocks) {
    if (block.topicId && ['concept','definition','formula'].includes(block.kind)) {
      conceptToTopicMap[block.id] = block.topicId;
    }
  }

  const coveredPages = new Set<number>();
  for (const b of canonicalBlocks) (b.pages || []).forEach((p: number) => coveredPages.add(p));

  return {
    version: 3,
    createdAt: rawBlueprint.createdAt || Date.now(),
    materials: rawBlueprint.materials || [],
    topics: canonicalTopics,
    blocks: canonicalBlocks,
    concepts: canonicalConcepts,
    conceptToTopicMap,
    coverage: {
      totalMaterials: (rawBlueprint.materials || []).length,
      totalTopics: canonicalTopics.length,
      totalConcepts: canonicalConcepts.filter((c: any) => ['concept','definition','formula'].includes(c.kind)).length,
      totalEntities: canonicalConcepts.filter((c: any) => c.kind === 'entity').length,
      totalFormulas: canonicalConcepts.filter((c: any) => c.kind === 'formula').length,
      totalBlocks: canonicalBlocks.length,
      totalHighImportance: canonicalBlocks.filter((b: any) => b.importance >= 80).length,
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
      totalHighImportance: canonicalBlocks.filter((b: any) => b.importance >= 80).length,
      estimatedMinutes: Math.max(5, Math.round(canonicalBlocks.length * 1.8)),
    },
  };
}


// ─── Main handler ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawMaterials: {
      materialId: string;
      materialName: string;
      text?: string;
      selectedPages: number[];
    }[] = body.materials || [];

    if (!rawMaterials.length) {
      return NextResponse.json({ success: false, error: 'No materials provided' }, { status: 400 });
    }

    // ── Extraer texto de cada material ──────────────────────
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id;

    const materialsWithText = await Promise.all(rawMaterials.map(async (m) => {
      let text = m.text || '';

      if (!text && m.materialId) {
        // Intento 1: DB
        try {
          const materialText = await getMaterialText(m.materialId);
          text = materialText?.raw_text || '';
          if (text) console.log(`DB text for ${m.materialName}: ${text.length} chars`);
        } catch (e) {
          console.warn(`DB error for ${m.materialId}:`, e);
        }

        // Intento 2: R2
        if (!text && userId) {
          try {
            const material = await getMaterial(m.materialId, userId);
            if (material?.storage_key) {
              console.log(`R2 download: ${material.storage_key}`);
              const buffer = await downloadFromR2(material.storage_key);
              const result = await extractText(
                buffer,
                material.kind as any,
                material.mime_type,
                m.materialName,
              );
              text = result.text || '';
              if (text) console.log(`R2 text for ${m.materialName}: ${text.length} chars`);
            }
          } catch (e) {
            console.warn(`R2 error for ${m.materialId}:`, e);
          }
        }
      }

      return { ...m, text };
    }));

    const validMaterials = materialsWithText.filter(m => m.text.trim().length > 30);

    if (!validMaterials.length) {
      return NextResponse.json({
        success: false,
        error: 'No se pudo extraer el texto. Asegúrate de que el material haya sido procesado primero en el modo libre.',
      }, { status: 400 });
    }

    // ── Paso 1: segmentar por código ─────────────────────────
    const allSegments: RawSegment[] = [];
    for (const m of validMaterials) {
      const segs = segmentTextByCode(m.text, m.materialId, m.materialName, m.selectedPages);
      allSegments.push(...segs);
    }

    console.log(`Blueprint | ${allSegments.length} segments | ${validMaterials.length} materials`);

    // ── Paso 2: agrupar en chunks ────────────────────────────
    const chunks = groupSegmentsIntoChunks(allSegments, 7000);
    console.log(`${chunks.length} chunks para IA`);

    // ── Paso 3: enriquecer con IA (paralelo de 2) ────────────
    const allRawBlocks: any[] = [];
    // Para materiales con 3+ chunks, procesar de 2 en 2
    // Para materiales grandes (5+ chunks), procesar de 1 en 1
    const PARALLEL = chunks.length >= 5 ? 1 : 2;

    for (let i = 0; i < chunks.length; i += PARALLEL) {
      const batch = chunks.slice(i, i + PARALLEL);
      const results = await Promise.all(
        batch.map((chunk, bi) =>
          enrichChunkWithAI(chunk, i + bi, chunks.length, validMaterials[0].materialName)
        )
      );
      for (const r of results) allRawBlocks.push(...r);
    }

    // ── Paso 4: ordenar por globalOrder (código, no IA) ──────
    allRawBlocks.sort((a, b) => a.globalOrder - b.globalOrder);

    // ── Paso 5: consolidar topics en macrotemas + normalizar importancia ────
    normalizeImportance(allRawBlocks);
    const topicsIndex = consolidateTopics(allRawBlocks);
    const topicLabelToId: Record<string, string> = {};
    for (const t of topicsIndex) topicLabelToId[t.title] = t.id;

    const blocksWithIds: EnrichedBlock[] = allRawBlocks.map((b, i) => ({
      id: `block_${i}`,
      kind: b.kind,
      label: b.label,
      summary: b.summary,
      materialId: b.materialId,
      materialName: b.materialName,
      pages: b.pages,
      firstPage: b.pages[0] || 0,
      globalOrder: i,
      topicId: topicLabelToId[b.topicLabel] || null,
      topicLabel: b.topicLabel,
      dependsOn: b.dependsOn,
      relatedTo: b.relatedTo,
      relations: b.relations || [],
      misconceptions: b.misconceptions || [],
      importance: b.importance,
      difficulty: b.difficulty,
      examTypes: b.examTypes,
      bloomLevel: b.bloomLevel || 'understand',
      examProbability: b.examProbability ?? 50,
      estimatedMinutes: b.estimatedMinutes ?? 2,
    }));

    // Asignar conceptIds a topics
    for (const block of blocksWithIds) {
      if (block.topicId) {
        const topic = topicsIndex.find(t => t.id === block.topicId);
        if (topic) {
          if (!topic.conceptIds) topic.conceptIds = [];
          if (!topic.conceptIds.includes(block.id)) topic.conceptIds.push(block.id);
        }
      }
    }

    // ── Paso 6: deduplicar conceptos por código ───────────────
    const { uniqueConcepts } = deduplicateConcepts(blocksWithIds);

    // ── Coverage por código ───────────────────────────────────
    const highImportance = blocksWithIds.filter(b => b.importance >= 80);
    const coverageSummary = {
      totalMaterials: validMaterials.length,
      totalSelectedPages: validMaterials.reduce((s, m) => s + m.selectedPages.length, 0),
      totalTopics: topicsIndex.length,
      totalUniqueConcepts: uniqueConcepts.length,
      totalBlocks: blocksWithIds.length,
      totalHighImportance: highImportance.length,
      estimatedMinutes: Math.max(5, Math.round(blocksWithIds.length * 1.8)),
    };

    const rawBlueprint = {
      version: 2,
      createdAt: Date.now(),
      materials: validMaterials.map((m, i) => ({
        materialId: m.materialId,
        materialName: m.materialName,
        selectionOrder: i,
        selectedPages: m.selectedPages,
      })),
      globalOrderedAnalysis: blocksWithIds,
      uniqueConceptsIndex: uniqueConcepts,
      topicsIndex,
      coverageSummary,
    };

    const normalizedBlueprint = normalizeBlueprint(rawBlueprint);
    const blueprint = enrichBlueprintHeuristics(normalizedBlueprint);
    const quality = evaluateBlueprintQuality(blueprint);

    console.log(
      `Blueprint OK | ${blueprint.topics.length} topics | ${blueprint.concepts.length} concepts | ${blueprint.blocks.length} blocks | status=${quality.status}`
    );

    // ── Debug: contexto del análisis (terminal del servidor) ──
    console.log('\n══════════════════════════════════════════════');
    console.log('🧠 ANÁLISIS DEL MATERIAL COMPLETADO');
    console.log('══════════════════════════════════════════════');
    console.log('  Topics:', blueprint.topics?.length || 0);
    console.log('  Bloques:', blueprint.blocks?.length || 0);
    console.log('  Conceptos:', blueprint.concepts?.length || 0);
    console.log('  Calidad:', quality.status);
    if (quality.reasons?.length > 0) {
      console.log('  Razones:', quality.reasons.join(' | '));
    }
    console.log('  Métricas:', JSON.stringify(quality.metrics, null, 2));
    console.log('══════════════════════════════════════════════\n');

    return NextResponse.json({
      success: true,
      blueprint,
      quality,
    });

  } catch (e: any) {
    console.error('Blueprint error:', e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
