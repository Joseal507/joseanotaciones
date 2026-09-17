import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { detectLanguage } from '../../../lib/detectLanguage';
import { generateValidatedLegacyJson } from '../../../lib/ai/legacyRouteGeneration';
import { getAuthoritativeFreeSession } from '../../../lib/materialBrain/quiz/sessionAuthority';
import { getMaterial } from '../../../lib/materials/repository';
import { lookupStudyalMaterialEnjoyer, WorkerMaterialEnjoyerStore } from '../../../lib/adaptive/materialEnjoyer';
import type { SourceSelectionSnapshot } from '../../../lib/adaptive/sourceSelection';
import {
  buildStudyMapEnjoyerContext, buildStudyMapNodeExplanationContext, deterministicStudyMapTitle,
  renderStudyMapNodeExplanationContext, STUDY_MAP_ENJOYER_AUTHORITY_TYPE, STUDY_MAP_ENJOYER_ADAPTER_VERSION,
  type StudyMapEdge, type StudyMapEnjoyerContext, type StudyMapNode,
} from '../../../lib/materialBrain/studyMapEnjoyerContext';

export const maxDuration = 180;

// ============================================================
// StudyalMaterialEnjoyer grounded path (sessionId-based, 0 provider
// calls) — see handleGroundedStudyMapRequest() near the POST handler.
// The legacy texto-based chunk-extraction pipeline below remains as an
// unreachable fallback; ALAIStudyMap.tsx no longer sends `texto`.
//
// Node explanation ("explain this node") is a SEPARATE, small grounded
// mode of THIS SAME route (mode: 'explain_node') — deliberately not a
// change to the shared /api/alai-studyal-chat endpoint, which other tools
// (ALAIStudyALChat, Análisis's doubt chat) still use unmodified.
// ============================================================

export const __routeDeps = {
  getServerSession,
  getAuthoritativeFreeSession,
  getMaterial,
  lookupStudyalMaterialEnjoyer,
  materialEnjoyerStore: new WorkerMaterialEnjoyerStore(),
  generateValidatedLegacyJson,
};

const RAW_SOURCE_AUTHORITY_KEYS = ['texto', 'content', 'materialText', 'combinedText', 'rawText'];

function groundedErrorResponse(code: string, status: number, detail?: string) {
  return NextResponse.json({ success: false, error: code, ...(detail ? { detail } : {}) }, { status });
}

interface StudyMapEnjoyerLookupResult {
  context: StudyMapEnjoyerContext | null
  code: string
  status: number
}

/**
 * Resolves the EXACT-fingerprint, persisted StudyalMaterialEnjoyer for a
 * Study Map request. Lookup-only: never builds, never regenerates,
 * never falls back to a different fingerprint. Mirrors the same
 * restore-only contract already proven for Exam/Flashcards/Truquitos/
 * Análisis — duplicated here (not imported) to keep this migration
 * isolated.
 */
async function resolveReadyStudyMapEnjoyer(sessionId: string, userId: string): Promise<StudyMapEnjoyerLookupResult> {
  const freeSession = await __routeDeps.getAuthoritativeFreeSession(sessionId, userId);
  if (!freeSession) return { context: null, code: 'SESSION_NOT_FOUND', status: 404 };
  const sourceSelection: SourceSelectionSnapshot = freeSession.sourceSelection;
  for (const materialId of sourceSelection.materialIds) {
    if (!await __routeDeps.getMaterial(materialId, userId)) return { context: null, code: 'SESSION_NOT_FOUND', status: 404 };
  }
  const persisted = await __routeDeps.lookupStudyalMaterialEnjoyer(sourceSelection.fingerprint, __routeDeps.materialEnjoyerStore);
  if (!persisted) return { context: null, code: 'ENJOYER_NOT_READY', status: 409 };
  try {
    const context = buildStudyMapEnjoyerContext(persisted, sourceSelection);
    return { context, code: 'OK', status: 200 };
  } catch (error: any) {
    const code = String(error?.message || '') === 'SOURCE_SELECTION_MISMATCH' ? 'SOURCE_SELECTION_MISMATCH' : 'INVALID_ENJOYER_AUTHORITY';
    return { context: null, code, status: 409 };
  }
}

const KIND_LABELS_ES: Record<string, string> = {
  concept: 'Conceptos', fact: 'Hechos', definition: 'Definiciones', formula: 'Fórmulas',
  process: 'Procesos', example: 'Ejemplos', event_or_data: 'Eventos y datos', terminology: 'Terminología',
};

