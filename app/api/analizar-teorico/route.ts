// ═══════════════════════════════════════════════════════════════
// /api/analizar-teorico — Análisis pedagógico con ALAI
// Cache por material + auth + fallback completo
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { ANALYSIS_STUDY_NOTES_VERSION, compileStudyNotes, isAnalysisStudyNotes, validateStudyNotes } from '../../../lib/materialBrain/analysisStudyNotes';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { alaiJson, cleanDeep } from '../../../lib/alai';
import { detectContentLanguage } from '../../../lib/detectLanguage';
import {
  getMaterialResult,
  saveMaterialResult,
  getMaterial,
} from '../../../lib/materials/repository';
import { getAuthoritativeFreeSession } from '../../../lib/materialBrain/quiz/sessionAuthority';
import { lookupStudyalMaterialEnjoyer, WorkerMaterialEnjoyerStore } from '../../../lib/adaptive/materialEnjoyer';
import type { SourceSelectionSnapshot } from '../../../lib/adaptive/sourceSelection';
import {
  buildAnalysisEnjoyerContext, computeAnalysisCoverage, renderAnalysisEnjoyerContext,
  deterministicCoberturaMaterial, deterministicParaExamen, deterministicProbabilidadExamen,
  deterministicYaPuedesExplicar, ANALYSIS_ENJOYER_AUTHORITY_TYPE, ANALYSIS_ENJOYER_ADAPTER_VERSION,
  type AnalysisEnjoyerContext, type AnalysisEnjoyerTarget,
} from '../../../lib/materialBrain/analysisEnjoyerContext';
import {
  analysisArtifactIdentity, isValidRestorableArtifact, WorkerAnalysisArtifactStore,
  ANALYSIS_ARTIFACT_SCHEMA_VERSION, type AnalysisArtifact, type AnalysisArtifactStore,
} from '../../../lib/materialBrain/analysisArtifactStore';

export const maxDuration = 240;
export const dynamic = 'force-dynamic';

// ============================================================
// StudyalMaterialEnjoyer grounded path (sessionId-based) — see
// resolveReadyAnalysisEnjoyer()/handleGroundedAnalysisRequest() near the
// POST handler. The legacy documentos-based chunk/M0-M3 pipeline below
// remains for the blueprint_analysis mode (Adaptive) and as an
// unreachable fallback path; AnalisisTeorico.tsx (Free Mode) no longer
// sends `documentos`. No Material Brain-based knowledge units, no raw
// material text in this path.
// ============================================================

export const __routeDeps = {
  getServerSession,
  getAuthoritativeFreeSession,
  getMaterial,
  lookupStudyalMaterialEnjoyer,
  materialEnjoyerStore: new WorkerMaterialEnjoyerStore(),
  alaiJson,
  analysisArtifactStore: new WorkerAnalysisArtifactStore() as AnalysisArtifactStore,
};

// Per-isolate single-flight guard — mirrors lib/materialBrain/productionStore.ts's
// inFlightBuilds pattern. Two concurrent requests for the SAME
// user+fingerprint+nivel identity await the SAME in-progress generation
// instead of each starting their own provider call; this is a
// best-effort, single-process guard (the Worker backend has no CAS), not
// a distributed lock — sufficient to bound the common case without
// building new infrastructure.
const inFlightAnalysisGenerations = new Map<string, Promise<NextResponse>>();

const RAW_SOURCE_AUTHORITY_KEYS = ['documentos', 'materialText', 'combinedText', 'rawText', 'contenido', 'texto', 'facts'];

function groundedErrorResponse(code: string, status: number, detail?: string) {
  return NextResponse.json({ success: false, error: code, ...(detail ? { detail } : {}) }, { status });
}

interface AnalysisEnjoyerLookupResult {
  context: AnalysisEnjoyerContext | null
  code: string
  status: number
}

/**
 * Resolves the EXACT-fingerprint, persisted StudyalMaterialEnjoyer for
 * an Análisis request. Lookup-only: never builds, never regenerates,
 * never falls back to a different fingerprint. Mirrors the same
 * restore-only contract already proven for Exam/Flashcards/Truquitos —
 * duplicated here (not imported) to keep this migration isolated.
 */
async function resolveReadyAnalysisEnjoyer(sessionId: string, userId: string): Promise<AnalysisEnjoyerLookupResult> {
  const freeSession = await __routeDeps.getAuthoritativeFreeSession(sessionId, userId);
  if (!freeSession) return { context: null, code: 'SESSION_NOT_FOUND', status: 404 };
  const sourceSelection: SourceSelectionSnapshot = freeSession.sourceSelection;
  for (const materialId of sourceSelection.materialIds) {
    if (!await __routeDeps.getMaterial(materialId, userId)) return { context: null, code: 'SESSION_NOT_FOUND', status: 404 };
  }
  const persisted = await __routeDeps.lookupStudyalMaterialEnjoyer(sourceSelection.fingerprint, __routeDeps.materialEnjoyerStore);
  if (!persisted) return { context: null, code: 'ENJOYER_NOT_READY', status: 409 };
  try {
    const context = buildAnalysisEnjoyerContext(persisted, sourceSelection);
    return { context, code: 'OK', status: 200 };
  } catch (error: any) {
    const code = String(error?.message || '') === 'SOURCE_SELECTION_MISMATCH' ? 'SOURCE_SELECTION_MISMATCH' : 'INVALID_ENJOYER_AUTHORITY';
    return { context: null, code, status: 409 };
  }
}

const ANALYSIS_NIVEL_DESC: Record<string, string> = {
  secundaria: 'Secundaria: usa analogías simples, evita tecnicismos, vocabulario básico, ejemplos de la vida cotidiana',
  universidad: 'Universidad: nivel estándar universitario, conceptos completos con terminología técnica básica',
  medicina: 'Medicina/Ciencias avanzadas: terminología técnica completa, mecanismos moleculares detallados, relevancia clínica o científica',
  doctorado: 'Posgrado/Doctorado: máxima profundidad conceptual, mecanismos avanzados, conexiones con literatura especializada',
};

function analysisSystemPrompt(nivelInstruccion: string): string {
  return `Eres el Profesor ALAI. Vas a narrar pedagógicamente un material ya extraído y organizado por StudyAL en clusters de conocimiento — NO vuelvas a extraer ni inventes contenido.

NIVEL DE AUDIENCIA: ${nivelInstruccion}

AUTORIDAD ACADÉMICA — REGLAS OBLIGATORIAS:
1. El MATERIAL de abajo está dividido en bloques [CLUSTER <id>], cada uno con uno o más [ANALYSIS_TARGET <id>] — estos targets son la ÚNICA fuente de hechos autorizados. PROHIBIDO inventar datos, páginas, fórmulas o nombres que no aparezcan en un target.
2. Para CADA sección que generes, incluye "targetIds": los ids de ANALYSIS_TARGET que esa sección realmente narra. NUNCA inventes un id que no exista en el MATERIAL — si lo haces, se descarta server-side y no cuenta como cobertura.
3. Genera EXACTAMENTE una entrada de "clase_narrativa" por cada CLUSTER listado (ni más ni menos), narrando TODOS los targets de ese cluster juntos — un cluster grande puede necesitar una explicación más larga, uno pequeño una más corta. No comprimas clusters distintos en una sola entrada ni fragmentes un cluster en varias.
4. Actúa como tutor particular: contexto → base → desarrollo → conexiones → conclusión. Explica CAUSA y MECANISMO, no solo el dato.
5. Para cada fórmula (kind=formula): explica cada variable y qué representa, usando solo lo que aparece en su target.
6. No copies literal el "CONTENIDO AUTORIZADO" de los targets — reescribe con tus palabras, adaptado al nivel.
7. No hagas listas de definiciones aisladas ni relleno genérico.
8. Devuelve SOLO JSON válido. Sin markdown, sin texto extra.`;
}

function analysisUserPrompt(groundedText: string, materia: string, tema: string, masteryBlock: string): string {
  return `MATERIA: ${materia || '(sin materia)'}
TEMA: ${tema || '(sin tema)'}
${masteryBlock}
MATERIAL (clusters y targets autorizados):
"""
${groundedText}
"""

Devuelve EXACTAMENTE este JSON:
{
  "objetivos": ["objetivo de aprendizaje"],
  "si_no_sabes_nada": "2-3 oraciones para quien no sabe nada del tema",
  "mapa_inicial": "problema/contexto → idea central → mecanismo, en 1-2 oraciones",
  "clase_narrativa": [
    { "titulo": "título específico del cluster", "explicacion": "5-8 oraciones narrando TODOS los targets del cluster", "ejemplo": "", "checkpoint": "pregunta causa→mecanismo→consecuencia", "targetIds": [] }
  ],
  "panorama_completo": "6-10 oraciones de overview",
  "conexiones_clave": [ { "titulo": "conexión", "explicacion": "explicación", "targetIds": [] } ],
  "errores_comunes": [ { "error": "confusión realista del nivel de audiencia", "correccion": "corrección precisa", "mini_ejemplo": "", "targetIds": [] } ],
  "preguntas_profesor": [ { "pregunta": "pregunta causal", "que_evalua": "qué evalúa", "respuesta_esperada": "respuesta esperada", "targetIds": [] } ],
  "resumen_final": "3-4 oraciones causales de resumen",
  "preguntas_sugeridas": ["pregunta que el estudiante podría hacerle a ALAI"]
}`;
}

/** Filters an array of provider-returned targetIds down to only ids that exist in this Brain's target set. */
function filterKnownTargetIds(rawIds: unknown, knownIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(rawIds)) return [];
  return rawIds.map(id => String(id || '').trim()).filter(id => id && knownIds.has(id));
}

// DEV-safe: log the failure class + provider/model only, never the raw
// provider text or the authorized academic source content it was built
// from.
function logGroundedAlaiFailure(label: string, error: any) {
  const detail = error?.code === 'INVALID_JSON'
    ? { code: 'INVALID_JSON', jsonFailureClass: error.jsonFailureClass }
    : { code: error?.code || 'PROVIDER_FAILURE', message: error?.message };
  console.warn(`⚠️ safeGroundedAlaiJson ${label}:`, JSON.stringify(detail));
}

async function safeGroundedAlaiJson(prompt: string, systemPrompt: string, maxTokens: number): Promise<any> {
  try {
    return await __routeDeps.alaiJson({
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      temperature: 0.25, maxTokens, json: true,
    });
  } catch (firstError: any) {
    logGroundedAlaiFailure('primer intento falló', firstError);
    try {
      return await __routeDeps.alaiJson({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt + '\n\nIMPORTANTE FINAL: Devuelve SOLO JSON válido, sin markdown, sin explicaciones fuera del JSON.' },
        ],
        // Keep the SAME token budget on retry — a truncated first attempt
        // (INVALID_JSON/TRUNCATED) needs at least as much room to finish,
        // never less; shrinking it here only made truncation more likely.
        temperature: 0.15, maxTokens, json: true,
      });
    } catch (secondError: any) {
      logGroundedAlaiFailure('segundo intento falló', secondError);
      return null;
    }
  }
}

/**
 * The StudyalMaterialEnjoyer grounded pipeline: 1 provider call for the
 * pedagogical narration, everything else (cobertura_material,
 * para_examen, probabilidad_examen, ya_puedes_explicar, coverage) is
 * deterministic, derived directly from the persisted Enjoyer by
 * analysisEnjoyerContext.ts. No chunking, no extraction, no vision
 * calls, no PDF re-parsing, no Enjoyer regeneration.
 */
async function handleGroundedAnalysisRequest(
  sessionId: string, userId: string, nivel: string, materia: string, tema: string, masteryContext: any,
  studyNotes = false, upgrade = false,
): Promise<NextResponse> {
  const enjoyerLookup = await resolveReadyAnalysisEnjoyer(sessionId, userId);
  if (!enjoyerLookup.context) return groundedErrorResponse(enjoyerLookup.code, enjoyerLookup.status);
  const context = enjoyerLookup.context;

  // Server-resolved identity ONLY: userId from the authenticated session,
  // fingerprint from the just-resolved (never client-supplied) Enjoyer
  // authority. A forged client fingerprint/materialIds/userId can never
  // select or overwrite another selection's or another user's artifact.
  const generatorVersion = studyNotes ? ANALYSIS_STUDY_NOTES_VERSION : ANALYSIS_ENJOYER_ADAPTER_VERSION;
  const identity = analysisArtifactIdentity(userId, context.fingerprint, nivel, studyNotes ? ANALYSIS_STUDY_NOTES_VERSION : undefined);

  // READ-BEFORE-GENERATE: an existing valid durable artifact is restored
  // with ZERO provider calls — never regenerated merely because the
  // client's localStorage cache is empty (refresh, new device, cleared
  // storage, or simply leaving and returning to Análisis).
  const existingArtifact = await __routeDeps.analysisArtifactStore.get(identity);
  if (isValidRestorableArtifact(existingArtifact, {
    userId, fingerprint: context.fingerprint, nivel, generatorVersion,
  })) {
    if (studyNotes) {
      const notes = existingArtifact.analisis;
      if (!isAnalysisStudyNotes(notes) || notes.grounding.fingerprint !== context.fingerprint
        || notes.materialLanguage !== (context.materialLanguage || 'und')
        || !validateStudyNotes({ ...notes, title: notes.titulo }, context).notes) return groundedErrorResponse('ANALYSIS_RESTORE_INVALID', 409);
    }
    return NextResponse.json({ success: true, analisis: existingArtifact.analisis });
  }
  // A malformed/version-mismatched persisted response is not proof of absence.
  if (studyNotes && existingArtifact) return groundedErrorResponse('ANALYSIS_RESTORE_INVALID', 409);
  if (studyNotes && !upgrade) {
    const legacy = await __routeDeps.analysisArtifactStore.get(analysisArtifactIdentity(userId, context.fingerprint, nivel));
    if (legacy) {
      if (!isValidRestorableArtifact(legacy, { userId, fingerprint: context.fingerprint, nivel, generatorVersion: ANALYSIS_ENJOYER_ADAPTER_VERSION })) return groundedErrorResponse('ANALYSIS_RESTORE_INVALID', 409);
      // Restore valid work first. The student can explicitly compile a new format; the legacy artifact remains intact.
      return NextResponse.json({ success: true, analisis: legacy.analisis });
    }
  }

  // Single-flight: a second concurrent request for the exact same
  // user+fingerprint+nivel identity awaits the SAME in-progress
  // generation instead of starting its own. The map is updated
  // synchronously (no `await` between the check above and the `.set`
  // below), so whichever concurrent call resumes second always observes
  // the first's entry before creating its own.
  const existingGeneration = inFlightAnalysisGenerations.get(identity);
  // A shared in-flight NextResponse's body can only be read ONCE — every
  // additional concurrent waiter must clone it before the caller consumes
  // its body, or the second/third/... waiter would throw "Body already
  // read" trying to serialize the very same Response instance twice.
  if (existingGeneration) return existingGeneration.then(response => response.clone() as NextResponse);

  const operation = studyNotes
    ? generateAndPersistStudyNotes(context, identity, userId, nivel)
    : generateAndPersistAnalysis(context, identity, userId, nivel, materia, tema, masteryContext);
  inFlightAnalysisGenerations.set(identity, operation);
  try {
    return await operation;
  } finally {
    if (inFlightAnalysisGenerations.get(identity) === operation) inFlightAnalysisGenerations.delete(identity);
  }
}

async function generateAndPersistStudyNotes(context: AnalysisEnjoyerContext, identity: string, userId: string, nivel: string): Promise<NextResponse> {
  if (!context.targets.length) return groundedErrorResponse('NO_ANALYSIS_TARGETS', 400);
  let analisis;
  try {
    analisis = await compileStudyNotes(context, nivel, ({ system, prompt, maxTokens }) => __routeDeps.alaiJson({
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      json: true, temperature: 0.2, maxTokens, taskType: 'summary', timeoutMs: 55_000, transportRetries: 0, maxProviderAttempts: 1,
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'ANALYSIS_NOTES_INCOMPLETE';
    return groundedErrorResponse('ANALYSIS_NOTES_INCOMPLETE', 502, detail);
  }
  const now = new Date().toISOString();
  await __routeDeps.analysisArtifactStore.set(identity, {
    schemaVersion: ANALYSIS_ARTIFACT_SCHEMA_VERSION, generatorVersion: ANALYSIS_STUDY_NOTES_VERSION,
    userId, sourceSelectionFingerprint: context.fingerprint, nivel, analisis, createdAt: now, updatedAt: now,
  });
  return NextResponse.json({ success: true, analisis });
}

async function generateAndPersistAnalysis(
  context: AnalysisEnjoyerContext, identity: string, userId: string, nivel: string, materia: string, tema: string, masteryContext: any,
): Promise<NextResponse> {
  const targets: AnalysisEnjoyerTarget[] = context.targets;

  if (!targets.length) {
    return groundedErrorResponse('NO_ANALYSIS_TARGETS', 400, 'El material no tiene contenido analizable.');
  }

  const knownTargetIds = new Set(targets.map(target => target.id));
  const groundedText = renderAnalysisEnjoyerContext(context);
  const nivelInstruccion = ANALYSIS_NIVEL_DESC[nivel] || ANALYSIS_NIVEL_DESC.universidad;

  const masteryBlock = masteryContext ? [
    'PERFIL DEL ESTUDIANTE (adapta la clase a este perfil):',
    `Dominio actual: ${masteryContext.overallMastery ?? 0}%`,
    masteryContext.criticalConcepts?.length ? `CONCEPTOS CRITICOS que DEBE dominar: ${masteryContext.criticalConcepts.join(', ')}` : '',
    masteryContext.weakConcepts?.length ? `CONCEPTOS DEBILES - enfoca aqui: ${masteryContext.weakConcepts.join(', ')}` : '',
    '',
  ].filter(Boolean).join('\n') + '\n' : '';

  // Token budget scales with cluster count so a large Brain isn't forced
  // through the same fixed ceiling as a tiny one — capped for safety.
  const maxTokens = Math.min(3000 + context.clusters.length * 220, 12000);

  const parsed = await safeGroundedAlaiJson(
    analysisUserPrompt(groundedText, materia, tema, masteryBlock),
    analysisSystemPrompt(nivelInstruccion),
    maxTokens,
  );
  if (!parsed) {
    return groundedErrorResponse('PROVIDER_GENERATION_FAILED', 502, 'No se pudo generar el análisis grounded.');
  }
  const clean = (cleanDeep(parsed) as any) || {};

  const claseNarrativaRaw = Array.isArray(clean.clase_narrativa) ? clean.clase_narrativa : [];
  const claseNarrativa = claseNarrativaRaw.map((item: any) => ({
    titulo: String(item?.titulo || '').trim(),
    explicacion: String(item?.explicacion || '').trim(),
    ejemplo: String(item?.ejemplo || '').trim(),
    checkpoint: String(item?.checkpoint || '').trim(),
    targetIds: filterKnownTargetIds(item?.targetIds, knownTargetIds),
  })).filter((item: any) => item.titulo && item.explicacion);

  const conexionesClave = (Array.isArray(clean.conexiones_clave) ? clean.conexiones_clave : []).map((item: any) => ({
    titulo: String(item?.titulo || '').trim(),
    explicacion: String(item?.explicacion || '').trim(),
    targetIds: filterKnownTargetIds(item?.targetIds, knownTargetIds),
  })).filter((item: any) => item.titulo && item.explicacion);

  const erroresComunes = (Array.isArray(clean.errores_comunes) ? clean.errores_comunes : []).map((item: any) => ({
    error: String(item?.error || '').trim(),
    correccion: String(item?.correccion || '').trim(),
    mini_ejemplo: String(item?.mini_ejemplo || '').trim(),
    targetIds: filterKnownTargetIds(item?.targetIds, knownTargetIds),
  })).filter((item: any) => item.error && item.correccion);

  const preguntasProfesor = (Array.isArray(clean.preguntas_profesor) ? clean.preguntas_profesor : []).map((item: any) => ({
    pregunta: String(item?.pregunta || '').trim(),
    que_evalua: String(item?.que_evalua || '').trim(),
    respuesta_esperada: String(item?.respuesta_esperada || '').trim(),
    targetIds: filterKnownTargetIds(item?.targetIds, knownTargetIds),
  })).filter((item: any) => item.pregunta);

  // Everything a target could be "represented by" across all narrated
  // sections — the ONLY inputs to coverage. Ids outside knownTargetIds
  // were already dropped above by filterKnownTargetIds.
  const representedTargetIds = Array.from(new Set([
    ...claseNarrativa.flatMap((item: any) => item.targetIds),
    ...conexionesClave.flatMap((item: any) => item.targetIds),
    ...erroresComunes.flatMap((item: any) => item.targetIds),
    ...preguntasProfesor.flatMap((item: any) => item.targetIds),
  ]));
  const coverage = computeAnalysisCoverage(targets, representedTargetIds);

  const analisis = {
    titulo: 'Profesor ALAI',
    nivel_detectado: nivel,
    objetivos: Array.isArray(clean.objetivos) ? clean.objetivos.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 10) : [],
    si_no_sabes_nada: String(clean.si_no_sabes_nada || '').trim(),
    mapa_inicial: String(clean.mapa_inicial || '').trim(),
    // Deterministic — derived directly from the Enjoyer, not the provider.
    cobertura_material: deterministicCoberturaMaterial(targets),
    clase_narrativa: claseNarrativa,
    panorama_completo: String(clean.panorama_completo || '').trim(),
    conexiones_clave: conexionesClave,
    errores_comunes: erroresComunes,
    preguntas_profesor: preguntasProfesor,
    para_examen: deterministicParaExamen(targets),
    probabilidad_examen: deterministicProbabilidadExamen(targets),
    ya_puedes_explicar: deterministicYaPuedesExplicar(targets),
    resumen_final: String(clean.resumen_final || '').trim(),
    preguntas_sugeridas: Array.isArray(clean.preguntas_sugeridas) ? clean.preguntas_sugeridas.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 6) : [],
    preguntale_alai: 'Puedes preguntarme cualquier duda sobre este material.',
    grounding: {
      fingerprint: context.fingerprint,
      authorityType: ANALYSIS_ENJOYER_AUTHORITY_TYPE,
      adapterVersion: ANALYSIS_ENJOYER_ADAPTER_VERSION,
      totalAnalysisTargets: coverage.totalAnalysisTargets,
      representedAnalysisTargets: coverage.representedAnalysisTargets,
      coveragePercent: coverage.coveragePercent,
      missingTargetIds: coverage.missingTargetIds,
      clusterCount: context.clusters.length,
    },
  };

  // Schema-invalid generation writes nothing — a response with zero
  // narrated clusters is not a usable Análisis, regardless of provider
  // status. Never persisted, never cached; a future explicit retry may
  // try again.
  if (!analisis.clase_narrativa.length) {
    return groundedErrorResponse('PROVIDER_GENERATION_FAILED', 502, 'El análisis generado no tiene contenido narrado válido.');
  }

  const now = new Date().toISOString();
  const artifact: AnalysisArtifact = {
    schemaVersion: ANALYSIS_ARTIFACT_SCHEMA_VERSION,
    generatorVersion: ANALYSIS_ENJOYER_ADAPTER_VERSION,
    userId,
    sourceSelectionFingerprint: context.fingerprint,
    nivel,
    analisis,
    createdAt: now,
    updatedAt: now,
  };
  await __routeDeps.analysisArtifactStore.set(identity, artifact);

  return NextResponse.json({ success: true, analisis });
}

// ── Validación básica de strings ───────────────────────────────
const ok = (s: any, min = 10) =>
  typeof s === 'string' && s.trim().length >= min;

// ── Chunking / reducción jerárquica ─────────────────────────────
function splitIntoChunks(text: string, chunkSize = 9000): string[] {
  const chunks: string[] = [];
  let remaining = String(text || '').trim();

  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining);
      break;
    }

    let cut = remaining.lastIndexOf('\n\n', chunkSize);
    if (cut < chunkSize * 0.5) cut = remaining.lastIndexOf('\n', chunkSize);
    if (cut < chunkSize * 0.5) cut = chunkSize;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  return chunks.filter(Boolean);
}

function extractPrompt(lang: 'es' | 'en', materialName: string, chunkIndex: number, totalChunks: number, text: string): string {
  if (lang === 'es') return `Eres ALAI EXTRACTOR PEDAGÓGICO 10/10.

Tu trabajo NO es resumir.
Tu trabajo es convertir este fragmento en conocimiento enseñable, completo y estructurado.

REGLA PRINCIPAL:
Si este fragmento contiene una idea, dato, proceso, fórmula, síntoma, mecanismo, personaje, fecha, causa, consecuencia, ejemplo, definición o relación importante, DEBE aparecer en el JSON.

PROHIBIDO:
- Resumir demasiado.
- Devolver solo 2 o 3 conceptos.
- Repetir frases genéricas.
- Inventar información externa al fragmento.
- Conectar con materiales externos.
- Perder pasos de procesos.
- Ignorar fórmulas, variables, fechas, nombres o ejemplos.
- Elevar a concepto principal algo que el fragmento menciona de pasada.
- Explicar una fórmula solo con "describe X" sin decir qué significa cada parte.

OBLIGATORIO:
- Identifica qué es CENTRAL en el fragmento (se repite, se explica en detalle, ocupa más de 3 oraciones) vs qué es SECUNDARIO (se menciona en 1-2 oraciones como contexto).
- Los conceptos centrales deben tener explicacion_profesor de 6-12 oraciones.
- Los conceptos secundarios pueden tener 1-2 oraciones y marca importancia: "secundario".
- Para CADA fórmula que aparezca: explica qué significa el signo, qué pasa cuando n=1/2/3, qué límite tiene y qué fenómeno describe.
- Separa subideas específicas: problema de Rutherford, estabilidad del átomo, órbitas cuantizadas, niveles de energía, saltos cuánticos, espectro del hidrógeno, fórmula Eₙ.
- Si el fragmento menciona el espectro del hidrógeno, extráelo como concepto separado.
- Si el fragmento menciona algo en 1 oración (Nobel, Instituto, energía nuclear, WWII), márcalo importancia: "secundario". NO lo incluyas en no_omitir.
- REGLA CRÍTICA: no_omitir solo debe contener conceptos que un estudiante NECESITA para entender el tema central. Excluye premios, instituciones y datos biográficos.

Material: ${materialName}
Fragmento: ${chunkIndex + 1}/${totalChunks}

Devuelve SOLO JSON válido con esta estructura exacta:

{
  "tema_principal": "De qué trata este fragmento en una oración clara",

  "puntos_del_fragmento": [
    {
      "punto": "idea, dato o subtema específico del fragmento",
      "explicacion": "explicación clara de 1-3 oraciones",
      "tipo": "concepto | dato | proceso | fórmula | causa | consecuencia | ejemplo | persona | fecha | aplicación"
    }
  ],

  "conceptos": [
    {
      "nombre": "concepto importante",
      "definicion_clara": "definición entendible",
      "explicacion_profesor": "explicación pedagógica de 6-12 oraciones: qué es, qué problema resuelve, por qué importa, cómo funciona, qué causa, qué consecuencia tiene y cómo se usa en este fragmento",
      "nivel": "base | intermedio | avanzado",
      "importancia": "central | secundario | contextual"
    }
  ],

  "vocabulario_tecnico": [
    {
      "termino": "término técnico",
      "definicion": "definición simple",
      "como_recordarlo": "forma fácil de recordarlo"
    }
  ],

  "procesos_paso_a_paso": [
    {
      "nombre": "proceso, mecanismo, cronología o secuencia",
      "pasos": [
        "paso 1 explicado",
        "paso 2 explicado",
        "paso 3 explicado"
      ],
      "resultado": "qué produce el proceso",
      "por_que_importa": "por qué este proceso ayuda a entender el material"
    }
  ],

  "causas_y_consecuencias": [
    {
      "causa": "qué ocurre primero",
      "mecanismo": "cómo esa causa produce el efecto",
      "consecuencia": "qué ocurre después",
      "importancia": "por qué importa"
    }
  ],

  "formulas_y_variables": [
    {
      "formula": "fórmula exacta si aparece",
      "variables": [
        { "simbolo": "símbolo", "significado": "qué representa" }
      ],
      "para_que_sirve": "qué permite calcular o entender",
      "ejemplo_uso": "ejemplo breve si el fragmento lo permite",
      "interpretacion_profunda": "Explica: 1) qué significa el signo (positivo/negativo/fracción), 2) qué pasa cuando cada variable aumenta o disminuye, 3) qué valor límite tiene y qué significa físicamente ese límite, 4) qué fenómeno real describe esta ecuación que sin ella no se podría entender"
    }
  ],

  "personas_fechas_datos": [
    {
      "dato": "persona, fecha, lugar, premio, número o dato concreto",
      "explicacion": "por qué aparece y por qué importa"
    }
  ],

  "ejemplos_del_material": [
    {
      "ejemplo": "ejemplo o caso mencionado",
      "que_demuestra": "qué enseña ese ejemplo"
    }
  ],

  "relaciones_internas": [
    {
      "idea_a": "idea A",
      "idea_b": "idea B",
      "relacion": "cómo se conectan dentro del MISMO material"
    }
  ],

  "errores_o_confusiones": [
    {
      "confusion": "malentendido probable",
      "correccion": "forma correcta de entenderlo",
      "mini_ejemplo": "ejemplo breve"
    }
  ],

  "preguntas_examen_chunk": [
    {
      "pregunta": "pregunta profunda que un profesor podría hacer sobre este fragmento",
      "respuesta_esperada": "respuesta ideal en 2-4 oraciones"
    }
  ],

  "orden_para_ensenar": [
    "primero enseña esto",
    "después esto",
    "luego esto"
  ],

  "no_omitir": [
    "lista de detalles concretos del fragmento que NO deben perderse en la clase final"
  ]
}

Fragmento:
${text}`;

  return `You are ALAI PEDAGOGICAL EXTRACTOR 10/10.

Your job is NOT to summarize.
Your job is to turn this chunk into complete, teachable, structured knowledge.

MAIN RULE:
If this chunk contains an important idea, fact, process, formula, symptom, mechanism, person, date, cause, consequence, example, definition or relationship, it MUST appear in the JSON.

FORBIDDEN:
- Over-summarizing.
- Returning only 2 or 3 concepts.
- Repeating generic phrases.
- Inventing external information.
- Connecting this material with other materials.
- Losing process steps.
- Ignoring formulas, variables, dates, names or examples.

MANDATORY:
- Extract between 8 and 25 concepts if the chunk contains them.
- Extract between 8 and 30 details in no_omitir if the chunk contains them.
- Do NOT group many ideas under "Quantum mechanics" or "Bohr model".
- Separate subideas: Rutherford problem, atomic stability, orbits, energy levels, quantum jumps, hydrogen spectrum, formula, variables, Copenhagen interpretation, Nobel, applications, etc.
- If there are few facts, extract all. If there are many, prioritize academically useful facts.

Material: ${materialName}
Chunk: ${chunkIndex + 1}/${totalChunks}

Return ONLY valid JSON with this exact structure:

{
  "tema_principal": "What this chunk is about in one clear sentence",

  "puntos_del_fragmento": [
    {
      "punto": "specific idea, fact or subtopic from the chunk",
      "explicacion": "clear 1-3 sentence explanation",
      "tipo": "concept | fact | process | formula | cause | consequence | example | person | date | application"
    }
  ],

  "conceptos": [
    {
      "nombre": "important concept",
      "definicion_clara": "understandable definition",
      "explicacion_profesor": "6-12 sentence pedagogical explanation: what it is, what problem it solves, why it matters, how it works, what it causes, what consequence it has and how it is used in this chunk",
      "nivel": "base | intermedio | avanzado"
    }
  ],

  "vocabulario_tecnico": [
    {
      "termino": "technical term",
      "definicion": "simple definition",
      "como_recordarlo": "easy way to remember it"
    }
  ],

  "procesos_paso_a_paso": [
    {
      "nombre": "process, mechanism, chronology or sequence",
      "pasos": [
        "explained step 1",
        "explained step 2",
        "explained step 3"
      ],
      "resultado": "what the process produces",
      "por_que_importa": "why this process helps understand the material"
    }
  ],

  "causas_y_consecuencias": [
    {
      "causa": "what happens first",
      "mecanismo": "how that cause produces the effect",
      "consecuencia": "what happens next",
      "importancia": "why it matters"
    }
  ],

  "formulas_y_variables": [
    {
      "formula": "exact formula if present",
      "variables": [
        { "simbolo": "symbol", "significado": "what it represents" }
      ],
      "para_que_sirve": "what it calculates or explains",
      "ejemplo_uso": "brief example if supported by the chunk"
    }
  ],

  "personas_fechas_datos": [
    {
      "dato": "person, date, place, award, number or concrete fact",
      "explicacion": "why it appears and why it matters"
    }
  ],

  "ejemplos_del_material": [
    {
      "ejemplo": "example or case mentioned",
      "que_demuestra": "what that example teaches"
    }
  ],

  "relaciones_internas": [
    {
      "idea_a": "idea A",
      "idea_b": "idea B",
      "relacion": "how they connect inside the SAME material"
    }
  ],

  "errores_o_confusiones": [
    {
      "confusion": "likely misunderstanding",
      "correccion": "correct way to understand it",
      "mini_ejemplo": "brief example"
    }
  ],

  "preguntas_examen_chunk": [
    {
      "pregunta": "deep question a professor could ask about this chunk",
      "respuesta_esperada": "ideal 2-4 sentence answer"
    }
  ],

  "orden_para_ensenar": [
    "teach this first",
    "then this",
    "then this"
  ],

  "no_omitir": [
    "concrete details from the chunk that must NOT be lost in the final class"
  ]
}

Chunk:
${text}`;
}