/** Presentation-only projection of the grounded graph into the existing tree-shaped StudyMapData UI — no new academic claims, just layout. */
function projectStudyMapToTree(context: StudyMapEnjoyerContext, title: string, summary: string) {
  const nodeById = new Map(context.nodes.map(node => [node.id, node]));
  const edgesByNode = new Map<string, StudyMapEdge[]>();
  for (const edge of context.edges) {
    edgesByNode.set(edge.sourceNodeId, [...(edgesByNode.get(edge.sourceNodeId) || []), edge]);
    edgesByNode.set(edge.targetNodeId, [...(edgesByNode.get(edge.targetNodeId) || []), edge]);
  }

  const buildLeaf = (node: StudyMapNode, colorIndex: number) => {
    const relationDetails = (edgesByNode.get(node.id) || []).map(edge => {
      const otherId = edge.sourceNodeId === node.id ? edge.targetNodeId : edge.sourceNodeId;
      const other = nodeById.get(otherId);
      const arrow = edge.sourceNodeId === node.id ? '→' : '←';
      return {
        id: `detail:${edge.id}:${node.id}`, type: 'detail' as const,
        label: `${edge.type} ${arrow} ${other?.label || otherId}`,
        description: edge.label,
      };
    });
    return {
      id: node.id, label: node.label, type: 'leaf' as const,
      description: node.statement, page: node.pages[0],
      emoji: assignEmoji(node.label), color: BRANCH_COLORS_ROTATION[colorIndex % BRANCH_COLORS_ROTATION.length],
      children: relationDetails,
    };
  };

  const branches = context.clusters.map((cluster, index) => {
    const label = cluster.kind === 'topic_group'
      ? (nodeById.get(cluster.nodeIds[0])?.topicTitle
        || KIND_LABELS_ES[cluster.nodeIds.length ? (nodeById.get(cluster.nodeIds[0])?.kind || '') : ''] || 'Otros')
      : cluster.nodeIds
        .map(id => nodeById.get(id))
        .sort((a, b) => (a?.importanceTier === 'critical' ? -1 : 0) - (b?.importanceTier === 'critical' ? -1 : 0))[0]?.label || 'Grupo';
    return {
      id: cluster.id, label, type: 'branch' as const,
      emoji: assignEmoji(label), color: BRANCH_COLORS_ROTATION[index % BRANCH_COLORS_ROTATION.length],
      children: cluster.nodeIds.map(id => buildLeaf(nodeById.get(id)!, index)),
    };
  });

  return {
    title, summary, totalConcepts: context.nodes.length,
    root: { id: 'root', label: title, type: 'root' as const, children: branches },
  };
}

const BRANCH_COLORS_ROTATION = ['#d6b26f', '#8ecae6', '#ffb4a2', '#a8dadc', '#f4a261', '#cdb4db', '#90be6d', '#e9c46a'];

async function handleGroundedStudyMapRequest(sessionId: string, userId: string, materia: string, tema: string): Promise<NextResponse> {
  const enjoyerLookup = await resolveReadyStudyMapEnjoyer(sessionId, userId);
  if (!enjoyerLookup.context) return groundedErrorResponse(enjoyerLookup.code, enjoyerLookup.status);
  const context = enjoyerLookup.context;

  if (!context.nodes.length) {
    return groundedErrorResponse('NO_MAP_TARGETS', 400, 'El material no tiene contenido representable en el mapa.');
  }

  const freeSession = await __routeDeps.getAuthoritativeFreeSession(sessionId, userId);
  const sourceSelection: SourceSelectionSnapshot = freeSession!.sourceSelection;
  const materialNamesById: Record<string, string> = {};
  for (const materialId of sourceSelection.materialIds) {
    const material = await __routeDeps.getMaterial(materialId, userId);
    if (material) materialNamesById[materialId] = (material as any).nombre || (material as any).name || materialId;
  }
  const title = tema || deterministicStudyMapTitle(sourceSelection, materialNamesById);
  const summary = `${context.nodes.length} conceptos del material${materia ? ` de ${materia}` : ''}, organizados en ${context.clusters.length} grupos.`;

  const mapa = projectStudyMapToTree(context, title, summary);

  return NextResponse.json({
    success: true,
    mapa,
    grounding: {
      fingerprint: context.fingerprint,
      authorityType: STUDY_MAP_ENJOYER_AUTHORITY_TYPE,
      adapterVersion: STUDY_MAP_ENJOYER_ADAPTER_VERSION,
      totalMapTargets: context.coverage.totalMapTargets,
      representedMapTargets: context.coverage.representedMapTargets,
      coveragePercent: context.coverage.coveragePercent,
      missingTargetIds: context.coverage.missingTargetIds,
      totalRelationIds: context.coverage.totalRelationIds,
      representedRelationIds: context.coverage.representedRelationIds,
      visibleInitially: context.visibility.visibleInitially,
      availableInMap: context.visibility.availableInMap,
    },
  });
}