function compactExtractedKnowledge(extracted: any[]) {
  const out = {
    temas: [] as string[],
    ideas: [] as string[],
    vocabulario: [] as string[],
    causas: [] as string[],
    procesos: [] as string[],
    formulas: [] as string[],
    relaciones: [] as string[],
    ejemplos: [] as string[],
    datos: [] as string[],
    confusiones: [] as string[],
    preguntas: [] as string[],
    orden: [] as string[],
    noOmitir: [] as string[],
  };

  const push = (arr: string[], value: any) => {
    const text = formatStudyText(value);
    if (!text || isPlaceholderText(text)) return;
    const key = text.toLowerCase();
    if (!arr.some((x) => x.toLowerCase() === key)) arr.push(text);
  };

  for (const e of extracted || []) {
    push(out.temas, e?.tema_principal);

    for (const x of e?.puntos_del_fragmento || []) {
      push(out.ideas, `${x.punto}: ${x.explicacion || ''}${x.tipo ? ` Tipo: ${x.tipo}` : ''}`);
      push(out.noOmitir, `${x.punto}: ${x.explicacion || ''}`);
    }

    for (const x of e?.conceptos || []) {
      push(out.ideas, `${x.nombre}: ${x.definicion_clara || ''}. ${x.explicacion_profesor || ''}${x.nivel ? ` Nivel: ${x.nivel}` : ''}`);
    }

    for (const x of e?.ideas_nucleares || []) {
      push(out.ideas, `${x.idea}: ${x.explicacion}${x.por_que_importa ? ` Importancia: ${x.por_que_importa}` : ''}`);
    }

    for (const x of e?.elementos_clave || []) {
      push(out.ideas, `${x.elemento}: ${x.explicacion || ''}${x.importancia ? ` Importancia: ${x.importancia}` : ''}`);
    }

    for (const x of e?.vocabulario_tecnico || []) {
      push(out.vocabulario, `${x.termino}: ${x.definicion || ''}${x.contexto ? ` Contexto: ${x.contexto}` : ''}${x.como_recordarlo ? ` Recordatorio: ${x.como_recordarlo}` : ''}`);
    }

    for (const x of e?.causas_y_consecuencias || []) {
      push(out.causas, `${x.causa} → ${x.consecuencia}. ${x.mecanismo || x.explicacion || ''}${x.importancia ? ` Importancia: ${x.importancia}` : ''}`);
    }

    for (const x of e?.procesos_paso_a_paso || []) {
      const pasos = Array.isArray(x.pasos) ? x.pasos.join(' → ') : '';
      push(out.procesos, `${x.nombre}: ${pasos}${x.resultado ? ` Resultado: ${x.resultado}` : ''}${x.por_que_importa ? ` Importancia: ${x.por_que_importa}` : ''}`);
    }

    for (const x of e?.procesos || []) {
      const pasos = Array.isArray(x.pasos) ? x.pasos.join(' → ') : '';
      push(out.procesos, `${x.nombre}: ${pasos}${x.resultado ? ` Resultado: ${x.resultado}` : ''}`);
    }

    for (const x of e?.formulas_y_variables || []) {
      const formulaRaw = formatStudyText(x?.formula);
      const vars = Array.isArray(x.variables)
        ? x.variables
            .map((v: any) => `${formatStudyText(v?.simbolo)}=${formatStudyText(v?.significado)}`)
            .filter((v: string) =>
              v &&
              !/no aplica/i.test(v) &&
              !/no hay/i.test(v) &&
              !/no se menciona/i.test(v)
            )
            .join(', ')
        : '';

      const interpretacion = x.interpretacion_profunda ? ` Interpretación: ${x.interpretacion_profunda}` : '';
      const formulaLine = formatStudyText(`${formulaRaw}: ${vars}. Sirve para: ${x.para_que_sirve || ''}${x.ejemplo_uso ? ` Ejemplo: ${x.ejemplo_uso}` : ''}${interpretacion}`);

      if (
        !formulaRaw ||
        formulaRaw === '=' ||
        /no aplica/i.test(formulaLine) ||
        /no hay/i.test(formulaLine) ||
        /no se menciona/i.test(formulaLine)
      ) {
        continue;
      }

      push(out.formulas, formulaLine);
    }

    for (const x of e?.relaciones_internas || []) {
      push(out.relaciones, `${x.idea_a} → ${x.idea_b}: ${x.relacion}`);
    }

    for (const x of e?.relaciones || []) {
      push(out.relaciones, `${x.de} → ${x.a}: ${x.como}`);
    }

    for (const x of e?.ejemplos_del_material || []) {
      push(out.ejemplos, `${x.ejemplo}: ${x.que_demuestra}`);
    }

    for (const x of e?.ejemplos || []) {
      push(out.ejemplos, `${x.titulo}: ${x.explicacion}`);
    }

    for (const x of e?.personas_fechas_datos || []) {
      push(out.datos, `${x.dato}: ${x.explicacion}`);
    }

    for (const x of e?.datos_importantes || []) {
      push(out.datos, x);
    }

    for (const x of e?.errores_o_confusiones || []) {
      push(out.confusiones, `${x.confusion}: ${x.correccion}${x.mini_ejemplo ? ` Ejemplo: ${x.mini_ejemplo}` : ''}`);
    }

    for (const x of e?.confusiones || []) {
      push(out.confusiones, `${x.error}: ${x.correccion}`);
    }

    for (const x of e?.preguntas_examen_chunk || []) {
      push(out.preguntas, `${x.pregunta} Respuesta esperada: ${x.respuesta_esperada}`);
    }

    for (const x of e?.orden_para_ensenar || []) {
      push(out.orden, x);
    }

    for (const x of e?.no_omitir || []) {
      push(out.noOmitir, x);
    }
  }

  return {
    temas: out.temas.slice(0, 20),
    ideas: out.ideas.slice(0, 120),
    vocabulario: out.vocabulario.slice(0, 100),
    causas: out.causas.slice(0, 80),
    procesos: out.procesos.slice(0, 70),
    formulas: out.formulas.slice(0, 40),
    relaciones: out.relaciones.slice(0, 90),
    ejemplos: out.ejemplos.slice(0, 60),
    datos: out.datos.slice(0, 100),
    confusiones: out.confusiones.slice(0, 50),
    preguntas: out.preguntas.slice(0, 60),
    orden: out.orden.slice(0, 80),
    noOmitir: out.noOmitir.slice(0, 120),
  };
}


function simpleSynthPromptA(lang: 'es' | 'en', materialName: string, compact: any): string {
  const data = JSON.stringify(compact);

  if (lang === 'es') return `Devuelve SOLO JSON válido. Sin markdown.

Crea una clase clara basada SOLO en estos datos extraídos.

Material: ${materialName}
Datos:
${data}

JSON:
{
  "titulo": "Profesor ALAI",
  "objetivos": ["objetivo 1", "objetivo 2", "objetivo 3"],
  "si_no_sabes_nada": "Explicación inicial clara de 5-8 oraciones.",
  "mapa_inicial": "Mapa del tema de 5-8 oraciones.",
  "cobertura_material": [
    { "elemento": "elemento importante", "por_que_importa": "por qué importa" }
  ],
  "clase_narrativa": [
    {
      "titulo": "título",
      "explicacion": "Clase clara de 8-12 oraciones. Explica paso a paso, causa y consecuencia.",
      "ejemplo": "ejemplo",
      "checkpoint": "pregunta de comprensión"
    }
  ]
}`;

  return `Return ONLY valid JSON. No markdown.

Create a clear class based ONLY on this extracted data.

Material: ${materialName}
Data:
${data}

JSON:
{
  "titulo": "Professor ALAI",
  "objetivos": ["objective 1", "objective 2", "objective 3"],
  "si_no_sabes_nada": "Clear initial 5-8 sentence explanation.",
  "mapa_inicial": "5-8 sentence topic map.",
  "cobertura_material": [
    { "elemento": "important element", "por_que_importa": "why it matters" }
  ],
  "clase_narrativa": [
    {
      "titulo": "title",
      "explicacion": "Clear 8-12 sentence class. Explain step by step, cause and consequence.",
      "ejemplo": "example",
      "checkpoint": "understanding question"
    }
  ]
}`;
}

function simpleSynthPromptB(lang: 'es' | 'en', materialName: string, compact: any): string {
  const data = JSON.stringify(compact);

  if (lang === 'es') return `Devuelve SOLO JSON válido. Sin markdown.

Consolida esta clase basada SOLO en estos datos.

Material: ${materialName}
Datos:
${data}

JSON:
{
  "panorama_completo": "Explicación completa de 6-10 oraciones.",
  "conexiones_clave": [
    { "titulo": "conexión", "explicacion": "explicación" }
  ],
  "errores_comunes": [
    { "error": "error común", "correccion": "corrección", "mini_ejemplo": "ejemplo" }
  ],
  "preguntas_profesor": [
    { "pregunta": "pregunta profunda", "que_evalua": "qué evalúa", "respuesta_esperada": "respuesta esperada" }
  ],
  "para_examen": [
    { "punto": "punto clave", "por_que": "por qué importa" }
  ],
  "ya_puedes_explicar": ["algo que puedes explicar"],
  "resumen_final": "Resumen final de 5-7 oraciones.",
  "preguntas_sugeridas": ["pregunta sugerida"],
  "preguntale_alai": "Puedes preguntarme cualquier duda sobre este material."
}`;

  return `Return ONLY valid JSON. No markdown.

Consolidate this class based ONLY on this data.

Material: ${materialName}
Data:
${data}

JSON:
{
  "panorama_completo": "Complete 6-10 sentence explanation.",
  "conexiones_clave": [
    { "titulo": "connection", "explicacion": "explanation" }
  ],
  "errores_comunes": [
    { "error": "common mistake", "correccion": "correction", "mini_ejemplo": "example" }
  ],
  "preguntas_profesor": [
    { "pregunta": "deep question", "que_evalua": "what it evaluates", "respuesta_esperada": "expected answer" }
  ],
  "para_examen": [
    { "punto": "key point", "por_que": "why it matters" }
  ],
  "ya_puedes_explicar": ["something you can explain"],
  "resumen_final": "Final 5-7 sentence summary.",
  "preguntas_sugeridas": ["suggested question"],
  "preguntale_alai": "You can ask me any question about this material."
}`;
}


async function safeAlaiJson(prompt: string, maxTokens = 5000) {
  try {
    return await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
      maxTokens,
      json: true,
    });
  } catch (firstError: any) {
    console.warn('⚠️ safeAlaiJson json=true falló:', firstError?.message || firstError);

    try {
      return await alaiJson({
        messages: [{
          role: 'user',
          content: `${prompt}

IMPORTANTE FINAL:
Devuelve SOLO JSON válido.
No uses markdown.
No uses explicaciones fuera del JSON.
No uses comillas sin escapar dentro de strings.
Si no sabes un campo, usa [] o "" según corresponda.`,
        }],
        temperature: 0.15,
        maxTokens: Math.min(maxTokens, 5200),
        json: true,
      });
    } catch (secondError: any) {
      console.warn('⚠️ safeAlaiJson segundo intento falló:', secondError?.message || secondError);
      return null;
    }
  }
}


// ── Prompts ────────────────────────────────────────────────────
const REGLAS = (lang: 'es' | 'en') => lang === 'es'
  ? `REGLAS OBLIGATORIAS:
0. BASA TODO en el material enviado. PROHIBIDO inventar datos externos.
1. Actúa como Profesor ALAI: enseña como tutor particular, no como diccionario.
2. Asume que el estudiante NO sabe nada del tema.
3. Define términos técnicos la primera vez que aparezcan.
4. Explica el material como una historia mental: contexto → base → desarrollo → conexiones → conclusión.
5. Cubre el 100% de las ideas, nombres, procesos, fórmulas, fechas, ejemplos o personajes importantes del material seleccionado.
6. No hagas listas de definiciones aisladas.
7. No copies literal el material. Reescribe con tus palabras.
8. No uses relleno ni frases genéricas.
9. Cada sección debe hacer que el estudiante pueda explicar el tema con sus propias palabras.
10. Devuelve SOLO JSON válido. Sin markdown, sin texto extra.`
  : `MANDATORY RULES:
0. BASE EVERYTHING on the provided material. FORBIDDEN to invent external data.
1. Act as Professor ALAI: teach like a private tutor, not like a dictionary.
2. Assume the student knows nothing about the topic.
3. Define technical terms the first time they appear.
4. Explain the material as a mental story: context → foundation → development → connections → conclusion.
5. Cover 100% of the important ideas, names, processes, formulas, dates, examples or people in the selected material.
6. Do not make isolated definition lists.
7. Do not copy the material verbatim. Rewrite in your own words.
8. Avoid filler and generic phrases.
9. Every section must help the student explain the topic in their own words.
10. Return ONLY valid JSON. No markdown, no extra text.`;

function formatStudyText(value: any): string {
  let t = String(value || '');

  t = t.replace(/\^2/g, '²');
  t = t.replace(/\^3/g, '³');
  t = t.replace(/\bDelta\b/gi, 'Δ');
  t = t.replace(/lambda/gi, 'λ');
  t = t.replace(/\bnu\b/gi, 'ν');

  return t
    .replace(/\bE_n\b/g, 'Eₙ')
    .replace(/n\^2/g, 'n²')
    .replace(/c\^2/g, 'c²')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1 / $2')
    .replace(/-rac\{?13\.6\s*(?:ext\{\s*)?eV\s*(?:\})?\}?\{?n\^?2\}?/gi, '-13.6 eV / n²')
    .replace(/ext\{\s*eV\s*\}/gi, 'eV')
    .replace(/No hay fórmulas en este fragmento\.?:?[^.]*\.?/gi, '')
    .replace(/No se menciona una fórmula específica[^.]*\.?/gi, '')
    .replace(/\s+\/\s+n\^2/g, ' / n²')
    .replace(/\s+/g, ' ')
    .trim();
}


function isPlaceholderText(value: any): boolean {
  const t = String(value || '').trim().toLowerCase();
  if (!t) return true;

  const bad = [
    'confusión probable',
    'corrección',
    'ejemplo rápido',
    'idea clave de un material',
    'por qué importa',
    'pregunta por material o comparación válida',
    'qué mide',
    'respuesta ideal',
    'qué puede explicar ahora el estudiante',
    'pregunta útil',
    'conexión importante',
    'important connection',
    'likely confusion',
    'correction',
    'quick example',
    'key idea from one material',
    'why it matters',
    'question per material or valid comparison',
    'what it measures',
    'ideal answer',
    'what the student can now explain',
    'useful question',
  ];

  return bad.includes(t) || /^material \d+:\s*tema$/i.test(t);
}

function goodText(value: any, min = 8): string {
  const t = formatStudyText(value);
  return !isPlaceholderText(t) && t.length >= min ? t : '';
}


function normalizeLessonTitle(title: string): string {
  return String(title || '')
    .replace(/^Parte\s*\d+:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function dedupeNarrativeSections(parts: any[]) {
  const seen = new Set<string>();

  return parts.filter((p) => {
    const key = normalizeLessonTitle(p?.titulo);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueByText<T>(items: T[], getText: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const item of items) {
    const key = getText(item).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function buildMultiMaterialAnalisis({
  perMaterial,
  materialNames,
  detectedLang,
}: {
  perMaterial: any[];
  materialNames: string[];
  detectedLang: 'es' | 'en';
}) {
  const isEs = detectedLang === 'es';

  const objetivos = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.objetivos || []).map((x: string) => `${materialNames[i]}: ${x}`),
    ).filter((x: string) => goodText(x, 12)),
    (x) => x,
  ).slice(0, 24);

  
const BIOGRAPHY_RE = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|university|premio nobel|nobel prize|copenhagen|dinamarca)\b/i;

const cobertura_material = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.cobertura_material || []).map((x: any) => ({
        elemento: `${materialNames[i]}: ${x.elemento}`,
        por_que_importa: x.por_que_importa,
      })),
    ).filter((x: any) => goodText(x.elemento, 5) && goodText(x.por_que_importa, 10)),
    (x: any) => `${x.elemento} ${x.por_que_importa}`,
  ).slice(0, 120);

  const clase_narrativa = perMaterial.flatMap((a, i) =>
    (a.clase_narrativa || []).map((c: any, idx: number) => ({
      titulo: `${materialNames[i]} — ${String(c.titulo || '').replace(/^Parte\s*\d+:\s*/i, '').trim()}`,
      explicacion: c.explicacion,
      ejemplo: c.ejemplo,
      checkpoint: c.checkpoint,
    })),
  ).filter((c: any) => goodText(c.titulo, 8) && goodText(c.explicacion, 80));

  const conexiones_clave = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.conexiones_clave || []).map((x: any) => ({
        titulo: `${materialNames[i]}: ${x.titulo}`,
        explicacion: x.explicacion,
      })),
    ).filter((x: any) => goodText(x.titulo, 8) && goodText(x.explicacion, 20)),
    (x) => `${x.titulo} ${x.explicacion}`,
  ).slice(0, 24);

  const errores_comunes = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.errores_comunes || []).map((x: any) => ({
        error: `${materialNames[i]}: ${x.error}`,
        correccion: x.correccion,
        mini_ejemplo: x.mini_ejemplo,
      })),
    ).filter((x: any) => goodText(x.error, 12) && goodText(x.correccion, 12)),
    (x) => `${x.error} ${x.correccion}`,
  ).slice(0, 24);

  const preguntas_profesor = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.preguntas_profesor || []).map((x: any) => ({
        pregunta: `${materialNames[i]}: ${x.pregunta}`,
        que_evalua: x.que_evalua,
        respuesta_esperada: x.respuesta_esperada,
      })),
    ).filter((x: any) => goodText(x.pregunta, 12) && goodText(x.respuesta_esperada, 20)),
    (x) => x.pregunta,
  ).slice(0, 24);

  const para_examen = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.para_examen || []).map((x: any) => ({
        punto: `${materialNames[i]}: ${x.punto}`,
        por_que: x.por_que,
      })),
    ).filter((x: any) => goodText(x.punto, 12)),
    (x: any) => x.punto,
  ).slice(0, 30);

  const ya_puedes_explicar = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.ya_puedes_explicar || []).map((x: string) => `${materialNames[i]}: ${x}`),
    ).filter((x: string) => goodText(x, 12)),
    (x) => x,
  ).slice(0, 30);

  const preguntas_sugeridas = uniqueByText(
    perMaterial.flatMap((a, i) =>
      (a.preguntas_sugeridas || []).map((x: string) => `${materialNames[i]}: ${x}`),
    ).filter((x: string) => goodText(x, 12)),
    (x) => x,
  ).slice(0, 20);

  const taughtCount = cobertura_material.filter((item: any) =>
    clase_narrativa.some((c: any) =>
      c.explicacion.toLowerCase().includes(String(item.elemento).split(':').pop().trim().toLowerCase().slice(0, 24)),
    ),
  ).length;

  const coveragePercent = cobertura_material.length
    ? Math.round((taughtCount / cobertura_material.length) * 100)
    : 0;

  const titulo = isEs ? 'Clase completa de varios materiales' : 'Complete multi-material class';

  const si_no_sabes_nada = isEs
    ? `Seleccionaste ${materialNames.length} materiales. ALAI los va a enseñar por separado para que no mezcles temas que no tienen relación directa. Primero estudiarás cada material como una clase independiente. Después verás cómo organizar mentalmente todos los temas seleccionados. Si dos materiales no se conectan de forma clara, ALAI lo dirá directamente en vez de inventar una relación. La meta es que puedas explicar cada documento con tus propias palabras sin volver a abrirlo.`
    : `You selected ${materialNames.length} materials. ALAI will teach them separately so you do not mix topics that are not directly related. First you will study each material as an independent class. Then you will see how to organize all selected topics mentally. If two materials do not clearly connect, ALAI will say so instead of inventing a relationship. The goal is for you to explain each document in your own words without reopening it.`;

  const mapa_inicial = isEs
    ? `Materiales seleccionados: ${materialNames.join(', ')}. Cada material tiene su propia explicación, sus conceptos clave, sus preguntas de comprensión y sus puntos importantes para examen. El análisis está organizado para cubrir el contenido relevante de cada documento, no solo una idea general. Si los materiales pertenecen a áreas distintas, debes estudiarlos como bloques separados.`
    : `Selected materials: ${materialNames.join(', ')}. Each material has its own explanation, key concepts, understanding questions and exam points. The analysis is organized to cover the relevant content of each document, not only a general idea. If the materials belong to different areas, study them as separate blocks.`;

  const panorama_completo = isEs
    ? `Para estudiar estos materiales juntos, primero separa cada tema. No intentes forzar una conexión entre documentos que hablan de áreas distintas. Estudia cada clase completa, identifica sus conceptos clave y luego usa las preguntas de comprobación para verificar si realmente entendiste. Cuando termines, debes poder explicar qué enseña cada material, cuáles son sus conceptos centrales, qué procesos o relaciones aparecen y qué sería importante para una prueba o exposición.`
    : `To study these materials together, first separate each topic. Do not force a connection between documents from different areas. Study each complete class, identify its key concepts, then use the checking questions to verify whether you truly understood. When finished, you should be able to explain what each material teaches, its central concepts, its processes or relationships, and what matters for a test or presentation.`;

  const resumen_final = isEs
    ? `Este análisis organiza varios materiales como clases separadas para maximizar comprensión y evitar mezclas falsas. La prioridad es que aprendas cada documento con cobertura alta: conceptos, procesos, vocabulario, ejemplos, conexiones internas, errores comunes y puntos de examen. Primero domina cada material por separado; luego usa las preguntas de comprobación para verificar que puedes explicar causa, consecuencia y aplicación. Si algo todavía no está claro, usa Pregúntale a ALAI con una duda específica de ese material.`
    : `This analysis organizes multiple materials as separate classes to maximize understanding and avoid false mixing. The priority is learning each document with high coverage: concepts, processes, examples, internal connections and exam points. To go deeper, use Ask ALAI with a specific question from each material.`;

  return {
    titulo,
    objetivos,
    si_no_sabes_nada,
    mapa_inicial,
    cobertura_material,
    clase_narrativa,
    panorama_completo,
    conexiones_clave,
    errores_comunes,
    preguntas_profesor,
    para_examen,
    ya_puedes_explicar,
    resumen_final_profesor: resumen_final,
    preguntas_sugeridas,
    preguntale_alai: isEs
      ? 'Puedes preguntarme cualquier duda sobre este material.'
      : 'You can ask me any question about this material.',
    idioma: detectedLang,
    docNames: materialNames,
    coverage: {
      detected: cobertura_material.length,
      taught: taughtCount,
      percent: coveragePercent,
    },

    // Compatibilidad temporal
    historia_completa: panorama_completo,
    clases: clase_narrativa.map((c: any) => ({
      titulo: c.titulo,
      idea_central: c.explicacion.slice(0, 220),
      explicacion: c.explicacion,
      ejemplo_guiado: c.ejemplo,
      pregunta_reflexion: c.checkpoint,
    })),
    vocabulario_base: cobertura_material.map((x: any) => ({
      termino: x.elemento,
      explicacion: x.por_que_importa,
      por_que_aparece: x.por_que_importa,
    })),
    comprobacion: preguntas_profesor,
    desde_cero: [si_no_sabes_nada, mapa_inicial],
    ensenanza_guiada: clase_narrativa.map((c: any) => ({
      concepto: c.titulo,
      explicacion_simple: c.explicacion.slice(0, 220),
      explicacion_profunda: c.explicacion,
      ejemplo: c.ejemplo,
      por_que_importa: c.checkpoint,
    })),
    conexiones: conexiones_clave,
    confusiones: errores_comunes.map((e: any) => ({
      error: e.error,
      correccion: e.correccion,
      truco: e.mini_ejemplo,
    })),
    examen: para_examen.map((x: any) => x.punto),
    resumen_30s: resumen_final,
    vision_general: [si_no_sabes_nada, mapa_inicial],
    conceptos: clase_narrativa.map((c: any) => ({
      nombre: c.titulo,
      definicion_simple: c.explicacion.slice(0, 220),
      definicion_tecnica: c.explicacion,
      por_que_importa: c.checkpoint,
      ejemplo_concreto: c.ejemplo,
    })),
    resumen_final: para_examen.map((x: any) => x.punto),
    autoevaluacion: preguntas_profesor,
    ejemplos: [],
    analogias: [],
    aplicacion_real: [],
  };
}


function titleFromItem(item: any, fallback: string): string {
  const text = formatStudyText(item);
  const first = text.split(':')[0].trim();
  return goodText(first, 4) ? first.slice(0, 90) : fallback;
}