/**
 * Grounded "explain this node" — resolves the SAME ready persisted
 * Enjoyer as map generation, then builds a small node-scoped context
 * (the node + its authorized evidence + only the relations/neighbors it
 * actually participates in). 1 provider call, 0 extraction/vision/graph
 * work.
 */
/**
 * STUDYMAP_LIVE_UX_HARDENING unification: the ONE Study Map explanation
 * path — used for leaf nodes (a single real Enjoyer node id) AND
 * branch/category nodes (every real Enjoyer node id among that
 * branch's descendant leaves, computed client-side from the tree it
 * already has). Root never calls this — its explanation stays fully
 * deterministic client-side (0 provider calls). No PDF reanalysis, no
 * Material Brain, no invented relations: grounding is exactly the same
 * real Enjoyer nodes/edges whether there is 1 of them or several.
 */
async function handleExplainNodeRequest(sessionId: string, userId: string, nodeIds: string[], materia: string, tema: string): Promise<NextResponse> {
  const enjoyerLookup = await resolveReadyStudyMapEnjoyer(sessionId, userId);
  if (!enjoyerLookup.context) return groundedErrorResponse(enjoyerLookup.code, enjoyerLookup.status);
  const context = enjoyerLookup.context;

  const explanationContext = buildStudyMapNodeExplanationContext(context, nodeIds);
  if (!explanationContext) return groundedErrorResponse('UNIT_NOT_FOUND', 404);

  const groundedText = renderStudyMapNodeExplanationContext(explanationContext);
  const { nodes, edges } = explanationContext;
  const isGroup = nodes.length > 1;

  // Deterministic, zero-extra-call language authority: the material's
  // own text — never the browser/UI locale — decides the response
  // language (STUDYMAP_LIVE_UX_HARDENING language root-cause fix).
  const langHint = detectLanguage(groundedText, 'es');
  const languageInstruction = langHint === 'es'
    ? 'Responde EN ESPAÑOL — el material está en español, nunca cambies de idioma.'
    : 'Respond IN ENGLISH — the material is in English, never switch languages.';

  const systemPrompt = `Eres el Profesor ALAI explicando ${isGroup ? 'un grupo de conceptos relacionados' : 'UN concepto puntual'} de un mapa de estudio ya construido por StudyAL desde el material — NO vuelvas a leer el material ni inventes nada fuera de lo que se te da.

AUTORIDAD — REGLAS OBLIGATORIAS:
1. ${isGroup ? 'Los bloques [NODE ...] de abajo son la ÚNICA fuente de hechos autorizados sobre este grupo de conceptos.' : 'El bloque [NODE ...] de abajo es la ÚNICA fuente de hechos autorizados sobre este concepto.'} No inventes datos, páginas, fórmulas o nombres que no aparezcan ahí.
2. "RELACIONES AUTORIZADAS" (si las hay) son las ÚNICAS conexiones reales que puedes mencionar entre conceptos. NUNCA digas que algo "se relaciona con" o "es similar a" algo que no esté en esa lista — aunque te parezca obvio o similar.
3. "answer" debe contener SOLO lo directamente respaldado por los bloques [NODE] — nunca una analogía, comparación externa o dato pedagógico que no esté ahí. Adapta el lenguaje para que sea fácil de entender, pero no cambies el contenido autorizado ni la fórmula/dato si es un dato exacto.
4. Si quieres dar una analogía, ejemplo adicional o contexto pedagógico que NO esté en los bloques [NODE], ponlo EXCLUSIVAMENTE en "pedagogicalNote" — nunca mezclado dentro de "answer". Dejar "pedagogicalNote" vacío ("") es válido y preferible si no aporta algo genuinamente útil.
5. Sé conciso: ${isGroup ? '4-8 oraciones cubriendo el grupo como un todo coherente' : '3-6 oraciones'} en "answer", más una sección corta de "Cómo se conecta" SOLO si hay relaciones autorizadas.
6. FÓRMULAS Y NOTACIÓN — REGLA ESTRICTA: cuando tu respuesta mencione una fórmula, ecuación o variable con subíndice/exponente/fracción que aparece en un bloque [NODE] (p.ej. "E_n = -13.6 eV / n²", "Kp = Kc(RT)^Δn"), escríbela como LaTeX entre signos de dólar simples, así: $E_n = -13.6 \text{ eV} / n^2$ — usa "_" para subíndice, "^" para exponente, "\frac{numerador}{denominador}" para fracciones, y conserva EXACTAMENTE los mismos símbolos, coeficientes, paréntesis y letras griegas (Δ, etc.) que aparecen en "CONTENIDO AUTORIZADO" o "EVIDENCE" — NUNCA la reescribas de memoria, ni la "corrijas" con tu conocimiento general de la materia, ni inventes una versión que te parezca más correcta. La fuente autorizada es la única verdad, incluso si te parece incompleta. Si no puedes representarla fielmente en LaTeX, mejor descríbela en palabras SIN escribir una notación simbólica que no estés copiando fielmente de la fuente.
7. IDIOMA: ${languageInstruction}
Devuelve SOLO JSON válido.`;

  const userPrompt = `MATERIA: ${materia || '(sin materia)'}
TEMA: ${tema || '(sin tema)'}

${groundedText}

Devuelve EXACTAMENTE este JSON:
{
  "answer": "explicación pedagógica SOLO respaldada por los bloques [NODE], ${isGroup ? '4-8 oraciones' : '3-6 oraciones'}, más conexiones si hay relaciones autorizadas",
  "pedagogicalNote": "analogía o contexto adicional NO tomado del material, o cadena vacía si no aplica",
  "usedRelationIds": []
}`;

  const parsed: any = await __routeDeps.generateValidatedLegacyJson({
    taskType: 'session_content',
    prompt: `${systemPrompt}\n\n${userPrompt}`,
    maxTokens: Math.min(900 + 150 * Math.max(0, nodes.length - 1), 2400),
    normalize: (value: any) => value,
    validate: (value: any) => {
      const errors: string[] = [];
      if (!String(value?.answer || '').trim()) errors.push('STRUCTURAL_VALIDATION_FAILED:node_explanation_answer');
      return { valid: errors.length === 0, errors };
    },
    telemetryContext: { route: 'study_map', phase: 'explain_node' },
  }).catch(() => null);

  if (!parsed) return groundedErrorResponse('PROVIDER_GENERATION_FAILED', 502, 'No se pudo generar la explicación grounded.');

  // Traceability kept internally — never required for the UI to render,
  // but lets a future audit confirm the answer only had access to these
  // authorized relation/unit ids.
  const knownRelationIds = new Set(edges.map(edge => edge.id));
  const usedRelationIds = Array.isArray(parsed.usedRelationIds)
    ? parsed.usedRelationIds.map((id: any) => String(id || '').trim()).filter((id: string) => knownRelationIds.has(id))
    : [];
  const sourcePages = Array.from(new Set(nodes.flatMap(n => n.pages))).sort((a, b) => a - b);

  return NextResponse.json({
    success: true,
    explanation: {
      answer: String(parsed.answer || '').trim(),
      // Honest provenance semantics (ANALISIS_CHAT_AUDIT finding): `answer`
      // and ONLY `answer` is claimed to be backed by `sourcePages` — any
      // additional pedagogical enrichment the model produces is kept in
      // this SEPARATE field, never implicitly covered by "Fuentes: p.X".
      pedagogicalNote: String(parsed.pedagogicalNote || '').trim(),
      sourcePages,
      suggestedFollowups: [],
      unitId: nodes[0].id,
      unitIds: nodes.map(n => n.id),
      relationIds: edges.map(edge => edge.id),
      usedRelationIds,
    },
  });
}