function cleanLearningLine(value: any): string {
  return formatStudyText(value)
    .replace(/\bTipo:\s*(concepto|dato|proceso|fecha|causa|consecuencia|fórmula|idea)\b\.?/gi, '')
    .replace(/\bNivel:\s*(base|intermedio|avanzado)\b\.?/gi, '')
    .replace(/\s*:\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortExplain(value: any, max = 360): string {
  const text = cleanLearningLine(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf(';'));
  return (lastDot > 160 ? cut.slice(0, lastDot + 1) : cut + '…').trim();
}

function makeHumanTeachingLesson({ cA, cB, lang, detectedLang, docNames }: any) {
  const compact = cA.__compact || cB.__compact || null;
  const isEs = detectedLang === 'es' || lang === 'es';
  if (!compact) return null;

  const clean = (v: any) =>
    cleanLearningLine(v)
      .replace(/^([^:]{3,90}):\s*\1:\s*/i, '$1: ')
      .replace(/^([^:]{3,90}):\s*\1\b/i, '$1')
      .replace(/\bTipo:\s*\w+\.?/gi, '')
      .replace(/\bNivel:\s*\w+\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

  const uniqueStrings = (items: any[]) =>
    uniqueByText<string>(
      items.map(clean).filter((x: string) => goodText(x, 18)),
      (x: string) => x,
    );

  const bioRe = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|university|infancia|premio nobel|nobel prize|copenhagen|dinamarca|lugar de nacimiento|fecha de nacimiento)\b/i;
  const formulaRe = /[A-Za-zÁÉÍÓÚáéíóú₀-₉]\s*=|Eₙ|E_n|n²|n\^2|Δ|λ|π|=|eV|J\b|mol|kg|m\/s|N\b|Pa\b/i;
  const problemRe = /\b(problema|limitaci[oó]n|dificultad|no pod[ií]a explicar|pregunta|confusi[oó]n|causa|riesgo|fallo|déficit|enfermedad|síntoma|necesidad)\b/i;
  const solutionRe = /\b(soluci[oó]n|propuso|modelo|explica|resuelve|tratamiento|mecanismo|teor[ií]a|respuesta|intervenci[oó]n|funci[oó]n|proceso)\b/i;
  const evidenceRe = /\b(ejemplo|caso|evidencia|demuestra|observa|experimento|resultado|espectro|gr[aá]fica|dato|medici[oó]n)\b/i;
  const impactRe = /\b(importancia|impacto|consecuencia|legado|aplicaci[oó]n|permite|sirve|uso|tecnolog|cl[ií]nica|examen|conclusi[oó]n)\b/i;

  const ideas = uniqueStrings(compact.ideas || []);
  const procesos = uniqueStrings(compact.procesos || []);
  const formulas = uniqueStrings([...(compact.formulas || []), ...ideas.filter((x: string) => formulaRe.test(x))]);
  const relaciones = uniqueStrings(compact.relaciones || []);
  const datos = uniqueStrings(compact.datos || []);
  const noOmitir = uniqueStrings(compact.noOmitir || []);
  const preguntas = uniqueStrings(compact.preguntas || []);
  const confusiones = uniqueStrings(compact.confusiones || []);

  const all = uniqueStrings([
    ...procesos,
    ...formulas,
    ...relaciones,
    ...ideas,
    ...datos,
    ...noOmitir,
  ]);

  if (!all.length) return null;

  const academicCore = uniqueStrings([
    ...procesos,
    ...formulas,
    ...relaciones,
    ...ideas.filter((x: string) => !bioRe.test(x)),
    ...noOmitir.filter((x: string) => !bioRe.test(x)),
  ]);

  const base = academicCore.length >= 4 ? academicCore : all;

  const findOne = (pool: string[], re: RegExp, fallback = '') =>
    pool.find((x: string) => re.test(x)) || fallback;

  const contextItem = findOne(base, /^(?!.*\b(naci[oó]|nacimiento|familia|universidad|university)\b).{20,}$/i, base[0]);
  const problemItem = findOne(base, problemRe, procesos[0] || base[1] || base[0]);
  const solutionItem = findOne(base, solutionRe, procesos[0] || base[2] || base[0]);
  const processItem = procesos[0] || solutionItem || base[0];
  const formulaItem = formulas[0] || '';
  const evidenceItem = findOne(base, evidenceRe, relaciones[0] || base[3] || base[0]);
  const impactItem = findOne(base, impactRe, relaciones[0] || noOmitir.find((x: string) => !bioRe.test(x)) || base[4] || base[0]);

  const chapterItems = uniqueByText<string>(
    [
      contextItem,
      problemItem,
      solutionItem,
      processItem,
      formulaItem || evidenceItem,
      impactItem,
    ].filter((x: string) => goodText(x, 18)),
    (x: string) => x,
  ).slice(0, 8);

  const theme = titleFromItem(contextItem || all[0], docNames?.[0] || 'Material');

  const explainFormula = (item: string) => {
    const text = shortExplain(item, 420);
    const hasNegative = /-\s*\d|−\s*\d/.test(item);
    const hasN = /\bn\b|n²|n\^2|Eₙ|E_n/i.test(item);

    return isEs
      ? `Cuando aparece una fórmula, no la memorices como dibujo: léela como una relación entre cantidades. ${text} Primero identifica qué representa cada símbolo. Después mira qué variable cambia y qué resultado produce. ${hasNegative ? 'Si la expresión tiene valor negativo, normalmente indica una cantidad ligada a un sistema o medida respecto a un punto de referencia, por eso no debe leerse como “energía mala”, sino como posición dentro de una escala.' : ''} ${hasN ? 'Si aparece n, suele representar un nivel, número de etapa o posición dentro de una secuencia; cuando n cambia, también cambia el resultado de la fórmula.' : ''} Lo importante es poder explicar con palabras qué relación resume la ecuación y para qué sirve dentro del tema.`
      : `When a formula appears, do not memorize it as a drawing: read it as a relationship between quantities. ${text} Identify each symbol, what changes, and what result the formula explains.`;
  };

  const chapter = (kind: 'context' | 'problem' | 'solution' | 'process' | 'formula' | 'impact', item: string, idx: number) => {
    const text = shortExplain(item, 520);
    const title =
      kind === 'context'
        ? (isEs ? 'De qué trata realmente este material' : 'What this material is really about')
      : kind === 'problem'
        ? (isEs ? 'El problema o pregunta central' : 'The central problem or question')
      : kind === 'solution'
        ? (isEs ? 'La idea principal que resuelve el problema' : 'The main idea that solves the problem')
      : kind === 'process'
        ? (isEs ? 'Cómo funciona paso a paso' : 'How it works step by step')
      : kind === 'formula'
        ? (isEs ? 'La fórmula explicada con palabras' : 'The formula explained in words')
      : (isEs ? 'Por qué esto importa y qué recordar' : 'Why this matters and what to remember');

    let explicacion = '';

    if (kind === 'context') {
      explicacion = isEs
        ? `${text} Esta es la base del material. Antes de memorizar nombres, fechas o fórmulas, debes entender qué tema está explicando el documento y cuál es su idea central. Si entiendes esta parte, el resto deja de sentirse como información suelta y empieza a verse como una explicación conectada.`
        : `${text} This is the foundation of the material. Before memorizing names, dates or formulas, understand what topic the document is explaining and what its central idea is.`;
    } else if (kind === 'problem') {
      explicacion = isEs
        ? `${text} Este es el problema o la limitación que el material intenta resolver. Entender bien esta dificultad es clave, porque la solución solo tiene sentido cuando sabes qué faltaba explicar antes. Pregúntate siempre: ¿qué no se podía entender todavía y por qué eso era importante?`
        : `${text} This is the problem or limitation the material is trying to solve. The solution only makes sense when you understand what could not be explained before.`;
    } else if (kind === 'solution') {
      explicacion = isEs
        ? `${text} Aquí aparece la idea principal que responde al problema central del tema. No la estudies como una frase aislada: piensa qué cambió gracias a esta idea, qué permite explicar y por qué representa un avance respecto a lo anterior. Si puedes decir eso con tus palabras, ya entendiste el corazón del material.`
        : `${text} Here appears the main idea that answers the central problem of the topic. Do not study it as an isolated phrase: think about what changed because of this idea and what it now allows us to explain.`;
    } else if (kind === 'process') {
      explicacion = isEs
        ? `${text} Este proceso debe entenderse en orden. Primero identifica qué ocurre al inicio, luego qué mecanismo produce el cambio, y finalmente qué resultado aparece. Cuando puedes narrar esa secuencia de principio a fin sin mirar el texto, ya no estás memorizando: realmente estás entendiendo cómo funciona el tema.`
        : `${text} This process must be understood in order. First identify what happens at the beginning, then what mechanism produces the change, and finally what result appears.`;
    } else if (kind === 'formula') {
      explicacion = explainFormula(item);
    } else {
      explicacion = isEs
        ? `${text} Esta parte muestra por qué el tema importa. Aquí debes fijarte en la consecuencia, el impacto o la aplicación de lo que se explicó antes. Esto es lo que más suelen evaluar en una prueba oral o escrita: no repetir el dato, sino explicar por qué cambia la comprensión del tema y qué aporta.`
        : `${text} This part shows why the topic matters. Focus on the consequence, impact or application of what was explained before.`;
    }

    return {
      titulo: title,
      explicacion: formatStudyText(explicacion),
      ejemplo: shortExplain(item, 220),
      checkpoint: isEs
        ? `Explícalo sin mirar: ¿cuál es la idea central de esta parte y cómo se conecta con el resto?`
        : `Explain it without looking: what is the central idea and how does it connect?`,
    };
  };

  const kinds: Array<'context' | 'problem' | 'solution' | 'process' | 'formula' | 'impact'> = [
    'context',
    'problem',
    'solution',
    'process',
    'process',
    'process',
    'process',
    formulaItem ? 'formula' : 'process',
    formulaItem ? 'formula' : 'impact',
    formulaItem ? 'formula' : 'impact',
    'impact',
    'impact',
    'impact',
    'impact',
  ];

  let clase_narrativa = chapterItems.map((item: string, i: number) => {
    const kind = kinds[i] || 'impact';
    const c = chapter(kind, item, i);
    // Título dinámico basado en el contenido real
    const dynamicTitle = titleFromItem(item, c.titulo);
    const prefix = kind === 'context' ? 'Contexto: '
      : kind === 'problem' ? 'Problema: '
      : kind === 'solution' ? 'Solución: '
      : kind === 'process' ? 'Proceso: '
      : kind === 'formula' ? 'Fórmula: '
      : 'Importancia: ';
    return {
      ...c,
      titulo: i === 0 ? c.titulo : `${prefix}${dynamicTitle.slice(0, 60)}`,
    };
  });

  clase_narrativa = dedupeNarrativeSections(
    clase_narrativa.filter((c: any) => goodText(c.titulo, 4) && goodText(c.explicacion, 80)),
  ).slice(0, 6);

  const cobertura_material = uniqueByText(
    base
      .filter((x: string) => !bioRe.test(x))
      .slice(0, 14)
      .map((x: string) => ({
        elemento: titleFromItem(x, x),
        por_que_importa: shortExplain(x, 260),
      })),
    (x: any) => `${x.elemento} ${x.por_que_importa}`,
  );

  const conexiones_clave = uniqueByText(
    relaciones.slice(0, 4).map((x: string) => ({
      titulo: titleFromItem(x, isEs ? 'Conexión clave' : 'Key connection'),
      explicacion: shortExplain(x, 360),
    })),
    (x: any) => `${x.titulo} ${x.explicacion}`,
  );

  const errores_comunes = uniqueByText(
    confusiones.slice(0, 4).map((x: string) => ({
      error: titleFromItem(x, isEs ? 'Confusión común' : 'Common confusion'),
      correccion: shortExplain(x, 260),
      mini_ejemplo: shortExplain(x, 160),
    })),
    (x: any) => `${x.error} ${x.correccion}`,
  );

  const preguntas_profesor = uniqueByText(
    preguntas.slice(0, 6).map((x: string) => {
      const [pregunta, respuesta] = x.split(/Respuesta esperada:/i);
      return {
        pregunta: goodText(pregunta, 10) || x,
        que_evalua: isEs ? 'Comprensión real: problema, explicación y consecuencia' : 'Real understanding: problem, explanation and consequence',
        respuesta_esperada: goodText(respuesta, 20) || shortExplain(x, 280),
      };
    }),
    (x: any) => x.pregunta,
  );

  const para_examen = uniqueByText(
    [
      problemItem,
      solutionItem,
      processItem,
      formulaItem,
      impactItem,
      ...base.filter((x: string) => !bioRe.test(x)),
    ]
      .filter((x: string) => goodText(x, 20))
      .map((x: string) => ({
        punto: titleFromItem(x, x),
        por_que: shortExplain(x, 260),
      })),
    (x: any) => x.punto,
  ).slice(0, 8);

  // ── Textos dinámicos basados en el contenido real extraído ──
  const temasTxt = (compact.temas || []).slice(0, 2).map((t: string) => shortExplain(t, 180)).filter(Boolean).join('. ');
  const causas = uniqueStrings(compact.causas || []);
  const ejemplos = uniqueStrings(compact.ejemplos || []);

  const si_no_sabes_nada = (() => {
    const partes: string[] = [];
    if (temasTxt) partes.push(`El tema central de este material es: ${temasTxt}.`);
    if (ideas[0]) partes.push(`La primera idea clave que debes entender es: ${shortExplain(ideas[0], 240)}.`);
    if (procesos[0]) partes.push(`Un proceso importante que aparece es: ${shortExplain(procesos[0], 220)}.`);
    if (formulas[0]) partes.push(`También aparece esta fórmula o relación: ${shortExplain(formulas[0], 180)}.`);
    partes.push(isEs
      ? 'Antes de memorizar cualquier dato, pregúntate: ¿qué problema intenta resolver este material? Cuando tienes esa respuesta, el resto del contenido empieza a organizarse solo.'
      : 'Before memorizing anything, ask yourself: what problem does this material solve? When you have that answer, everything else starts to make sense.');
    return partes.join(' ');
  })();

  const mapa_inicial = (() => {
    const pasos: string[] = [];
    if (contextItem) pasos.push(`Tema: ${shortExplain(contextItem, 160)}`);
    if (problemItem && problemItem !== contextItem) pasos.push(`Problema: ${shortExplain(problemItem, 160)}`);
    if (solutionItem && solutionItem !== problemItem) pasos.push(`Solución: ${shortExplain(solutionItem, 160)}`);
    if (processItem && processItem !== solutionItem) pasos.push(`Proceso: ${shortExplain(processItem, 160)}`);
    if (formulaItem) pasos.push(`Fórmula: ${shortExplain(formulaItem, 140)}`);
    if (impactItem && impactItem !== processItem) pasos.push(`Importancia: ${shortExplain(impactItem, 140)}`);
    const cadena = pasos.length ? pasos.join(' → ') : (all.slice(0, 4).map((x: string) => shortExplain(x, 120)).join(' → '));
    return isEs
      ? `El mapa del material es: ${cadena}. Estudia en ese orden para que cada parte tenga sentido antes de pasar a la siguiente.`
      : `The material map is: ${cadena}. Study in that order so each part makes sense before moving to the next.`;
  })();

  const panorama_completo = (() => {
    const p0 = all[0] ? shortExplain(all[0], 220) : '';
    const p1 = all[1] ? shortExplain(all[1], 200) : '';
    const p2 = procesos[0] ? shortExplain(procesos[0], 200) : '';
    const c0 = causas[0] ? shortExplain(causas[0], 180) : '';
    const r0 = relaciones[0] ? shortExplain(relaciones[0], 180) : '';
    return isEs
      ? `Para unir todo el material: ${p0 ? `Comienza con ${p0}.` : ''} ${p1 ? `Luego: ${p1}.` : ''} ${p2 ? `El proceso principal es: ${p2}.` : ''} ${c0 ? `La causa y consecuencia más importante: ${c0}.` : ''} ${r0 ? `La conexión clave entre conceptos: ${r0}.` : ''} Si puedes narrar esa secuencia con tus propias palabras sin mirar el documento, entendiste el material de verdad.`.replace(/\s+/g, ' ').trim()
      : `To connect the whole material: ${p0 ? `Start with ${p0}.` : ''} ${p1 ? `Then: ${p1}.` : ''} ${p2 ? `The main process is: ${p2}.` : ''} ${c0 ? `The most important cause and effect: ${c0}.` : ''} ${r0 ? `The key connection: ${r0}.` : ''} If you can narrate that sequence in your own words, you truly understood the material.`.replace(/\s+/g, ' ').trim();
  })();

  const resumen_final = (() => {
    const puntos = para_examen.slice(0, 3).map((x: any) => x.punto).filter(Boolean);
    const f0 = formulas[0] ? shortExplain(formulas[0], 160) : '';
    const p0 = procesos[0] ? shortExplain(procesos[0], 160) : '';
    return isEs
      ? `Para dominar este material: ${puntos.length ? `Los puntos clave son: ${puntos.join('; ')}.` : ''} ${p0 ? `El proceso central es: ${p0}.` : ''} ${f0 ? `La fórmula o relación principal es: ${f0}.` : ''} Si puedes explicar todo eso con tus propias palabras sin mirar el documento, aprendiste el tema.`.replace(/\s+/g, ' ').trim()
      : `To master this material: ${puntos.length ? `Key points are: ${puntos.join('; ')}.` : ''} ${p0 ? `The central process is: ${p0}.` : ''} ${f0 ? `The main formula or relationship is: ${f0}.` : ''} If you can explain all that in your own words, you learned the topic.`.replace(/\s+/g, ' ').trim();
  })();

  return {
    titulo: ok(cA.titulo, 3) ? formatStudyText(cA.titulo) : (isEs ? 'Profesor ALAI' : 'Professor ALAI'),
    objetivos: [
      isEs ? 'Identificar el tema principal del material' : 'Identify the main topic',
      isEs ? 'Entender el problema o pregunta central' : 'Understand the central problem or question',
      isEs ? 'Explicar la idea principal con tus palabras' : 'Explain the main idea in your own words',
      isEs ? 'Conectar conceptos, fórmulas y consecuencias' : 'Connect concepts, formulas and consequences',
    ],
    si_no_sabes_nada,
    mapa_inicial,
    cobertura_material,
    clase_narrativa,
    panorama_completo,
    conexiones_clave,
    errores_comunes,
    preguntas_profesor,
    para_examen,
    ya_puedes_explicar: para_examen.map((x: any) => x.punto).slice(0, 6),
    resumen_final_profesor: resumen_final,
    preguntas_sugeridas: preguntas_profesor.map((x: any) => x.pregunta).slice(0, 5),
    preguntale_alai: isEs ? 'Puedes preguntarme cualquier duda sobre este material.' : 'You can ask me anything about this material.',
    idioma: detectedLang,
    docNames,
    coverage: {
      detected: all.length,
      taught: Math.min(all.length, clase_narrativa.length * 4),
      percent: all.length ? Math.min(100, Math.round((Math.min(all.length, clase_narrativa.length * 4) / all.length) * 100)) : 0,
    },

    historia_completa: panorama_completo,
    clases: clase_narrativa.map((c: any) => ({
      titulo: c.titulo,
      idea_central: c.explicacion.slice(0, 220),
      explicacion: c.explicacion,
      ejemplo_guiado: c.ejemplo,
      pregunta_reflexion: c.checkpoint,
    })),
    vocabulario_base: cobertura_material.map((x: any) => ({
      termino: x.elemento,
      explicacion: x.por_que_importa,
      por_que_aparece: x.por_que_importa,
    })),
    comprobacion: preguntas_profesor,
    desde_cero: [si_no_sabes_nada, mapa_inicial],
    ensenanza_guiada: clase_narrativa.map((c: any) => ({
      concepto: c.titulo,
      explicacion_simple: c.explicacion.slice(0, 220),
      explicacion_profunda: c.explicacion,
      ejemplo: c.ejemplo,
      por_que_importa: c.checkpoint,
    })),
    conexiones: conexiones_clave,
    confusiones: errores_comunes.map((e: any) => ({
      error: e.error,
      correccion: e.correccion,
      truco: e.mini_ejemplo,
    })),
    examen: para_examen.map((x: any) => x.punto),
    resumen_30s: resumen_final,
    vision_general: [si_no_sabes_nada, mapa_inicial],
    conceptos: clase_narrativa.map((c: any) => ({
      nombre: c.titulo,
      definicion_simple: c.explicacion.slice(0, 220),
      definicion_tecnica: c.explicacion,
      por_que_importa: c.checkpoint,
      ejemplo_concreto: c.ejemplo,
    })),
    resumen_final: para_examen.map((x: any) => x.punto),
    autoevaluacion: preguntas_profesor,
    ejemplos: [],
    analogias: [],
    aplicacion_real: [],
  };
}


// ── Postprocesador: elimina conceptos secundarios del output de síntesis ──
const SECONDARY_RX = /\b(copenhague|copenhagen|interpretaci[oó]n de copenhague|superposici[oó]n|colapso de la funci[oó]n|funci[oó]n de onda|entrelazamiento|dualidad onda|medici[oó]n cu[aá]ntica|muchos mundos|many worlds|probabilidad cu[aá]ntica|naturaleza probabil[ií]stica|semiconductores|semiconductor|transistores|transistor|tecnolog[ií]as modernas|l[aá]seres|laser|computaci[oó]n cu[aá]ntica)\b/i;

function cleanSecondary(text: string): string {
  if (!text || !SECONDARY_RX.test(text)) return text;
  // Si toda la oración gira alrededor de conceptos secundarios, eliminarla
  const sentences = text.split(/(?<=[.!?])\s+/);
  const clean = sentences.filter(s => {
    const words = s.split(/\s+/).length;
    const matches = (s.match(SECONDARY_RX) || []).length;
    // Si más del 30% de las ideas son secundarias, eliminar la oración
    return matches === 0 || (matches / words) < 0.15;
  });
  return clean.join(' ').trim() || text;
}

// Títulos expansivos que indican secciones fuera del objetivo pedagógico
const EXPANSIVE_TITLES_RX = /\b(nueva era|new era|evoluci[oó]n.*cient[ií]f|transformaci[oó]n.*conocimiento|implicaciones.*filos[oó]f|impacto.*tecnol[oó]g.*moderno|herencia.*cient[ií]f|legado.*hist[oó]r|avance.*humanidad|cambio.*paradigma|redefinici[oó]n.*realidad|impacto.*global)\b/i;

function cleanSecondaryFromAnalisis(analisis: any): any {
  if (!analisis) return analisis;

  // Limpiar clase_narrativa: eliminar partes con título secundario o expansivo
  if (Array.isArray(analisis.clase_narrativa)) {
    analisis.clase_narrativa = analisis.clase_narrativa.filter((c: any) => {
      const titulo = c.titulo || '';
      if (SECONDARY_RX.test(titulo)) return false;
      if (EXPANSIVE_TITLES_RX.test(titulo)) return false;
      return true;
    }).map((c: any) => ({
      ...c,
      explicacion: cleanSecondary(c.explicacion || ''),
      checkpoint: (SECONDARY_RX.test(c.checkpoint || '') || EXPANSIVE_TITLES_RX.test(c.checkpoint || ''))
        ? '¿Cómo se conecta esta idea con el problema central y la evidencia experimental?'
        : c.checkpoint,
    }));
  }

  // Limpiar preguntas_profesor
  if (Array.isArray(analisis.preguntas_profesor)) {
    analisis.preguntas_profesor = analisis.preguntas_profesor.filter((q: any) =>
      !SECONDARY_RX.test(q.pregunta || '') && !EXPANSIVE_TITLES_RX.test(q.pregunta || '')
    );
  }

  // Limpiar para_examen
  if (Array.isArray(analisis.para_examen)) {
    analisis.para_examen = analisis.para_examen.filter((x: any) =>
      !SECONDARY_RX.test(x.punto || '') && !EXPANSIVE_TITLES_RX.test(x.punto || '')
    );
  }

  // Limpiar resumen_final_profesor: solo oraciones sobre el mecanismo central
  if (analisis.resumen_final_profesor) {
    analisis.resumen_final_profesor = cleanSecondary(analisis.resumen_final_profesor);
  }

  // Limpiar panorama_completo
  if (analisis.panorama_completo) {
    analisis.panorama_completo = cleanSecondary(analisis.panorama_completo);
  }

  // Limpiar ya_puedes_explicar
  if (Array.isArray(analisis.ya_puedes_explicar)) {
    analisis.ya_puedes_explicar = analisis.ya_puedes_explicar.filter((x: string) =>
      !SECONDARY_RX.test(x) && !EXPANSIVE_TITLES_RX.test(x)
    );
  }

  return analisis;
}

function buildAnalisisFromParts({ cA, cB, lang, detectedLang, docNames }: any) {
  // Siempre priorizar la síntesis estructurada de la IA
  // makeHumanTeachingLesson solo se usa si la síntesis viene completamente vacía
  const hasAnyContent =
    Array.isArray(cA?.clase_narrativa) && cA.clase_narrativa.length >= 1;

  if (!hasAnyContent) {
    const humanLesson = makeHumanTeachingLesson({ cA, cB, lang, detectedLang, docNames });
    if (humanLesson) return humanLesson;
  }

  const objetivos = Array.isArray(cA.objetivos)
    ? cA.objetivos.map((s: any) => goodText(s, 8)).filter(Boolean).slice(0, 5)
    : [];

  
const BIOGRAPHY_RE = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|university|premio nobel|nobel prize|copenhagen|dinamarca)\b/i;

const cobertura_material = uniqueByText(
    (cA.cobertura_material || [])
      .map((x: any) => ({
        elemento: goodText(x?.elemento, 2),
        por_que_importa: goodText(x?.por_que_importa, 8),
      }))
      .filter((x: any) => x.elemento && x.por_que_importa),
    (x: any) => `${x.elemento} ${x.por_que_importa}`,
  ).slice(0, 12);

  // Obtener clase_narrativa de la síntesis IA
  let clase_narrativa_raw = dedupeNarrativeSections(uniqueByText(
    (cA.clase_narrativa || [])
      .map((c: any) => ({
        titulo: goodText(c?.titulo, 3).replace(/^Parte\s*\d+:\s*Parte\s*\d+:\s*/i, 'Parte ').replace(/^Parte\s*\d+:\s*/i, ''),
        explicacion: goodText(c?.explicacion, 80),
        ejemplo: goodText(c?.ejemplo, 10),
        checkpoint: goodText(c?.checkpoint, 10),
      }))
      .filter((c: any) => c.titulo && c.explicacion)
      .filter((c: any, idx: number) => {
        if (idx < 2) return true;
        return !BIOGRAPHY_RE.test(String(c.titulo + ' ' + c.explicacion));
      }),
    (c: any) => `${c.titulo} ${c.explicacion.slice(0, 120)}`,
  )).slice(0, 14);

  // Detectar si la síntesis IA es genérica/mala
  const isGenericSynth = (parts: any[]): boolean => {
    if (parts.length < 3) return true;
    const genericPhrases = [
      'el concepto de', 'el dato de', 'el proceso de', 'la persona de',
      'el síntoma de', 'el mecanismo de', 'es importante porque',
      'se basa en la idea de que los objetos',
      'fue desarrollado por niels bohr y otros',
    ];
    const allText = parts.map((p: any) => (p.explicacion || '').toLowerCase()).join(' ');
    const genericCount = genericPhrases.filter(p => allText.includes(p)).length;
    return genericCount >= 3;
  };

  // Si la síntesis es genérica, construir clase desde compact extraído
  let clase_narrativa: any[];
  if (isGenericSynth(clase_narrativa_raw) && cA.__compact) {
    const comp = cA.__compact;
    const isEs = detectedLang === 'es';
    const allItems = [
      ...(comp.procesos || []),
      ...(comp.ideas || []).filter((x: string) => !/\b(naci[oó]|familia|ciudad)\b/i.test(x)),
      ...(comp.relaciones || []),
      ...(comp.causas || []),
      ...(comp.formulas || []),
      ...(comp.datos || []).filter((x: string) => !/\b(naci[oó]|familia)\b/i.test(x)),
      ...(comp.noOmitir || []).filter((x: string) => !/\b(naci[oó]|familia)\b/i.test(x)),
    ].filter((x: string) => typeof x === 'string' && x.length > 30);

    const uniqueItems = uniqueByText<string>(allItems, (x: string) => x.toLowerCase().slice(0, 60)).slice(0, 14);

    const buildExplicacion = (item: string, idx: number): string => {
      return shortExplain(item, 600); // 0 relleno, solo la información real extraída
    };

    clase_narrativa = uniqueItems.map((item: string, i: number) => ({
      titulo: i === 0
        ? (isEs ? 'De qué trata este material' : 'What this material is about')
        : titleFromItem(item, isEs ? `Parte ${i + 1}` : `Part ${i + 1}`),
      explicacion: buildExplicacion(item, i),
      ejemplo: shortExplain(item, 220),
      checkpoint: isEs
        ? '¿Puedes explicar esta idea con tus propias palabras sin mirar el texto?'
        : 'Can you explain this idea in your own words without looking at the text?',
    }));

    console.log(`🔧 Clase narrativa reconstruida desde compact: ${clase_narrativa.length} partes`);
  } else {
    clase_narrativa = clase_narrativa_raw;
  }

  const conexiones_clave = uniqueByText(
    (cB.conexiones_clave || [])
      .map((c: any) => ({
        titulo: goodText(c?.titulo, 3),
        explicacion: goodText(c?.explicacion, 20),
      }))
      .filter((c: any) => c.titulo && c.explicacion)
      .filter((c: any, idx: number) => {
        if (idx < 2) return true;
        return !BIOGRAPHY_RE.test(String(c.titulo + ' ' + c.explicacion));
      }),
    (c: any) => `${c.titulo} ${c.explicacion}`,
  ).slice(0, 5);

  const errores_comunes = uniqueByText(
    (cB.errores_comunes || [])
      .map((e: any) => ({
        error: goodText(e?.error, 8),
        correccion: goodText(e?.correccion, 8),
        mini_ejemplo: goodText(e?.mini_ejemplo, 8),
      }))
      .filter((e: any) => e.error && e.correccion),
    (e: any) => `${e.error} ${e.correccion}`,
  ).slice(0, 4);

  const preguntas_profesor = uniqueByText(
    (cB.preguntas_profesor || cB.comprobacion || [])
      .map((q: any) => ({
        pregunta: goodText(q?.pregunta, 8),
        que_evalua: goodText(q?.que_evalua, 8),
        respuesta_esperada: goodText(q?.respuesta_esperada, 20),
      }))
      .filter((q: any) => q.pregunta && q.respuesta_esperada),
    (q: any) => q.pregunta,
  ).slice(0, 8);

  const para_examen = uniqueByText(
    (cB.para_examen || [])
      .map((x: any) => ({
        punto: goodText(x?.punto, 8),
        por_que: goodText(x?.por_que, 8),
      }))
      .filter((x: any) => x.punto),
    (x: any) => x.punto,
  ).slice(0, 10);

  const ya_puedes_explicar = Array.isArray(cB.ya_puedes_explicar)
    ? uniqueByText<string>(cB.ya_puedes_explicar.map((s: any) => goodText(s, 8)).filter(Boolean) as string[], (x: string) => x).slice(0, 8)
    : [];

  const preguntas_sugeridas = Array.isArray(cB.preguntas_sugeridas)
    ? uniqueByText<string>(cB.preguntas_sugeridas.map((q: any) => goodText(q, 8)).filter(Boolean) as string[], (x: string) => x).slice(0, 5)
    : [];

  
  // La interpretación de fórmula ya viene incluida en el prompt de M2

const analisis = {
      titulo: ok(cA.titulo, 3) ? formatStudyText(cA.titulo) : (lang === 'es' ? 'Profesor ALAI' : 'Professor ALAI'),
      objetivos,
      si_no_sabes_nada: ok(cA.si_no_sabes_nada, 40) ? formatStudyText(cA.si_no_sabes_nada) : '',
      mapa_inicial: ok(cA.mapa_inicial, 30) ? formatStudyText(cA.mapa_inicial) : '',
      cobertura_material,
      clase_narrativa,
      panorama_completo: ok(cB.panorama_completo, 40) ? formatStudyText(cB.panorama_completo) : '',
      conexiones_clave,
      errores_comunes,
      preguntas_profesor,
      para_examen,
      ya_puedes_explicar,
      resumen_final_profesor: ok(cB.resumen_final, 30) ? formatStudyText(cB.resumen_final) : '',
      preguntas_sugeridas,
      preguntale_alai: ok(cB.preguntale_alai, 8)
        ? formatStudyText(cB.preguntale_alai)
        : (lang === 'es'
          ? 'Puedes preguntarme cualquier duda sobre este material.'
          : 'You can ask me any question about this material.'),
      idioma: detectedLang,
      docNames,
      coverage: {
        detected: cobertura_material.length,
        taught: cobertura_material.filter((item: any) =>
          clase_narrativa.some((c: any) =>
            c.explicacion.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24))
            || c.titulo.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24)),
          ),
        ).length,
        percent: cobertura_material.length
          ? Math.round((cobertura_material.filter((item: any) =>
              clase_narrativa.some((c: any) =>
                c.explicacion.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24))
                || c.titulo.toLowerCase().includes(String(item.elemento).toLowerCase().slice(0, 24)),
              ),
            ).length / cobertura_material.length) * 100)
          : 0,
      },

      historia_completa: ok(cB.panorama_completo, 40) ? formatStudyText(cB.panorama_completo) : '',
      clases: clase_narrativa.map((c: any) => ({
        titulo: c.titulo,
        idea_central: c.explicacion.slice(0, 220),
        explicacion: c.explicacion,
        ejemplo_guiado: c.ejemplo,
        pregunta_reflexion: c.checkpoint,
    })),
      vocabulario_base: cobertura_material.map((x: any) => ({
        termino: x.elemento,
        explicacion: x.por_que_importa,
        por_que_aparece: x.por_que_importa,
    })),
      comprobacion: preguntas_profesor,
      desde_cero: [String(cA.si_no_sabes_nada || ''), String(cA.mapa_inicial || '')].filter(Boolean),
      ensenanza_guiada: clase_narrativa.map((c: any) => ({
        concepto: c.titulo,
        explicacion_simple: c.explicacion.slice(0, 220),
        explicacion_profunda: c.explicacion,
        ejemplo: c.ejemplo,
        por_que_importa: c.checkpoint,
    })),
      conexiones: conexiones_clave,
      confusiones: errores_comunes.map((e: any) => ({
        error: e.error,
        correccion: e.correccion,
        truco: e.mini_ejemplo,
    })),
      examen: para_examen.map((x: any) => x.punto),
      resumen_30s: ok(cB.resumen_final, 30) ? formatStudyText(cB.resumen_final) : '',
      vision_general: [String(cA.si_no_sabes_nada || ''), String(cA.mapa_inicial || '')].filter(Boolean),
      conceptos: clase_narrativa.map((c: any) => ({
        nombre: c.titulo,
        definicion_simple: c.explicacion.slice(0, 220),
        definicion_tecnica: c.explicacion,
        por_que_importa: c.checkpoint,
        ejemplo_concreto: c.ejemplo,
    })),
      resumen_final: para_examen.map((x: any) => x.punto),
      autoevaluacion: preguntas_profesor,
      ejemplos: [],
      analogias: [],
      aplicacion_real: [],
    };

  return cleanSecondaryFromAnalisis(analisis);
}


// ── Handler ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ─── Auth NextAuth (opcional pero recomendado) ───
    let userId: string | null = null;
    try {
      const session = await __routeDeps.getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {}

    // ─── Body ───
    const body = await req.json();

    // ─── MODO BLUEPRINT — análisis estructural del material ───
    // Se usa en modo adaptativo para entender el material completo
    // antes de construir el programa. Sin relación con Free Analysis —
    // no tocado por la migración a Material Brain.
    if (body?.mode === 'blueprint_analysis' && body?.blueprintPrompt) {
      try {
        const bpResult = await safeAlaiJson(String(body.blueprintPrompt), 6000);
        return NextResponse.json({
          success: true,
          blueprint: JSON.stringify(bpResult),
          blueprintRaw: JSON.stringify(bpResult),
          analisis: bpResult,
          fromBlueprintMode: true,
        });
      } catch (bpErr: any) {
        console.error('[blueprint_analysis] error:', bpErr?.message || bpErr);
        return NextResponse.json(
          { success: false, error: bpErr?.message || 'Error generando blueprint.' },
          { status: 500 }
        );
      }
    }

    // ─── STUDYALMATERIALENJOYER GROUNDED PATH — Free Mode Análisis Teórico ───
    // AnalisisTeorico.tsx sends { sessionId, nivel, ... } and no
    // `documentos`. Autoridad académica: SOLO el StudyalMaterialEnjoyer
    // persistido, resuelto server-side por fingerprint exacto, nunca
    // texto crudo del cliente.
    if (typeof body?.sessionId === 'string' && body.sessionId) {
      if (RAW_SOURCE_AUTHORITY_KEYS.some(key => Object.prototype.hasOwnProperty.call(body, key))) {
        return groundedErrorResponse('INVALID_CONFIG', 400, 'RAW_SOURCE_AUTHORITY_FORBIDDEN');
      }
      if (!userId) return groundedErrorResponse('UNAUTHORIZED', 401);
      const nivel = ['secundaria', 'universidad', 'medicina', 'doctorado'].includes(body.nivel) ? body.nivel : 'universidad';
      return await handleGroundedAnalysisRequest(
        body.sessionId, userId, nivel,
        String(body.materia || '').trim(), String(body.tema || '').trim(), body.masteryContext || null,
        body.format === ANALYSIS_STUDY_NOTES_VERSION, body.upgrade === true,
      );
    }

    const { documentos, idioma, materialId, nivel, masteryContext } = body as {
      documentos: {
        id: string;
        nombre: string;
        contenido: string;
        tipo: string;
      }[];
      idioma?: 'es' | 'en';
      materialId?: string;
      nivel?: 'secundaria' | 'universidad' | 'medicina' | 'doctorado';
      masteryContext?: any;
    };
    const nivelEstudio = nivel || 'universidad';

    if (!documentos?.length) {
      return NextResponse.json(
        { error: 'No se enviaron documentos' },
        { status: 400 },
      );
    }

    // ─── Cache por material/selección ───
    if (materialId && userId) {
      const cached = await getMaterialResult(materialId, 'teorico', 'analysis')
        .catch(() => null);
      if (cached?.payload) {
        const p = cached.payload;
        // Validar que el cache no sea un análisis genérico o vacío
        const claseOk = Array.isArray(p?.clase_narrativa) && p.clase_narrativa.length >= 3;
        const coberturaOk = Array.isArray(p?.cobertura_material) && p.cobertura_material.length >= 4;
        const siNoSabeOk = typeof p?.si_no_sabes_nada === 'string' && p.si_no_sabes_nada.length >= 80;
        const notGeneric = !String(p?.si_no_sabes_nada || '').includes('este material no es una lista de datos, es una explicación. Primero identifica el tema principal');
        if (claseOk && coberturaOk && siNoSabeOk && notGeneric) {
          console.log(`🚀 Cache HIT análisis válido → ${materialId}`);
          return NextResponse.json({
            success: true,
            analisis: p,
            fromCache: true,
          });
        }
        console.log(`♻️ Cache INVALIDADO análisis genérico → ${materialId}`);
      }
    }

    // ─── Preparar documentos legibles ───
    const validDocs = documentos
      .map((doc) => ({
        id: doc.id,
        nombre: String(doc.nombre || 'Material').trim(),
        contenido: String(doc.contenido || '').trim(),
        tipo: doc.tipo || '',
      }))
      .filter((doc) => doc.contenido.length >= 50);

    if (!validDocs.length) {
      return NextResponse.json(
        { error: 'Los documentos no tienen contenido legible. Asegurate de que el texto fue extraído correctamente.' },
        { status: 400 },
      );
    }

    const allTextForLang = validDocs.map((d) => d.contenido.slice(0, 6000)).join('\n\n');
    const lang: 'es' | 'en' = idioma === 'en' ? 'en' : 'es';
    const detectedLang = detectContentLanguage(allTextForLang, lang) as 'es' | 'en';
    const docNames = validDocs.map((d) => d.nombre);

    const nivelDesc: Record<string, string> = {
      secundaria: 'Secundaria: usa analogías simples, evita tecnicismos, vocabulario básico, ejemplos de la vida cotidiana',
      universidad: 'Universidad: nivel estándar universitario, conceptos completos con terminología técnica básica',
      medicina: 'Medicina/Ciencias avanzadas: terminología técnica completa, mecanismos moleculares detallados, relevancia clínica o científica',
      doctorado: 'Posgrado/Doctorado: máxima profundidad conceptual, mecanismos avanzados, conexiones con literatura especializada',
    };
    const nivelInstruccion = nivelDesc[nivelEstudio] || nivelDesc['universidad'];

    console.log(
      `🧠 Analizando jerárquico: ${validDocs.length} material(es), ${validDocs.reduce((a, d) => a + d.contenido.length, 0)} chars, lang=${detectedLang}, nivel=${nivelEstudio}`,
    );

    // ─── 1) Extraer conocimiento por chunks de cada material ───
    const materialAnalyses: any[] = [];

    for (const doc of validDocs) {
      const chunks = splitIntoChunks(doc.contenido, 4500);
      console.log(`📚 ${doc.nombre}: ${chunks.length} chunk(s)`);

      const extracted: any[] = [];
      const PARALLEL = 2;

      for (let start = 0; start < chunks.length; start += PARALLEL) {
        const batch = chunks.slice(start, start + PARALLEL);

        const results = await Promise.all(
          batch.map(async (chunk, idx) => {
            const chunkIndex = start + idx;
            const raw = await safeAlaiJson(
              extractPrompt(detectedLang, doc.nombre, chunkIndex, chunks.length, chunk),
              5200,
            );
            if (!raw) {
              console.warn(`⚠️ Extract inválido omitido: ${doc.nombre} chunk ${chunkIndex + 1}/${chunks.length}`);
              return null;
            }
            return cleanDeep(raw);
          }),
        );

        extracted.push(...results.filter(Boolean));
        console.log(`🧩 ${doc.nombre}: extraídos ${Math.min(start + PARALLEL, chunks.length)}/${chunks.length}`);
      }

      const compact = compactExtractedKnowledge(extracted);
      console.log(
        `📊 Extract ${doc.nombre}: ideas=${compact.ideas.length}, vocab=${compact.vocabulario.length}, procesos=${compact.procesos.length}, formulas=${compact.formulas.length}, relaciones=${compact.relaciones.length}, datos=${compact.datos.length}, noOmitir=${compact.noOmitir.length}`,
      );
      console.log(
        `🔎 Compact sample ${doc.nombre}:`,
        JSON.stringify({
          ideas: compact.ideas.slice(0, 8),
          procesos: compact.procesos.slice(0, 5),
          formulas: compact.formulas.slice(0, 5),
          relaciones: compact.relaciones.slice(0, 5),
          noOmitir: compact.noOmitir.slice(0, 10),
          preguntas: compact.preguntas.slice(0, 5),
        }, null, 2),
      );

      // ─── 2) Síntesis en micro-llamadas enfocadas ───
      const isEs = detectedLang === 'es';
      const es = isEs;
      const bioRx = /\b(naci[oó]|nacimiento|familia|ciudad|universidad|infancia)\b/i;

      // Sin límites fijos - cada material tiene su propio volumen de contenido
      const secundarioRxR = /\b(copenhague|copenhagen|nobel|instituto|institute|wwii|guerra|world war|semiconduct|láser|laser|transistor|computad|entrelazamiento|superposici|dualidad onda|energía nuclear|nuclear energy)\b/i;
      const secundarioRx = /\b(copenhague|copenhagen|nobel|instituto|institute|wwii|guerra mundial|world war|semiconduct|láser|laser|transistor|computad|entrelazamiento|superposici|dualidad onda)\b/i;

      const procData = compact.procesos.join('\n');
      const ideaData = compact.ideas.filter((x: string) => !bioRx.test(x)).join('\n');
      const formulaData = compact.formulas.join('\n');
      const relacionData = compact.relaciones.filter((x: string) => !secundarioRxR.test(x)).join('\n');
      const noOmitData = compact.noOmitir.filter((x: string) => !bioRx.test(x)).join('\n');
      const confData = compact.confusiones.filter((x: string) => !secundarioRx.test(x)).join('\n');
      const pregData = compact.preguntas.filter((x: string) => !secundarioRx.test(x)).join('\n');

      // Cobertura real del material
      const totalConceptos = compact.ideas.length + compact.procesos.length + compact.formulas.length;
      console.log('📊 Cobertura 100%: ' + compact.procesos.length + ' procesos, ' + compact.ideas.length + ' ideas, ' + compact.formulas.length + ' fórmulas');

      const mkP = (tarea: string, datos: string, schema: string) =>
        tarea + '\n\nDATOS:\n' + datos + '\n\nDevuelve SOLO JSON válido:\n' + schema;

      const mkE = (task: string, data: string, schema: string) =>
        task + '\n\nDATA:\n' + data + '\n\nReturn ONLY valid JSON:\n' + schema;

      // Bloque adaptativo basado en masteryContext
      const masteryBlock = masteryContext ? [
        '',
        'PERFIL DEL ESTUDIANTE (adapta la clase a este perfil):',
        'Dominio actual: ' + (masteryContext.overallMastery ?? 0) + '%',
        'Comprension: ' + (masteryContext.understanding ?? 0) + '% | Memoria: ' + (masteryContext.memory ?? 0) + '%',
        masteryContext.criticalConcepts?.length
          ? 'CONCEPTOS CRITICOS que DEBE dominar (< 20%): ' + masteryContext.criticalConcepts.join(', ')
          : '',
        masteryContext.weakConcepts?.length
          ? 'CONCEPTOS DEBILES (< 40%) - enfoca aqui: ' + masteryContext.weakConcepts.join(', ')
          : '',
        masteryContext.strongConcepts?.length
          ? 'YA DOMINADOS - no repetir basico: ' + masteryContext.strongConcepts.join(', ')
          : '',
        masteryContext.repeatedMistakes?.length
          ? 'ERRORES REPETIDOS - corregir explicitamente: ' + masteryContext.repeatedMistakes.join(', ')
          : '',
        masteryContext.studentProfile === 'beginner'
          ? 'NIVEL: Principiante. Explica desde cero, usa analogias simples.'
          : masteryContext.studentProfile === 'memorizer'
          ? 'NIVEL: Memoriza pero no conecta. Enfoca en relaciones causales.'
          : masteryContext.studentProfile === 'advanced'
          ? 'NIVEL: Avanzado. Sube dificultad, integra conceptos, usa casos complejos.'
          : '',
        '',
      ].filter(Boolean).join('\n') : '';

      // Bloque adaptativo basado en masteryContext

      // M0: clasificar tipo de material para elegir estructura pedagógica correcta
      const m0 = await safeAlaiJson(es
        ? mkP(
            'Eres un clasificador pedagógico. Analiza estos datos y determina el tipo de material para elegir la mejor estructura de enseñanza.',
            'Temas detectados:\n' + compact.temas.slice(0,5).join('\n') + '\n\nIdeas principales:\n' + ideaData.slice(0, 800),
            '{"tipo":"cientifico|historico|argumentativo|matematico|biografico|filosofico|narrativo","nivel":"secundaria|universidad|medicina|doctorado","estructura_pedagogica":"para cientifico: problema→solucion→mecanismo→evidencia | para historico: contexto→evento→consecuencia→impacto | para argumentativo: tesis→argumentos→evidencias→conclusion | para matematico: concepto→procedimiento→aplicacion→verificacion | para biografico: contexto→aporte→mecanismo→legado","razon":"1 oracion explicando tipo y nivel"}'
          )
        : mkP(
            'You are a pedagogical classifier. Analyze this data and determine the material type to choose the best teaching structure.',
            'Detected topics:\n' + compact.temas.slice(0,5).join('\n') + '\n\nMain ideas:\n' + ideaData.slice(0, 800),
            '{"tipo":"scientific|historical|argumentative|mathematical|biographical|philosophical|narrative","estructura_pedagogica":"for scientific: problem→solution→mechanism→evidence | for historical: context→event→consequence→impact | for argumentative: thesis→arguments→evidence→conclusion | for mathematical: concept→procedure→application→verification | for biographical: context→contribution→mechanism→legacy","razon":"1 sentence explaining why this type fits the material"}'
          ),
        600
      );

      const r0 = (cleanDeep(m0) as any) || {};
      const materialTipo = String(r0?.tipo || 'cientifico').toLowerCase();
      const estructuraPedagogica = String(r0?.estructura_pedagogica || 'problema→solucion→mecanismo→evidencia');
      // Nivel detectado automáticamente del material o del M0
      const nivelDetectado = String(r0?.nivel || nivelEstudio || 'universidad').toLowerCase();
      const nivelInstruccionFinal = nivelDesc[nivelDetectado] || nivelDesc['universidad'];
      console.log(`🎓 Tipo de material: ${materialTipo} | Estructura: ${estructuraPedagogica}`);

      // Adaptar instrucción de M1 según el tipo detectado
      const estructuraM1 = materialTipo.includes('argument') || materialTipo.includes('narrat')
        ? (es ? 'tesis central que defiende el documento' : 'central thesis the document defends')
        : materialTipo.includes('histor') || materialTipo.includes('biograf')
        ? (es ? 'situación o contexto previo al evento central' : 'situation or context before the central event')
        : (es ? 'problema o limitación que existía antes de la idea central' : 'problem or limitation before the central idea');

      const estructuraM1Sol = materialTipo.includes('argument') || materialTipo.includes('narrat')
        ? (es ? 'argumento o propuesta central que defiende el documento' : 'central argument or proposal the document defends')
        : materialTipo.includes('histor') || materialTipo.includes('biograf')
        ? (es ? 'evento central y qué cambió' : 'central event and what changed')
        : (es ? 'solución o idea central propuesta' : 'proposed central solution or idea');

      const estructuraM1Mec = materialTipo.includes('argument') || materialTipo.includes('narrat')
        ? (es ? 'evidencias o razones que usa el documento para sostener su tesis' : 'evidence or reasons the document uses to support its thesis')
        : materialTipo.includes('histor') || materialTipo.includes('biograf')
        ? (es ? 'mecanismo causal: por qué ocurrió y qué consecuencias tuvo' : 'causal mechanism: why it happened and what consequences it had')
        : (es ? 'mecanismo exacto de cómo funciona esa solución' : 'exact mechanism of how that solution works');

      const m1 = await safeAlaiJson(es
        ? mkP(
            masteryBlock + masteryBlock + 'Eres un extractor pedagógico. El material es de tipo: ' + materialTipo + '. Estructura pedagógica: ' + estructuraPedagogica + '. Identifica los 3 elementos clave según esta estructura. USA EXCLUSIVAMENTE los datos dados. No inventes nada externo.',
            'Procesos del documento:\n' + procData + '\n\nIdeas del documento:\n' + ideaData,
            '{"problema":"1-2 oraciones sobre: ' + estructuraM1 + '","solucion":"1-2 oraciones sobre: ' + estructuraM1Sol + '","mecanismo":"2-3 oraciones sobre: ' + estructuraM1Mec + '"}'
          )
        : mkE(
            'You are a pedagogical extractor. Material type: ' + materialTipo + '. Pedagogical structure: ' + estructuraPedagogica + '. Identify the 3 key elements according to this structure. USE EXCLUSIVELY the given data.',
            'Document processes:\n' + procData + '\n\nDocument ideas:\n' + ideaData,
            '{"problema":"1-2 sentences about: ' + estructuraM1 + '","solucion":"1-2 sentences about: ' + estructuraM1Sol + '","mecanismo":"2-3 sentences about: ' + estructuraM1Mec + '"}'
          ),
        800
      );

      // Filtrar datos de M2 para eliminar conceptos secundarios
      const m2SecRx = /\b(copenhague|copenhagen|interpretaci|instituto|institute|nobel|wwii|guerra|world war|semiconduct|láser|laser|transistor|computad|entrelazamiento|superposici|dualidad|colapso cuántico|medición cuántica|nuclear)\b/i;
      const procDataM2 = procData.split('\n').filter((x: string) => !m2SecRx.test(x)).join('\n');
      const ideaDataM2 = ideaData.split('\n').filter((x: string) => !m2SecRx.test(x)).join('\n');

      const m2 = await safeAlaiJson(es
        ? mkP(
            masteryBlock + masteryBlock + 'Eres un profesor experto. Escribe 4-7 partes de clase usando EXCLUSIVAMENTE los datos proporcionados. NIVEL DE AUDIENCIA: ' + nivelInstruccionFinal + '. Tipo de material: ' + materialTipo + '. Estructura pedagógica: ' + estructuraPedagogica + '. REGLAS ABSOLUTAS: 1) Si una idea, concepto, fórmula o nombre NO aparece en los datos, NO lo incluyas. 2) Adapta vocabulario, profundidad y ejemplos al nivel de audiencia. 3) Para cada fórmula: explica cada variable, el signo y qué pasa cuando cambian, al nivel apropiado. 4) Causalidad profunda obligatoria: no solo QUÉ ocurre, sino POR QUÉ ocurre y QUÉ consecuencia tiene. 5) Permanece fiel al dominio del material.',
            'Procesos del documento:\n' + procDataM2 + '\n\nIdeas del documento:\n' + ideaDataM2 + '\n\nFórmulas del documento:\n' + formulaData,
            '{"partes":[{"titulo":"título específico de qué enseña esta parte (no genérico)","explicacion":"5-8 oraciones: situación previa → idea nueva → mecanismo causal → qué resolvió. Incluye: POR QUÉ ocurre, no solo QUÉ ocurre","checkpoint":"pregunta de causa→mecanismo→consecuencia"}]}'
          )
        : mkE(
            'You are an expert teacher. Write 4-7 class parts using EXCLUSIVELY the provided data. ABSOLUTE RULES: 1) If an idea, concept, formula or name does NOT appear in the data, do NOT include it. 2) Each part teaches ONE idea: prior situation → new idea → how it works → what problem it solved. 3) For each formula in the data: explain each variable, the sign meaning, and what happens when variables change. 4) Causal depth is mandatory: explain WHY it happens and WHAT consequence it has. 5) Do not make analogies with other fields.',
            'Document processes:\n' + procDataM2 + '\n\nDocument ideas:\n' + ideaDataM2 + '\n\nDocument formulas:\n' + formulaData,
            '{"partes":[{"titulo":"specific non-generic title of what this part teaches","explicacion":"5-8 sentences: prior situation → new idea → causal mechanism → what it solved. Include: WHY it happens, not just WHAT happens","checkpoint":"cause→mechanism→consequence question"}]}'
          ),
        2500
      );

      const m3 = await safeAlaiJson(es
        ? mkP(
            masteryBlock + masteryBlock + 'Eres un profesor. NIVEL DE AUDIENCIA: ' + nivelInstruccionFinal + '. Genera errores comunes, preguntas de examen, probabilidad de examen y resumen. REGLAS: 1) Las preguntas deben evaluar comprensión causal del tema central, adaptadas al nivel. 2) Los errores comunes deben ser confusiones reales del nivel de audiencia. 3) Para probabilidad_examen: marca "alta" si el concepto aparece repetido, es un mecanismo central o tiene fórmula; "media" si aparece explicado; "baja" si solo se menciona. 4) USA SOLO la información proporcionada.',
            'Confusiones del documento:\n' + confData + '\n\nPreguntas posibles del documento:\n' + pregData + '\n\nProcesos centrales del documento:\n' + procData,
            '{"errores":[{"error":"confusión realista de un estudiante sobre el mecanismo o concepto central","correccion":"corrección precisa y causal en 1-2 oraciones"}],"preguntas_examen":[{"pregunta":"pregunta que obliga a explicar causa→mecanismo→consecuencia del tema central","respuesta":"respuesta causal en 2-3 oraciones"}],"probabilidad_examen":[{"concepto":"nombre del concepto","probabilidad":"alta|media|baja","razon":"1 oración explicando por qué tiene esa probabilidad"}],"para_examen":["concepto o mecanismo clave que un profesor preguntaría"],"resumen":"3-4 oraciones causales: problema → solución → mecanismo → evidencia"}'
          )
        : mkE(
            'You are a teacher. Generate common errors, exam questions and a summary. RULES: 1) Questions must evaluate causal understanding of the central document topic. 2) Common errors must be real student confusions about the central mechanism. 3) Summary must narrate: problem → solution → mechanism → evidence. 4) USE ONLY provided information.',
            'Document confusions:\n' + confData + '\n\nDocument possible questions:\n' + pregData + '\n\nDocument core processes:\n' + procData,
            '{"errores":[{"error":"realistic student confusion about the central document mechanism","correccion":"precise causal correction in 1-2 sentences"}],"preguntas_examen":[{"pregunta":"question requiring cause→mechanism→consequence explanation of central topic","respuesta":"causal answer in 2-3 sentences"}],"para_examen":["key concept or mechanism from the document a professor would ask about"],"resumen":"3-4 causal sentences: document problem → proposed solution → explaining mechanism → evidence or result"}'
          ),
        2000
      );

      const r1 = (cleanDeep(m1) as any) || {};
      const r2 = (cleanDeep(m2) as any) || {};
      const r3 = (cleanDeep(m3) as any) || {};

      const partesMicro: any[] = Array.isArray(r2?.partes) ? r2.partes : [];

      if (r3?.evidencia) partesMicro.push({
        titulo: es ? 'La evidencia que lo demostró' : 'The evidence that proved it',
        explicacion: String(r3.evidencia),
        ejemplo: '',
        checkpoint: es ? '¿Por qué esta evidencia confirma la idea central?' : 'Why does this evidence confirm the central idea?',
      });

      if (r3?.consecuencias) partesMicro.push({
        titulo: es ? 'Impacto y consecuencias' : 'Impact and consequences',
        explicacion: String(r3.consecuencias),
        ejemplo: '',
        checkpoint: es ? '¿Qué cambió gracias a esta idea?' : 'What changed because of this idea?',
      });

      const si_no_sabes = [r1?.problema, r1?.solucion].filter(Boolean).join(' ') || compact.temas.slice(0, 2).join('. ');
      const mapa = [r1?.problema, r1?.solucion, r1?.mecanismo].filter(Boolean).join(' → ') || compact.procesos.slice(0, 2).join(' → ');

      // Objetivos adaptativos desde M1 según el material real
      const objetivosM1 = Array.isArray(r1?.objetivos) && r1.objetivos.length >= 2
        ? r1.objetivos
        : [
            es ? 'Explicar la idea central del material con tus propias palabras' : 'Explain the central idea in your own words',
            es ? 'Describir el mecanismo principal que presenta el documento' : 'Describe the main mechanism in the document',
            es ? 'Conectar los conceptos clave con su contexto y consecuencias' : 'Connect key concepts with their context and consequences',
          ];

      let cA: any = {
        titulo: es ? 'Profesor ALAI' : 'Professor ALAI',
        nivel_detectado: nivelDetectado,
        material_tipo: materialTipo,
        objetivos: objetivosM1,
        si_no_sabes_nada: si_no_sabes,
        mapa_inicial: mapa,
        cobertura_material: compact.noOmitir
          .filter((x: string) => !bioRx.test(x))
          .slice(0, 8)
          .map((x: string) => ({ elemento: x.split(':')[0].trim(), por_que_importa: x.split(':').slice(1).join(':').trim() || x })),
        clase_narrativa: partesMicro.map((p: any) => ({
          titulo: p.titulo || '',
          explicacion: p.explicacion || '',
          ejemplo: p.ejemplo || '',
          checkpoint: p.checkpoint || '',
        })),
        __compact: compact,
      };

      let cB: any = {
        panorama_completo: [r1?.problema, r1?.solucion, r1?.mecanismo, r3?.consecuencias].filter(Boolean).join(' '),
        conexiones_clave: relacionData.split('\n').filter(Boolean).slice(0, 3).map((x: string) => ({
          titulo: x.split(':')[0].trim(),
          explicacion: x.split(':').slice(1).join(':').trim() || x,
        })),
        errores_comunes: Array.isArray(r3?.errores) ? r3.errores.map((e: any) => ({
          error: e.error || '',
          correccion: e.correccion || '',
          mini_ejemplo: '',
        })) : [],
        preguntas_profesor: Array.isArray(r3?.preguntas_examen) ? r3.preguntas_examen.map((q: any) => ({
          pregunta: q.pregunta || '',
          que_evalua: es ? 'Comprensión causal' : 'Causal understanding',
          respuesta_esperada: q.respuesta || '',
        })) : [],
        para_examen: Array.isArray(r3?.para_examen) ? r3.para_examen.map((p: string) => ({ punto: p, por_que: '' })) : [],
        probabilidad_examen: Array.isArray(r3?.probabilidad_examen) ? r3.probabilidad_examen : [],
        ya_puedes_explicar: partesMicro.slice(0, 5).map((p: any) => p.titulo).filter(Boolean),
        resumen_final: r3?.resumen || '',
        preguntas_sugeridas: pregData.split('\n').slice(0, 3).map((x: string) => x.split('Respuesta')[0].trim()).filter(Boolean),
        preguntale_alai: es ? 'Puedes preguntarme cualquier duda sobre este material.' : 'You can ask me any question about this material.',
        __compact: compact,
      };

      console.log(`🎯 Micro-síntesis: ${partesMicro.length} partes generadas para ${doc.nombre}`);

      if (!cA || !cB) {
        console.warn(`⚠️ No se pudo sintetizar material: ${doc.nombre}`);

        const compact = compactExtractedKnowledge(extracted);

        cA = cA || {
          titulo: `Profesor ALAI — ${doc.nombre}`,
          objetivos: compact.ideas.slice(0, 20),
          si_no_sabes_nada: compact.temas.join('. '),
          mapa_inicial: compact.ideas.slice(0, 10).join('. '),
          cobertura_material: compact.noOmitir.map((x:any) => ({
            elemento: x,
            por_que_importa: x,
          })),
          clase_narrativa: compact.ideas.slice(0, 20).map((x:any, i:number) => ({
            titulo: `Parte ${i + 1}`,
            explicacion: x,
            ejemplo: compact.ejemplos[i] || x,
            checkpoint: x,
          })),
        };

        cB = cB || {
          panorama_completo: compact.ideas.join('. '),
          conexiones_clave: compact.relaciones.map((x:any) => ({
            titulo: x,
            explicacion: x,
          })),
          errores_comunes: compact.confusiones.map((x:any) => ({
            error: x,
            correccion: x,
            mini_ejemplo: x,
          })),
          preguntas_profesor: compact.preguntas.map((x:any) => ({
            pregunta: x,
            que_evalua: x,
            respuesta_esperada: x,
          })),
          para_examen: compact.noOmitir.slice(0,30).map((x:any) => ({
            punto: x,
            por_que: x,
          })),
          ya_puedes_explicar: compact.ideas.slice(0,30),
          preguntas_sugeridas: compact.preguntas.slice(0,20),
          resumen_final: compact.temas.join('. '),
          preguntale_alai: 'Pregunta cualquier punto del material.',
        };
      }

      materialAnalyses.push({
        materialId: doc.id,
        materialName: doc.nombre,
        cA,
        cB,
        extracted,
      });
    }

    if (!materialAnalyses.length) {
      return NextResponse.json(
        { error: 'No se pudo construir una clase clara con los materiales enviados.' },
        { status: 500 },
      );
    }

    let cA = materialAnalyses[0].cA;
    let cB = materialAnalyses[0].cB;

    // ─── 3) Si hay varios materiales, NO usar otra compresión LLM:
    //       se conserva la clase completa de cada material y se evita mezclar temas.
    if (materialAnalyses.length > 1) {
      const perMaterial = materialAnalyses.map((m) =>
        buildAnalisisFromParts({
          cA: m.cA,
          cB: m.cB,
          lang,
          detectedLang,
          docNames: [m.materialName],
        }),
      );

      const analisis = buildMultiMaterialAnalisis({
        perMaterial,
        materialNames: materialAnalyses.map((m) => m.materialName),
        detectedLang,
      });

      console.log(
        `👨‍🏫 Profesor ALAI multi-material directo: ${analisis.clase_narrativa.length} partes, ${analisis.cobertura_material.length} elementos, coverage=${analisis.coverage.percent}%`,
      );

      if (materialId && userId) {
        saveMaterialResult({
          material_id: materialId,
          enfoque: 'teorico',
          result_type: 'analysis',
          payload: analisis,
        }).catch(e => console.warn('Cache write error:', e?.message));
      }

      return NextResponse.json({ success: true, analisis });
    }

    // ─── 4) Construir resultado final desde partes sintetizadas ───
    const analisis = buildAnalisisFromParts({ cA, cB, lang, detectedLang, docNames });

    if (analisis.clase_narrativa.length === 0 || (!analisis.si_no_sabes_nada && !analisis.mapa_inicial)) {
      console.warn('⚠️ Analisis vacío, construyendo fallback final compacto');

      const compact = compactExtractedKnowledge(
        materialAnalyses.flatMap((m) => m.extracted || [])
      );

      const fallback = makeHumanTeachingLesson({
        cA: { __compact: compact, titulo: 'Profesor ALAI' },
        cB: { __compact: compact },
        lang,
        detectedLang,
        docNames,
      });

      return NextResponse.json({ success: true, analisis: fallback });
    }

    console.log(
      `👨‍🏫 Profesor ALAI chunked: ${analisis.clase_narrativa.length} partes, ${analisis.cobertura_material.length} elementos, docs=${docNames.length}`,
    );

    // ─── Guardar en cache ───
    if (materialId && userId) {
      saveMaterialResult({
        material_id: materialId,
        enfoque: 'teorico',
        result_type: 'analysis',
        payload: analisis,
      }).catch(e => console.warn('Cache write error:', e?.message));
    }

    return NextResponse.json({ success: true, analisis });

  } catch (error: any) {
    console.error('analizar-teorico error:', error);
    return NextResponse.json(
      { error: error?.message || 'Error generando análisis' },
      { status: 500 },
    );
  }
}