const BRANCH_EMOJIS: Record<string, string> = {
  // Académico
  introducción: '🌱', introduction: '🌱',
  conceptos: '💡', concepts: '💡',
  definiciones: '📖', definitions: '📖',
  historia: '📜', history: '📜',
  origen: '🌅', origins: '🌅',
  evolución: '🔄', evolution: '🔄',
  tipos: '🗂️', types: '🗂️',
  clasificación: '🗂️', classification: '🗂️',
  características: '✨', characteristics: '✨',
  causas: '🔍', causes: '🔍',
  efectos: '💥', effects: '💥',
  consecuencias: '💥',
  proceso: '⚙️', process: '⚙️',
  fórmulas: '🔢', formulas: '🔢',
  ecuaciones: '🔢',
  aplicaciones: '🚀', applications: '🚀',
  ejemplos: '📝', examples: '📝',
  ventajas: '✅', advantages: '✅',
  desventajas: '❌', disadvantages: '❌',
  conclusión: '🎯', conclusion: '🎯',
  resumen: '📋', summary: '📋',
  teoría: '🧠', theory: '🧠',
  métodos: '🔬', methods: '🔬',
  resultados: '📊', results: '📊',
  análisis: '🔬', analysis: '🔬',
  estructura: '🏗️', structure: '🏗️',
  función: '⚡', function: '⚡',
  funciones: '⚡',
  impacto: '💥', impact: '💥',
  // Personas/equipo
  jugadores: '🏃', players: '🏃',
  equipo: '👥', team: '👥',
  personajes: '👥', characters: '👥',
  protagonistas: '⭐',
  líderes: '👑',
  // Cultura/contexto
  cultura: '🎭', culture: '🎭',
  sociedad: '🏛️', society: '🏛️',
  tradición: '📿',
  // Ciencias
  células: '🧬', cells: '🧬',
  células_madre: '🧬',
  órganos: '🫀', organs: '🫀',
  enfermedades: '🦠', diseases: '🦠',
  síntomas: '🤒', symptoms: '🤒',
  tratamientos: '💊', treatments: '💊',
  diagnóstico: '🩺', diagnosis: '🩺',
  // Matemáticas
  teoremas: '📐', theorems: '📐',
  números: '🔢', numbers: '🔢',
  geometría: '📐', geometry: '📐',
  // Tecnología
  algoritmos: '🤖', algorithms: '🤖',
  código: '💻', code: '💻',
  software: '💻',
  hardware: '🖥️',
  // Negocios
  estrategia: '🎯', strategy: '🎯',
  finanzas: '💰', finance: '💰',
  marketing: '📢',
  // Deportes
  logros: '🏆', achievements: '🏆',
  trofeos: '🏆',
  estadísticas: '📊', statistics: '📊',
  partidos: '🏟️', games: '🏟️',
  legado: '👑', legacy: '👑',
  // Geografía
  ubicación: '📍', location: '📍',
  geografía: '🌍', geography: '🌍',
  // Default
};

function assignEmoji(label: string): string {
  const lower = (label || '').toLowerCase();
  for (const [key, emoji] of Object.entries(BRANCH_EMOJIS)) {
    if (lower.includes(key.replace(/_/g, ' '))) return emoji;
  }
  return '●';
}

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf('\n\n', maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf('. ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ─── MATERIAL BRAIN GROUNDED NODE EXPLANATION ───
    // ALAIStudyMap.tsx sends { mode: 'explain_node', sessionId, unitId }
    // for leaf (real Brain unit) nodes — never materialText. Isolated
    // from /api/alai-studyal-chat, which other tools still use unchanged.
    if (body?.mode === 'explain_node') {
      if (RAW_SOURCE_AUTHORITY_KEYS.some(key => Object.prototype.hasOwnProperty.call(body, key))) {
        return groundedErrorResponse('INVALID_CONFIG', 400, 'RAW_SOURCE_AUTHORITY_FORBIDDEN');
      }
      const sessionId = String(body?.sessionId || '').trim();
      // Accepts either a single unitId (leaf) or an array unitIds
      // (branch/category — every real Enjoyer node id among its
      // descendant leaves, computed client-side). Never a client-forged
      // arbitrary id: resolveReadyStudyMapEnjoyer + buildStudyMapNodeExplanationContext
      // below only ever match REAL persisted Enjoyer node ids.
      const unitIds = Array.isArray(body?.unitIds)
        ? body.unitIds.map((id: any) => String(id || '').trim()).filter(Boolean)
        : (String(body?.unitId || '').trim() ? [String(body.unitId).trim()] : []);
      if (!sessionId || !unitIds.length) return groundedErrorResponse('INVALID_CONFIG', 400, 'sessionId y unitId(s) requeridos');
      let userId: string | null = null;
      try {
        const session = await __routeDeps.getServerSession(authOptions);
        userId = (session?.user as any)?.id ?? null;
      } catch {}
      if (!userId) return groundedErrorResponse('UNAUTHORIZED', 401);
      return handleExplainNodeRequest(sessionId, userId, unitIds, String(body.materia || '').trim(), String(body.tema || '').trim());
    }

    // ─── STUDYALMATERIALENJOYER GROUNDED PATH — Free Mode Study Map ───
    // ALAIStudyMap.tsx sends { sessionId, materia, tema } and no `texto`.
    // Autoridad académica: SOLO el StudyalMaterialEnjoyer persistido,
    // resuelto server-side por fingerprint exacto, nunca texto crudo del
    // cliente. 0 provider calls.
    if (typeof body?.sessionId === 'string' && body.sessionId) {
      if (RAW_SOURCE_AUTHORITY_KEYS.some(key => Object.prototype.hasOwnProperty.call(body, key))) {
        return groundedErrorResponse('INVALID_CONFIG', 400, 'RAW_SOURCE_AUTHORITY_FORBIDDEN');
      }
      let userId: string | null = null;
      try {
        const session = await __routeDeps.getServerSession(authOptions);
        userId = (session?.user as any)?.id ?? null;
      } catch {}
      if (!userId) return groundedErrorResponse('UNAUTHORIZED', 401);
      return handleGroundedStudyMapRequest(
        body.sessionId, userId, String(body.materia || '').trim(), String(body.tema || '').trim(),
      );
    }

    // ─── LEGACY texto/content BRANCH — AUTH HARDENING (STUDYMAP_LEGACY_AUTH) ───
    // Unreachable from the current UI (ALAIStudyMap.tsx only ever sends
    // sessionId or mode:'explain_node'), but directly reachable over raw
    // HTTP with no authentication at all. Must resolve a valid
    // authenticated server session BEFORE any provider work — same
    // primitive as the sessionId/Enjoyer branches above, never a
    // client-supplied identity. An unauthenticated request must never
    // reach texto parsing or any provider call.
    let legacyUserId: string | null = null;
    try {
      const session = await __routeDeps.getServerSession(authOptions);
      legacyUserId = (session?.user as any)?.id ?? null;
    } catch { /* unauthenticated */ }
    if (!legacyUserId) return groundedErrorResponse('UNAUTHORIZED', 401);

    const texto = String(body.texto || body.content || '').trim();
    const materia = String(body.materia || '').trim();
    const tema = String(body.tema || '').trim();

    if (!texto) return NextResponse.json({ success: false, error: 'Texto vacío' });

    const lang = detectLanguage(texto);
    const isEs = lang !== 'en';
    console.log(`🗺️ StudyMap | ${lang} | ${texto.length} chars | tema: ${tema || 'sin tema'}`);

    // ═══ PASO 1: ESQUEMA INTELIGENTE DEL MATERIAL ═══
    // El AI lee una muestra y propone TÍTULO REAL + CATEGORÍAS ESPECÍFICAS

    const sampleSize = Math.min(8000, texto.length);
    const sample = texto.slice(0, sampleSize);

    const schemaPrompt = isEs
      ? `Eres ALAI, experto en pedagogía. Analiza esta muestra del material y propón la mejor estructura para un mapa mental que cubra el 100% del contenido.

CONTEXTO PROVISTO:
- Materia: ${materia || 'No especificada'}
- Tema declarado por estudiante: ${tema || 'No especificado'}

INSTRUCCIONES CRÍTICAS:

1. TÍTULO REAL: Lee la muestra y deriva el TÍTULO VERDADERO del material. Si el material habla de "Los Atlanta Falcons en la NFL", el título debe ser eso, NO el genérico "${tema}". Si el tema del estudiante es vago (ej: "n", "tema 1"), IGNÓRALO y usa lo que dice el material.

2. CATEGORÍAS ESPECÍFICAS: Propón entre 5 y 8 categorías temáticas REALES y ESPECÍFICAS al contenido. NO uses categorías genéricas como "Introducción", "Características", "Aplicaciones", "Conclusión". 
   ❌ MAL: "Características", "Aplicaciones", "Historia", "Legado"
   ✅ BIEN: "Fundación del equipo (1965)", "Jugadores legendarios", "Cultura y afición de Atlanta", "Super Bowl LI y caída ante Patriots", "Estadio Mercedes-Benz"

3. CADA CATEGORÍA DEBE CONTENER UNA IDEA CONCRETA DEL MATERIAL, no una etiqueta genérica.

4. IDIOMA: Responde en español.

Devuelve JSON puro (sin markdown):
{
  "title": "Título real derivado del material (máx 8 palabras)",
  "summary": "Resumen del material en 1-2 oraciones que diga qué cubre realmente",
  "categorias": [
    { "nombre": "Categoría específica 1 con nombre real", "descripcion": "Qué cubre esta categoría en 1 oración con palabras del material" },
    { "nombre": "Categoría específica 2", "descripcion": "..." }
  ]
}

Muestra del material (primeros ${sampleSize} chars de ${texto.length} totales):
${sample}

⚠️ Responde SOLO el JSON. Sin markdown. Sin \`\`\`. Sin texto antes ni después.`
      : `You are ALAI, pedagogy expert. Analyze this material sample and propose the BEST structure for a mind map covering 100% of content.

CONTEXT:
- Subject: ${materia}
- Topic declared by student: ${tema}

CRITICAL RULES:
1. REAL TITLE: Derive the TRUE TITLE from the sample. If student's topic is vague, IGNORE it and use what material says.
2. SPECIFIC CATEGORIES: Propose 5-8 REAL specific thematic categories. NO generic like "Introduction", "Characteristics", "Applications".
   ❌ BAD: "Characteristics", "Applications", "History"
   ✅ GOOD: "Team founding (1965)", "Legendary players", "Atlanta fan culture", "Super Bowl LI loss"

Return pure JSON:
{
  "title": "Real title from material (max 8 words)",
  "summary": "Material summary in 1-2 sentences",
  "categorias": [
    { "nombre": "Specific category 1", "descripcion": "What it covers" }
  ]
}

Sample (first ${sampleSize} chars of ${texto.length}):
${sample}

⚠️ ONLY JSON. No markdown.`;

    const schema: any = await __routeDeps.generateValidatedLegacyJson({
      taskType: 'session_content',
      prompt: schemaPrompt,
      maxTokens: 2500,
      normalize: value => value,
      validate: value => {
        const record = value as any
        const categories = Array.isArray(record?.categorias) ? record.categorias : []
        const errors: string[] = []
        if (!record?.title || !categories.length) errors.push('STRUCTURAL_VALIDATION_FAILED:invalid_map_schema')
        const names = categories.map((category: any) => String(category?.nombre || '').toLowerCase().trim()).filter(Boolean)
        if (new Set(names).size !== names.length) errors.push('SEMANTIC_DUPLICATION:map_categories')
        if (categories.length < 3) errors.push('LOW_DIVERSITY:map_categories')
        return { valid: errors.length === 0, errors }
      },
      telemetryContext: { route: 'mind_map', phase: 'schema' },
    })

    if (!schema || !schema.categorias || !Array.isArray(schema.categorias) || schema.categorias.length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudo analizar la estructura del material.' });
    }

    const titleReal = String(schema.title || tema || 'Mapa Mental').trim();
    const summary = String(schema.summary || '').trim();
    const categoriasSchema = schema.categorias.slice(0, 8).map((c: any) => ({
      nombre: String(c.nombre || c.titulo || '').trim(),
      descripcion: String(c.descripcion || c.description || '').trim(),
    })).filter((c: any) => c.nombre.length > 0);

    console.log(`📐 Esquema: "${titleReal}" | ${categoriasSchema.length} categorías`);

    // ═══ PASO 2: EXTRAER CONCEPTOS POR CHUNK Y CLASIFICAR A LAS CATEGORÍAS ═══

    const CHUNK_SIZE = 6000;
    const chunks = chunkText(texto, CHUNK_SIZE);
    console.log(`📄 ${chunks.length} chunks`);

    interface RawConcept {
      categoria: string;
      concepto: string;
      explicacion: string;
      page?: number;
      detalles?: { titulo: string; texto: string }[];
    }

    const allConcepts: RawConcept[] = [];
    const categoriasJoined = categoriasSchema.map((c: any, i: number) => `${i + 1}. "${c.nombre}" — ${c.descripcion}`).join('\n');

    const PARALLEL = 2;
    for (let start = 0; start < chunks.length; start += PARALLEL) {
      const batch = chunks.slice(start, start + PARALLEL);
      const results = await Promise.all(
        batch.map(async (chunk, batchIdx) => {
          const i = start + batchIdx;
          const extractPrompt = isEs
            ? `Extrae los conceptos importantes de este fragmento del material "${titleReal}".

CATEGORÍAS DEFINIDAS PARA ESTE MAPA (úsalas como única opción):
${categoriasJoined}

REGLAS:
1. Cada concepto debe asignarse a UNA de las categorías de arriba (usa el nombre EXACTO).
2. Si un concepto no encaja en ninguna, ASÍGNALO A LA MÁS CERCANA. No inventes categorías nuevas.
3. Mínimo 6 conceptos por fragmento, ideal 10-15.
4. Las "explicaciones" deben USAR datos reales del material (nombres, números, fechas).
5. Si hay [Pagina N], incluye page: N.
6. Los "detalles" son opcionales (2-3 por concepto) con datos hiper-específicos.

Devuelve JSON puro:
{
  "conceptos": [
    {
      "categoria": "Nombre exacto de una de las categorías de arriba",
      "concepto": "Nombre específico del concepto del material (3-7 palabras)",
      "explicacion": "Explicación clara con datos reales del material (1-2 oraciones)",
      "page": 3,
      "detalles": [
        { "titulo": "Dato específico", "texto": "Información concreta" }
      ]
    }
  ]
}

Fragmento ${i + 1}/${chunks.length}:
${chunk}

⚠️ SOLO JSON. Sin markdown.`
            : `Extract concepts from this fragment of "${titleReal}".

DEFINED CATEGORIES (use these only):
${categoriasJoined}

RULES:
1. Each concept assigned to ONE of above categories (exact name).
2. If doesn't fit, use CLOSEST one. Don't invent new.
3. Min 6 concepts, ideal 10-15.
4. Use REAL data from material.

Return pure JSON:
{
  "conceptos": [
    {
      "categoria": "Exact category name",
      "concepto": "Specific concept (3-7 words)",
      "explicacion": "Clear explanation with real data",
      "page": 3,
      "detalles": [{ "titulo": "Detail", "texto": "Info" }]
    }
  ]
}

Fragment ${i + 1}/${chunks.length}:
${chunk}

⚠️ JSON only.`;

          try {
            const conceptos = await __routeDeps.generateValidatedLegacyJson<any[]>({
              taskType: 'session_content',
              prompt: extractPrompt,
              maxTokens: 4000,
              normalize: value => Array.isArray((value as any)?.conceptos) ? (value as any).conceptos : [],
              validate: value => {
                const concepts = Array.isArray(value) ? value : []
                const errors: string[] = []
                if (!concepts.length) errors.push('LOW_DIVERSITY:no_map_concepts')
                for (const concept of concepts) {
                  if (!concept?.categoria || !concept?.concepto || !concept?.explicacion) {
                    errors.push('STRUCTURAL_VALIDATION_FAILED:invalid_map_concept')
                  }
                }
                return { valid: errors.length === 0, errors }
              },
              telemetryContext: { route: 'mind_map', phase: 'concepts', chunk: i + 1 },
            })
            console.log(`📝 Chunk ${i + 1}: ${conceptos.length} conceptos`);
            return conceptos;
          } catch (e: any) {
            console.error(`❌ Error chunk ${i + 1}:`, e?.message);
            throw e;
          }
        })
      );
      for (const arr of results) allConcepts.push(...arr);
    }

    console.log(`🧠 Total: ${allConcepts.length} conceptos`);

    if (allConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudieron extraer conceptos.' });
    }

    // ═══ PASO 3: AGRUPAR POR CATEGORÍA DEFINIDA ═══

    const grouped: Record<string, RawConcept[]> = {};
    for (const cat of categoriasSchema) grouped[cat.nombre] = [];

    // Match flexible: si la categoría asignada no matchea exactamente, encontrar la más parecida
    for (const c of allConcepts) {
      const assignedCat = String(c.categoria || '').trim();
      if (grouped[assignedCat]) {
        grouped[assignedCat].push(c);
      } else {
        // Match parcial: buscar la categoría que más se parezca
        const lcAssigned = assignedCat.toLowerCase();
        let bestMatch = categoriasSchema[0]?.nombre;
        let bestScore = 0;
        for (const cat of categoriasSchema) {
          const lc = cat.nombre.toLowerCase();
          const score = lc.split(/\s+/).filter((w: string) => w.length > 3 && lcAssigned.includes(w)).length;
          if (score > bestScore) { bestScore = score; bestMatch = cat.nombre; }
        }
        if (bestMatch) grouped[bestMatch].push(c);
      }
    }

    // Filtrar categorías vacías
    const usedCategorias = categoriasSchema.filter((cat: any) => (grouped[cat.nombre] || []).length > 0);

    // ═══ PASO 4: CONSTRUIR ÁRBOL ═══

    const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

    const root: any = {
      id: 'root',
      label: titleReal,
      type: 'root',
      emoji: '🎯',
      description: summary,
      children: [],
    };

    root.children = usedCategorias.map((cat: any, bi: number) => {
      const conceptos = grouped[cat.nombre];
      const branchPage = conceptos.find(c => c.page)?.page;

      // Dedupe conceptos (a veces el AI repite el mismo concepto en diferentes chunks)
      const seen = new Set<string>();
      const uniqueConceptos = conceptos.filter(c => {
        const key = c.concepto.toLowerCase().trim().slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return {
        id: `b${bi}`,
        label: cat.nombre,
        type: 'branch',
        emoji: assignEmoji(cat.nombre),
        description: cat.descripcion,
        page: branchPage,
        children: uniqueConceptos.slice(0, 10).map((c, li) => ({
          id: `b${bi}-l${li}`,
          label: c.concepto,
          type: 'leaf',
          description: c.explicacion,
          page: c.page,
          children: Array.isArray(c.detalles)
            ? c.detalles.slice(0, 4).map((d, di) => ({
                id: `b${bi}-l${li}-d${di}`,
                label: d.titulo,
                type: 'detail',
                description: d.texto,
                page: c.page,
              }))
            : [],
        })),
      };
    });

    const countNodes = (n: any): number =>
      1 + (n.children || []).reduce((s: number, c: any) => s + countNodes(c), 0);
    const totalConcepts = countNodes(root) - 1;

    const mapa = { title: titleReal, summary, totalConcepts, root };

    console.log(`✅ "${titleReal}" | ${totalConcepts} nodos | ${usedCategorias.length} categorías reales`);

    return NextResponse.json({ success: true, mapa });

  } catch (error: any) {
    console.error('alai-studyal-map error:', error.message);
    return NextResponse.json({ success: false, error: error.message });
  }
}
