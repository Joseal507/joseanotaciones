import { academicVerdict } from '../../../lib/materialLanguage'
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { generateValidatedLegacyJson } from '../../../lib/ai/legacyRouteGeneration';
import { getAuthoritativeFreeSession } from '../../../lib/materialBrain/quiz/sessionAuthority';
import { getMaterial } from '../../../lib/materials/repository';
import { buildSourceSelectionSnapshot, type SourceSelectionSnapshot } from '../../../lib/adaptive/sourceSelection';
import { lookupStudyalMaterialEnjoyer, WorkerMaterialEnjoyerStore } from '../../../lib/adaptive/materialEnjoyer';
import { buildRepasarEnjoyerGroundedContext } from '../../../lib/materialBrain/repasarEnjoyerContext';
import {
  buildRepasarGapGroups, computeRepasarCoverage, computeRepasarDomainMap, computeRepasarMastery, computeRepasoCanonicalScore, chunkRepasarTargets,
  renderRepasarGroundedContextForPrompt, sortRepasarGapsByPriority,
  type RepasarDomainMap, type RepasarGroundedContext, type RepasarMastery, type RepasarReviewTarget,
} from '../../../lib/materialBrain/reviewContext';

// Bounded scale: a single provider call comfortably judges up to this
// many targets (matches the 6000-token analysis budget). Materials
// beyond this are split into fixed batches evaluated IN PARALLEL — every
// target still belongs to exactly one batch (nothing dropped from the
// academic universe), so provider calls scale O(ceil(N/BATCH_SIZE)),
// never O(N) and never a single silently-truncated giant prompt. Real
// materials (tens of targets) always take the single-call path,
// unchanged from before.
// Deterministic transport batch size for the canonical coverage pass.
// Was 80 before the structured evidence/demonstrated/missingDetail
// schema existed — at that size a real material's response routinely
// filled or exceeded the output token budget, and any truncation with no
// per-target retry meant the ENTIRE batch (up to 80 targets) silently
// collapsed to "omitted", regardless of what the model actually judged.
// Lowered to a size the 4-field-per-target schema comfortably fits
// within a single response, so a truncation/partial-response event
// affects only a small slice — which the round-based retry loop below
// (resolveRepasarCoverage) then re-requests on its own, never leaving a
// target's non-response silently rendered as academic "missing". This is
// purely a transport/reliability knob — it must NEVER change how many
// targets get adjudicated (that is guaranteed by resolveRepasarCoverage
// looping until the full universe is covered or retries are exhausted).
export const REPASAR_TARGET_BATCH_SIZE = 15;
// An incomplete/empty transport-successful batch is never retried at the
// same size. Only its unresolved ids are split 15 -> 8+7 -> 4+4/4+3.
// This bounds graceful recovery to six fallback logical calls per failed
// initial batch (two children + four grandchildren).
export const REPASAR_MAX_FALLBACK_SPLIT_DEPTH = 2;
export const REPASAR_FALLBACK_CONCURRENCY = 4;
export const REPASAR_MAX_PROVIDER_CALLS_PER_INITIAL_BATCH = 7;
import {
  WorkerRepasarSnapshotStore, resolveRepasarEnjoyerSnapshot, snapshotGroundedContext,
  type RepasarReader,
} from '../../../lib/materialBrain/repasarSnapshot';
import { randomUUID } from 'crypto'
import {
  createRepasoArtifact,
  buildRepasoRecoveryPlan,
  applyRecoveryAttempt,
  applyFinalVerificationResult,
  buildRepasoStudentEvidencePaper,
  computeRepasoMasteryStatus,
  currentRepasoRecoveryGroup,
  previewRepasoTransitions,
  type RepasoArtifact,
  type RepasoFinalVerification,
  type RepasoRecoveryAttempt,
  type RepasoTargetAdjudication,
  type RepasoTargetState,
} from '../../../lib/materialBrain/repasoArtifact'
import {
  WorkerRepasoArtifactStore,
} from '../../../lib/materialBrain/repasoArtifactStore'

const VALID_READERS: RepasarReader[] = ['nino', 'universitario', 'profesor', 'libre'];

/** Canonical reader key — invalid/absent client input always falls back to 'libre', never silently to 'profesor' or anything else. */
function normalizeReader(value: unknown): RepasarReader {
  const key = String(value || '').trim().toLowerCase();
  return (VALID_READERS as string[]).includes(key) ? (key as RepasarReader) : 'libre';
}

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export const __routeDeps = {
  getServerSession,
  getAuthoritativeFreeSession,
  getMaterial,
  lookupEnjoyer: async (fingerprint: string) => lookupStudyalMaterialEnjoyer(fingerprint, new WorkerMaterialEnjoyerStore()),
  generateValidatedLegacyJson,
  resolveRepasarSnapshot: resolveRepasarEnjoyerSnapshot,
  createRepasarSnapshotStore: () => new WorkerRepasarSnapshotStore(),
  createRepasoArtifactStore:
    () => new WorkerRepasoArtifactStore(),
};

// Academic authority NEVER comes from the client. Beyond raw source text,
// this also forbids a client from shipping its own review-target universe
// or evidence — the frozen snapshot is restored server-side by id only.
// (A forged `enrichmentRevision` in the body is simply never read.)
const RAW_SOURCE_AUTHORITY_KEYS = [
  'materialText', 'combinedText', 'rawText', 'content', 'contenido', 'texto', 'facts',
  'targets', 'reviewTargets', 'groundedContext', 'evidence', 'snapshot',
];

function errorResponse(code: string, status: number, detail?: string) {
  return NextResponse.json({ error: code, ...(detail ? { detail } : {}) }, { status });
}

interface RepasarEnjoyerLookupResult {
  groundedContext: RepasarGroundedContext | null
  code: string
  status: number
  /** Only set on success — the resolved source-selection identity, used
   * to freeze `RepasoArtifact.frozenAuthority` at creation time (or to
   * opportunistically backfill it onto a pre-migration artifact). */
  sourceSelection?: SourceSelectionSnapshot
}

// A transient upstream failure fetching session authority (a 5xx from the
// session-authority dependency `getAuthoritativeFreeSession` calls out to)
// must not permanently block Continue on an otherwise-healthy, already
// persisted Recovery run — the SAME authoritative check is retried once,
// immediately, never weakening WHO is authoritative or HOW ownership is
// verified. A genuine 4xx (bad/expired auth, not-found) is never retried —
// only the specific `SESSION_AUTHORITY_FAILED:5xx` shape this dependency
// throws for a server-side (not client-side) failure. Scoped locally to
// this route only — `getAuthoritativeFreeSession` itself (shared by Quiz/
// Exam/StudyMap/Chat) is untouched.
const SESSION_AUTHORITY_TRANSIENT_PATTERN = /^SESSION_AUTHORITY_FAILED:5\d\d$/
async function getAuthoritativeFreeSessionWithTransientRetry(
  sessionId: string,
  userId: string,
): ReturnType<typeof __routeDeps.getAuthoritativeFreeSession> {
  try {
    return await __routeDeps.getAuthoritativeFreeSession(sessionId, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!SESSION_AUTHORITY_TRANSIENT_PATTERN.test(message)) throw error
    return await __routeDeps.getAuthoritativeFreeSession(sessionId, userId);
  }
}

/**
 * Shared tail: once a `sourceSelection` identity is known-good (either
 * freshly live-validated, or deterministically rebuilt from an already
 * frozen, previously live-validated authority snapshot), resolving the
 * canonical Enjoyer content and building the grounded context is
 * identical either way. The Enjoyer lookup itself (materials/R2 content
 * store) is a separate, unavoidable content dependency — not the
 * ownership/session-authority dependency this durability fix removes —
 * so it is never skipped.
 */
async function finalizeRepasarEnjoyerAuthority(
  sourceSelection: SourceSelectionSnapshot,
): Promise<RepasarEnjoyerLookupResult> {
  const enjoyer = await __routeDeps.lookupEnjoyer(sourceSelection.fingerprint);
  if (!enjoyer) return { groundedContext: null, code: 'ENJOYER_NOT_READY', status: 409 };
  try {
    return {
      groundedContext: buildRepasarEnjoyerGroundedContext(enjoyer, sourceSelection),
      code: 'OK',
      status: 200,
      sourceSelection,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_ENJOYER_AUTHORITY';
    return { groundedContext: null, code, status: 409 };
  }
}

/**
 * FRESH-CREATION / LEGACY PATH: requires a healthy live session-authority
 * dependency (`/study-sessions`) plus a live per-material ownership check
 * — the ONLY moment a NEW artifact's ownership/source-selection identity
 * is legitimately established. Also used, unchanged, as the fallback for
 * a pre-migration artifact that has no `frozenAuthority` snapshot yet.
 */
async function resolveRepasarEnjoyerAuthority(
  sessionId: string,
  userId: string,
): Promise<RepasarEnjoyerLookupResult> {
  const freeSession = await getAuthoritativeFreeSessionWithTransientRetry(sessionId, userId);
  if (!freeSession) return { groundedContext: null, code: 'SESSION_NOT_FOUND', status: 404 };
  const sourceSelection = freeSession.sourceSelection;
  for (const materialId of sourceSelection.materialIds) {
    if (!await __routeDeps.getMaterial(materialId, userId)) return { groundedContext: null, code: 'SESSION_NOT_FOUND', status: 404 };
  }
  return finalizeRepasarEnjoyerAuthority(sourceSelection);
}

/**
 * DURABLE CONTINUATION PATH — the fix for SESSION_AUTHORITY as a runtime
 * single point of failure. `frozenAuthority` was captured at artifact
 * creation time, at the exact moment the live path above ALREADY proved
 * session ownership and per-material ownership. `buildSourceSelectionSnapshot`
 * is a pure, deterministic function of `materialIds`/`selectedPages` (a
 * hash — see `lib/adaptive/sourceSelection.ts`), so rebuilding the
 * IDENTICAL `SourceSelectionSnapshot` (same fingerprint) from that frozen
 * data reproduces the exact canonical identity without any live HTTP call
 * to the session-authority or materials-ownership dependencies. The
 * caller MUST have already verified `frozenAuthority.userId === userId`
 * (fail-closed) before calling this — this function only rebuilds the
 * source-selection identity, it does not itself re-check ownership.
 */
async function resolveRepasarEnjoyerAuthorityForContinuation(
  frozenAuthority: NonNullable<RepasoArtifact['frozenAuthority']>,
): Promise<RepasarEnjoyerLookupResult> {
  const sourceSelection = buildSourceSelectionSnapshot(frozenAuthority.materialIds, frozenAuthority.selectedPages);
  return finalizeRepasarEnjoyerAuthority(sourceSelection);
}

function cleanArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 10);
}

function cleanScore(value: any) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function cleanReviewer(value: any) {
  return {
    persona: String(value?.persona || '').trim(),
    rating: cleanScore(value?.rating),
    verdict: stripScoreMentions(String(value?.verdict || '').trim()),
    feedback: stripScoreMentions(String(value?.feedback || '').trim()),
    wouldUnderstand: Boolean(value?.wouldUnderstand),
    missingForThem: cleanArray(value?.missingForThem).slice(0, 6),
  };
}

// 3 niveles (no binario): CRITICAL = indispensable para la tesis/concepto
// central — su ausencia SÍ demuestra una falla real de comprensión.
// SUPPORTING = enriquece/profundiza, pero omitirlo no invalida la
// comprensión del núcleo. CONTEXTUAL = nombres, fechas, lugares, marcos,
// ejemplos — casi nunca determinan por sí solos el dominio. Genérico: no
// depende del tema del material.
type Importance = 'critical' | 'supporting' | 'contextual';

function cleanConceptStatus(value: any) {
  const status = String(value?.status || 'progress').trim();
  const importanceRaw = String(value?.importance || 'supporting').trim();
  const importance: Importance =
    importanceRaw === 'critical' ? 'critical'
      : importanceRaw === 'contextual' ? 'contextual'
        : 'supporting';
  return {
    concept: String(value?.concept || '').trim(),
    status: ['mastered', 'progress', 'weak'].includes(status) ? status : 'progress',
    importance,
    note: String(value?.note || '').trim(),
    // Cortos y solo cuando hay evidencia real — el mapa de dominio los usa
    // para mostrar "Dijiste" / "Faltó" sin párrafos largos. En conceptos
    // "mastered", `missing` se reutiliza como profundización opcional
    // ("para llevarlo más lejos"), no como carencia.
    said: String(value?.said || '').trim().slice(0, 160),
    missing: String(value?.missing || '').trim().slice(0, 160),
  };
}

// SOURCE CONCEPT MAP: si el cliente ya fijó un universo de conceptos (del
// primer intento de la sesión), el conceptStatus de este intento se alinea
// EXACTAMENTE a ese universo — nunca se deja que el LLM agregue/quite
// conceptos libremente por lector. Un concepto fijo que el modelo no
// vuelva a mencionar se trata como no cubierto en este intento (fail-closed,
// nunca mastery implícito por ausencia).
function reconcileConceptStatus(
  modelConceptStatus: any,
  lockedMap: { concept: string; importance: Importance; canonicalStatus?: 'mastered' | 'progress' | 'weak'; canonicalEvidence?: string; canonicalMissingDetail?: string }[] | null,
) {
  const cleaned = Array.isArray(modelConceptStatus)
    ? modelConceptStatus.map(cleanConceptStatus).filter((c: any) => c.concept)
    : [];

  if (!lockedMap || lockedMap.length === 0) return cleaned.slice(0, 10);

  const byName = new Map(cleaned.map((c: any) => [c.concept.trim().toLowerCase(), c]));
  return lockedMap.slice(0, 12).map((locked) => {
    const match = byName.get(locked.concept.trim().toLowerCase());
    // ONE canonical evidence/status contract: "Dijiste" (said) must come
    // from the SAME evidence the canonical academic pass used to decide
    // this target's status — never from the persona/feedback call's own
    // independently-generated wording. Those are two separate LLM calls;
    // trusting the persona call's own "said" text is exactly how a live
    // bug happened where a target rendered "Dijiste: <real quote>" while
    // its canonical status was still weak/omitted, because the persona
    // call synthesized its own reading of the explanation, decoupled
    // from what the strict canonical pass actually judged as evidence.
    // - canonicalEvidence present -> always wins (single source of truth).
    // - canonicalEvidence absent AND canonicalStatus is "weak" (the
    //   invariant in evaluateRepasarCoverageBatch guarantees "weak" +
    //   no evidence == genuinely omitted) -> said is forced empty; a
    //   target with zero real evidence can never display one.
    // - otherwise (defensive: weak/incorrect verdict whose evidence
    //   field the model left empty) -> fall back to the model's own
    //   wording rather than fabricating silence.
    const said = locked.canonicalEvidence
      ? locked.canonicalEvidence.slice(0, 160)
      : (locked.canonicalStatus === 'weak' ? '' : (match?.said || ''));
    // Same single-source contract for "Faltó" (missing): when the
    // canonical pass itself named a concrete missing detail (only
    // possible for a "progress"/partial verdict), that wording is
    // authoritative — never the persona call's own independent guess at
    // what's absent, which can drift from what was actually judged
    // incomplete.
    const missingWording = locked.canonicalMissingDetail
      ? locked.canonicalMissingDetail.slice(0, 160)
      : (match?.missing || '');
    if (match) return {
      ...match,
      concept: locked.concept,
      importance: locked.importance,
      // The canonical, reader-neutral target verdict owns the status.
      // Reader feedback still owns note wording, but cannot turn
      // demonstrated_partial into a red weak/omitted presentation.
      status: locked.canonicalStatus || match.status,
      said,
      missing: missingWording,
    };
    return {
      concept: locked.concept, status: locked.canonicalStatus || 'weak', importance: locked.importance,
      note: '', said, missing: missingWording,
    };
  });
}

function cleanRepair(value: any) {
  return {
    question: String(value?.question || '').trim(),
    // Etiqueta CORTA y genérica del área que cubre la reparación (p.ej.
    // "Grandeza de los Falcons más allá de trofeos") — es lo único que la
    // UI muestra como chip. NUNCA debe enumerar los hechos/sub-conceptos
    // (eso regalaría la respuesta); ver sanitizeTopicLabel().
    topicLabel: String(value?.topicLabel || '').trim().slice(0, 80),
    // targetConcepts/requiredFacts/optionalFacts se usan para grading y
    // reconciliación server-side — NUNCA se renderizan como chips.
    targetConcepts: cleanArray(value?.targetConcepts).slice(0, 5),
    requiredFacts: cleanArray(value?.requiredFacts).slice(0, 8),
    optionalFacts: cleanArray(value?.optionalFacts).slice(0, 8),
  };
}

const SPANISH_NUMBER_WORDS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

// La pregunta de reparación no puede prometer un cardinal ("los tres
// pilares...") que no coincide con la cantidad real de requiredFacts —
// eso es lo que producía preguntas de "tres" evaluando en realidad cinco
// conceptos. Si detecta un número que no coincide, cae a una pregunta
// abierta sin cardinal fijo.
function sanitizeQuestionCardinality(question: string, requiredCount: number): string {
  const q = String(question || '').trim();
  if (!q || requiredCount <= 0) return q;
  const lower = q.toLowerCase();
  const digitMatch = lower.match(/\b([2-9]|10)\b/);
  const wordHit = Object.keys(SPANISH_NUMBER_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(lower));
  const mentioned = digitMatch ? Number(digitMatch[1]) : (wordHit ? SPANISH_NUMBER_WORDS[wordHit] : null);
  if (mentioned !== null && mentioned !== requiredCount) {
    return '¿Qué aspectos clave del material te faltó explicar sobre este concepto?';
  }
  return q;
}

// El score visible tiene una sola autoridad: el `score` calibrado que ya
// se muestra en la UI. El modelo no debe narrar un número de puntaje
// distinto dentro de summary/scoreReason/etc. (p.ej. "el puntaje es 35
// porque..." cuando el score mostrado es 30) — se elimina esa mención.
function stripScoreMentions(text: string): string {
  const t = String(text || '');
  if (!t) return t;
  return t
    .replace(/\b(?:el\s+)?(?:puntaje|score|puntuaci[oó]n|calificaci[oó]n)\s+(?:es|fue|ser[ií]a)\s+(?:de\s+)?\d{1,3}(?:\s*\/\s*100)?\s*(?:,)?\s*(?:porque|ya que|debido a)?/gi, '')
    .replace(/\b\d{1,3}\s*\/\s*100\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

// Narrative/metric consistency guard (mission: Profesor's text said "La
// respuesta es excepcional... dominio avanzado" while deterministic
// coverage was 28%/35 domain — a real contradiction the prompt-level
// instruction alone cannot fully guarantee). Deterministic, presentation-
// only: never rewrites academic content, only removes/softens absolute-
// mastery language when the REAL computed coverage contradicts it.
const OVERCLAIM_PATTERNS: RegExp[] = [
  /dominio (avanzado|completo|excepcional|total)/gi,
  /comprensi[oó]n (excepcional|profunda y completa|total|completa)/gi,
  /domina(s)? (todo|la totalidad|el material completo)/gi,
  /cobertura (completa|total) del material/gi,
  /(dominas|entendiste) (todo|absolutamente todo)/gi,
];
function enforceNarrativeConsistency(text: string, domainMap: { coveragePercent: number; omitted: number; totalAcademicTargets: number }): string {
  const t = String(text || '');
  if (!t || domainMap.coveragePercent >= 60) return t;
  let out = t;
  for (const pattern of OVERCLAIM_PATTERNS) {
    out = out.replace(pattern, `buena comprensión de lo que abordaste (aunque ${domainMap.omitted} de ${domainMap.totalAcademicTargets} temas del material todavía no aparecen en tu explicación)`);
  }
  return out;
}

function cleanAction(value: any) {
  return {
    title: String(value?.title || '').trim(),
    detail: String(value?.detail || '').trim(),
  };
}

function cleanMiniLesson(value: any) {
  return {
    title: String(value?.title || '').trim(),
    explanation: String(value?.explanation || '').trim(),
    example: String(value?.example || '').trim(),
    analogy: String(value?.analogy || '').trim(),
  };
}

function wordCount(text: string) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

// ============================================================
// P0 FIX (real Clutch 2 acceptance): 63/76 correct, 1 incorrect, 12
// omitted, 83% coverage, 95% explanation quality produced Dominio=50.
// ROOT CAUSE, traced term-by-term: `criticalWeak` was a BINARY cliff —
// "any critical-tier target not fully correct" (true here: at least one
// of the 12 omitted/1 incorrect was critical-tier) capped the score at
// `28 + 26*evidenceFrac` = 28 + 26*0.83 ≈ 50, REGARDLESS of the other 63
// correct targets. The newer coverage-ceiling (persona margins 45/35/
// 25/30) never even got to bind — it was already capped below that by
// the older, harsher criticalWeak cliff first. Both are removed below,
// replaced by `computeRepasarMastery` — a single, weighted, continuous
// formula (lib/materialBrain/reviewContext.ts) with no per-persona
// floor/ceiling and no binary "any critical gap" cliff: a critical gap
// among many correct targets costs its proportional WEIGHT, never an
// arbitrary flat cap. See REP-SCORE-A..E for the sanity-constraint cases
// this must satisfy (low coverage can't be near-100; high coverage +
// high correctness must be high; many-incorrect must stay low; etc).
// ============================================================
function calibrateRepasarScore({
  explanation,
  mastery,
}: {
  explanation: string;
  mastery: RepasarMastery;
}) {
  const words = wordCount(explanation);
  if (words < 4) return Math.min(mastery.masteryPercent, 15);
  return cleanScore(Math.round(mastery.masteryPercent));
}

// Bounded supplementary batch — coverage-only, no narrative/feedback
// fields, used only for the target batches beyond the first when a
// material's academic universe exceeds REPASAR_TARGET_BATCH_SIZE. A
// failed/unparseable batch never blocks the attempt — its targets
// simply stay `omitted` (the honest default), never silently marked
// incorrect and never crashing the whole evaluation.
type RepasarCoverageStatus = 'covered' | 'partial' | 'missing' | 'incorrect';
interface RawRepasarCoverageEntry {
  targetId: string;
  status: RepasarCoverageStatus;
  evidence?: string;
  demonstrated?: string;
  missingDetail?: string;
}

interface RepasarCoverageProviderBudget {
  consumed: number;
  maximum: number;
}

async function evaluateRepasarCoverageBatch(
  batch: RepasarReviewTarget[],
  groundedContext: RepasarGroundedContext,
  explanation: string,
  providerBudget?: RepasarCoverageProviderBudget,
): Promise<RawRepasarCoverageEntry[]> {
  if (!batch.length) return [];
  const batchText = renderRepasarGroundedContextForPrompt({ ...groundedContext, targets: batch });
  try {
    const parsed: any = await __routeDeps.generateValidatedLegacyJson({
      taskType: 'summary',
      temperature: 0.15,
      // Was 3000 before the structured evidence/demonstrated/missingDetail
      // fields existed. A single un-chunked batch can hold up to
      // REPASAR_TARGET_BATCH_SIZE=80 targets — at a lower ceiling the JSON
      // array could be cut off mid-object, and because this call passes
      // no `recoverableArrayKeys`, ANY parse failure (including a
      // truncated array) previously fell straight through to the catch
      // below and returned `[]` for the ENTIRE batch — silently
      // defaulting every target in it to "omitted", not just the ones the
      // model genuinely judged missing. Raised to the same ceiling as the
      // sibling large-structured-output calls in this route.
      maxTokens: 7000,
      messages: [
        {
          role: 'system',
          // THE canonical student-vs-Enjoyer adjudication pass. Judges
          // PROPOSITION-LEVEL meaning, never source wording. This call is
          // deliberately reader-independent (no persona/mode is passed
          // in) — the required depth for a given target is fixed by the
          // target itself (see kind/importance in the rendered MATERIAL
          // below), never by which of the 4 readers the student picked.
          // Downstream (domainMap/score/persona feedback) must treat this
          // verdict as final authority — never re-adjudicate it.
          content: `Eres un evaluador académico. Debes devolver EXACTAMENTE UNA adjudicación para CADA TARGET suministrado, conservando su targetId exacto. Nunca omitas un target: si el estudiante no dijo nada sobre él, devuelve status="missing" con evidence="", demonstrated="" y missingDetail="". Para cada target juzga si la EXPLICACIÓN del estudiante demuestra su PROPOSICIÓN — el SIGNIFICADO, nunca la redacción exacta de la fuente. Compara SIGNIFICADO contra SIGNIFICADO: una paráfrasis correcta con palabras completamente distintas a las del MATERIAL cuenta exactamente igual que citarlo literal.

DEFINICIONES (usa exactamente estas):
"covered" = el estudiante demuestra la proposición esencial del target a la profundidad que el target exige. NO exijas ejemplos, ecuaciones, derivaciones o notación formal para "covered" salvo que esos SEAN la proposición central del target (ej: un target que ES la fórmula).
"partial" = el estudiante demuestra la proposición central o una parte importante de ella, pero omite un detalle requerido por el target: fórmula, derivación, terminología exacta, ejemplo, valor numérico, condición, explicación causal, representación simbólica, o un paso de un proceso de varios pasos. Que falte ese detalle NUNCA convierte esto en "missing" — el concepto central SÍ fue demostrado.
"incorrect" = el estudiante lo menciona pero de forma equivocada o contradictoria (una afirmación falsa sobre el target, no solo incompleta).
"missing" = el estudiante no da NINGUNA evidencia real relacionada con este target. Reservado EXCLUSIVAMENTE para ausencia total — nunca lo uses solo porque falta precisión o un detalle formal.

REGLA CRÍTICA: no reproducir cada detalle del target NUNCA implica automáticamente "missing". Si el estudiante afirma la relación/idea subyacente correctamente pero omite una representación formal que el target exige, usa "partial", no "missing".

Para cada target devuelve estos 4 campos, concisos (máx. ~12 palabras cada uno):
- "evidence": cita corta o paráfrasis de lo que el estudiante realmente escribió que respalda este target.
- "demonstrated": qué parte de la proposición del target el estudiante sí mostró.
- "missingDetail": qué detalle específico falta o quedó incompleto.
- "status": "covered" | "partial" | "missing" | "incorrect", según las definiciones de arriba.

CONSISTENCIA OBLIGATORIA entre estos campos:
- si "status" es "missing": "evidence" y "demonstrated" DEBEN ser "".
- si "status" es "covered": "missingDetail" DEBE ser "".
- si "status" es "partial": "evidence" Y "demonstrated" DEBEN ser no vacíos, Y "missingDetail" DEBE ser no vacío (describe exactamente qué falta).
La colección targetCoverage DEBE contener exactamente ${batch.length} elementos y estos targetId, una sola vez cada uno: ${batch.map(target => target.id).join(', ')}.
No inventes ningún target id que no esté en el MATERIAL. Responde EXCLUSIVAMENTE JSON, sin markdown ni comentarios.`,
        },
        {
          role: 'user',
          content: `MATERIAL:\n"""\n${batchText}\n"""\n\nEXPLICACIÓN DEL ESTUDIANTE:\n"""\n${explanation}\n"""\n\nDevuelve EXACTAMENTE:\n{"targetCoverage": [{"targetId": "", "status": "covered | partial | missing | incorrect", "evidence": "", "demonstrated": "", "missingDetail": ""}]}`,
        },
      ],
      normalize: value => value,
      validate: value => {
        const errors: string[] = [];
        if (!Array.isArray((value as any)?.targetCoverage)) errors.push('STRUCTURAL_VALIDATION_FAILED:batch_coverage');
        return { valid: errors.length === 0, errors };
      },
      // A truncated/malformed response now salvages whatever complete
      // targetCoverage entries it managed to produce instead of the
      // ENTIRE batch silently collapsing to "[]" (-> every target in it
      // rendered "omitted", regardless of what the model actually judged).
      recoverableArrayKeys: ['targetCoverage'],
      telemetryContext: { route: 'review', phase: 'analysis_batch' },
      failurePath: 'single_repair',
      beforeProviderAttempt: () => {
        if (!providerBudget) return;
        if (providerBudget.consumed >= providerBudget.maximum) {
          throw new Error('REPASAR_COVERAGE_PROVIDER_BUDGET_EXHAUSTED');
        }
        providerBudget.consumed += 1;
      },
    });
    if (process.env.NODE_ENV !== 'production') {
      const coverage = Array.isArray(parsed.targetCoverage) ? parsed.targetCoverage : [];
      console.info('[repasar-coverage-batch-raw]', JSON.stringify({
        batchSize: batch.length,
        returned: coverage.length,
        sample: coverage.slice(0, 5).map((entry: any) => ({
          targetId: entry?.targetId, status: entry?.status, evidence: entry?.evidence,
          demonstrated: entry?.demonstrated, missingDetail: entry?.missingDetail,
        })),
      }));
    }
    return Array.isArray(parsed.targetCoverage) ? parsed.targetCoverage : [];
  } catch {
    return [];
  }
}

// GENERAL SEMANTIC-CONSISTENCY INVARIANT (not chemistry-specific, not a
// merge): the model's own accepted verdict for a target cannot claim
// "missing" — literally zero evidence — while ALSO supplying a
// non-trivial `evidence`/`demonstrated` string proving the student said
// something real about that exact target. Symmetrically, "partial" credit
// requires BOTH real evidence AND a genuinely outstanding missing detail
// — a "partial" with no missing detail is fully demonstrated ("covered"),
// and a "partial" with no real evidence is not credit at all ("missing").
// These are internal contradictions in the model's own structured output,
// never legitimate verdicts, so they are deterministically reconciled —
// never inventing "covered" from a status the model didn't accept, only
// resolving the model's OWN self-contradictory field combinations. A
// target with genuinely empty evidence stays "missing" exactly as before
// (e.g. Kp when the student never mentions it at all); "incorrect" is
// left untouched (a wrong claim is its own field-consistency contract,
// not covered by these three states).
const MIN_MEANINGFUL_EVIDENCE_CHARS = 6;
interface ReconciledRepasarCoverageEntry {
  targetId: string;
  status: RepasarCoverageStatus;
  evidence: string;
  demonstrated: string;
  missingDetail: string;
}
function reconcileCoverageEvidenceInvariant(entry: RawRepasarCoverageEntry): ReconciledRepasarCoverageEntry {
  const evidence = String(entry.evidence || '').trim();
  const demonstrated = String(entry.demonstrated || '').trim();
  const missingDetail = String(entry.missingDetail || '').trim();
  const hasRealEvidence = evidence.length >= MIN_MEANINGFUL_EVIDENCE_CHARS
    || demonstrated.length >= MIN_MEANINGFUL_EVIDENCE_CHARS;

  let status = entry.status;
  if (status === 'missing' && hasRealEvidence) {
    // The model said "missing" but also proved the student demonstrated
    // something real — trust the evidence, not the label. Whether that
    // becomes "covered" or "partial" depends on whether anything is
    // actually still missing.
    status = missingDetail ? 'partial' : 'covered';
  } else if (status === 'partial' && !hasRealEvidence) {
    // "Partial" credit for a target with no real evidence is not credit.
    status = 'missing';
  } else if (status === 'partial' && !missingDetail) {
    // Nothing flagged as outstanding — fully demonstrated, not partial.
    status = 'covered';
  }

  return {
    targetId: entry.targetId,
    status,
    evidence: status === 'missing' ? '' : evidence,
    demonstrated: status === 'missing' ? '' : demonstrated,
    // "missingDetail" ("Falta: ...") only ever makes sense for a target
    // that WAS partially demonstrated — a "missing" target has nothing
    // partial to describe (the whole thing is absent), and a "covered"
    // target has nothing outstanding either. Only "partial"/"incorrect"
    // may carry it, preventing a stray detail string from leaking into a
    // UI card that must render as plain "no aparecieron".
    missingDetail: (status === 'covered' || status === 'missing') ? '' : missingDetail,
  };
}

const VALID_COVERAGE_STATUSES = new Set<RepasarCoverageStatus>(['covered', 'partial', 'missing', 'incorrect']);

export interface RepasarCoverageResolution {
  /** true only when EVERY canonical target id has an explicit verdict. */
  ok: boolean;
  /** Adjudicated verdicts, in canonical Enjoyer source order. Always the
   *  full set the resolver managed to obtain, even when !ok — good work
   *  is never thrown away, only reported alongside what is still open. */
  verdicts: ReconciledRepasarCoverageEntry[];
  /** Present only when !ok — target ids that never received a valid
   *  verdict from the provider after every retry round. These are
   *  TRANSPORT-unadjudicated, never academic "missing": they must NEVER
   *  be written into a persisted domainMap/score as though the student
   *  failed to demonstrate them. */
  unadjudicatedTargetIds?: string[];
}

export interface RepasarCoverageBatchSemanticResult {
  accepted: ReconciledRepasarCoverageEntry[];
  unresolvedTargetIds: string[];
  rejectedReasons: string[];
}

/** Repaso-specific semantic boundary. The generic generation pipeline only
 * validates the JSON wrapper; this function decides which canonical target
 * adjudications are safe to retain. Invalid/duplicate/forged entries never
 * become academic `missing` and never overwrite an accepted verdict. */
export function validateRepasarCoverageBatchSemantics(
  requestedTargetIds: readonly string[],
  rawEntries: readonly RawRepasarCoverageEntry[],
): RepasarCoverageBatchSemanticResult {
  const requested = new Set(requestedTargetIds);
  const occurrences = new Map<string, number>();
  const rejectedReasons = new Set<string>();

  for (const raw of rawEntries) {
    const targetId = String(raw?.targetId || '').trim();
    if (!targetId) {
      rejectedReasons.add('missing_target_id');
      continue;
    }
    occurrences.set(targetId, (occurrences.get(targetId) || 0) + 1);
    if (!requested.has(targetId)) rejectedReasons.add('forged_target_id');
  }

  const accepted: ReconciledRepasarCoverageEntry[] = [];
  const acceptedIds = new Set<string>();
  for (const raw of rawEntries) {
    const targetId = String(raw?.targetId || '').trim();
    if (!requested.has(targetId)) continue;
    if ((occurrences.get(targetId) || 0) !== 1) {
      rejectedReasons.add('duplicate_target_id');
      continue;
    }
    if (!VALID_COVERAGE_STATUSES.has(raw?.status)) {
      rejectedReasons.add('invalid_status');
      continue;
    }
    accepted.push(reconcileCoverageEvidenceInvariant({
      targetId,
      status: raw.status,
      evidence: raw.evidence,
      demonstrated: raw.demonstrated,
      missingDetail: raw.missingDetail,
    }));
    acceptedIds.add(targetId);
  }

  const unresolvedTargetIds = requestedTargetIds.filter(id => !acceptedIds.has(id));
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) rejectedReasons.add('empty_adjudication_array');
  if (unresolvedTargetIds.length > 0 && rawEntries.length > 0) rejectedReasons.add('incomplete_target_set');
  return { accepted, unresolvedTargetIds, rejectedReasons: [...rejectedReasons] };
}

function splitCoverageTargets(targets: readonly RepasarReviewTarget[]): RepasarReviewTarget[][] {
  if (targets.length <= 1) return [targets.slice()];
  const midpoint = Math.ceil(targets.length / 2);
  return [targets.slice(0, midpoint), targets.slice(midpoint)];
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await work(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Adaptively adjudicates the ENTIRE canonical Enjoyer target universe for
 * this attempt — whatever its size (1, 10, 51, 150, 1000...). Loops in
 * deterministic, bounded splitting: the initial fixed-size batches run in
 * parallel; only unresolved ids from an incomplete batch are split into
 * smaller children for at most REPASAR_MAX_FALLBACK_SPLIT_DEPTH levels.
 *
 * Two distinct meanings of "missing" are kept structurally separate
 * throughout: a provider verdict of status:"missing" (ACADEMIC missing —
 * the student gave no evidence) only ever enters `verdicts`; a target the
 * provider never returned a verdict for at all (TRANSPORT/unadjudicated
 * — the provider failed to answer for it) can only ever end up in
 * `unadjudicatedTargetIds`, never silently defaulted into a "missing"
 * verdict. The caller (POST handler) must refuse to build/persist a
 * domainMap when `!ok` — see REPASAR_COVERAGE_INCOMPLETE_RETRYABLE.
 */
export async function resolveRepasarCoverage(
  targets: readonly RepasarReviewTarget[],
  groundedContext: RepasarGroundedContext,
  explanation: string,
): Promise<RepasarCoverageResolution> {
  const orderedIds = targets.map(target => target.id);
  const adjudicated = new Map<string, ReconciledRepasarCoverageEntry>();
  const initialBatches = chunkRepasarTargets(targets as RepasarReviewTarget[], REPASAR_TARGET_BATCH_SIZE);
  const providerBudget: RepasarCoverageProviderBudget = {
    consumed: 0,
    maximum: Math.max(1, initialBatches.length) * REPASAR_MAX_PROVIDER_CALLS_PER_INITIAL_BATCH,
  };

  const evaluate = async (batch: RepasarReviewTarget[], depth: number, attempt: number) => {
    const requestedIds = batch.map(target => target.id);
    const raw = await evaluateRepasarCoverageBatch(batch, groundedContext, explanation, providerBudget);
    const semantic = validateRepasarCoverageBatchSemantics(requestedIds, raw);
    for (const verdict of semantic.accepted) {
      if (!adjudicated.has(verdict.targetId)) adjudicated.set(verdict.targetId, verdict);
    }
    const unresolved = batch.filter(target => !adjudicated.has(target.id));
    console.info('[repasar-coverage-semantic]', JSON.stringify({
      requestedCount: requestedIds.length,
      requestedIds,
      rawParsedCount: raw.length,
      acceptedCount: semantic.accepted.length,
      acceptedIds: semantic.accepted.map(entry => entry.targetId),
      unresolvedCount: unresolved.length,
      unresolvedIds: unresolved.map(target => target.id),
      rejectedReasons: semantic.rejectedReasons,
      splitDepth: depth,
      attempt,
      providerCallsConsumed: providerBudget.consumed,
      providerCallBudget: providerBudget.maximum,
    }));
    return unresolved;
  };

  const initialUnresolved = await Promise.all(
    initialBatches.map((batch, index) => evaluate(batch, 0, index + 1)),
  );
  let frontier = initialUnresolved.flatMap(unresolved => unresolved.length ? splitCoverageTargets(unresolved) : []);

  for (let depth = 1; depth <= REPASAR_MAX_FALLBACK_SPLIT_DEPTH && frontier.length > 0; depth++) {
    console.info('[repasar-coverage-fallback-split]', JSON.stringify({
      depth,
      batchSizes: frontier.map(batch => batch.length),
      fallbackBatchCount: frontier.length,
      providerCallsConsumed: providerBudget.consumed,
      providerCallBudget: providerBudget.maximum,
    }));
    const unresolvedGroups = await mapWithConcurrency(
      frontier,
      REPASAR_FALLBACK_CONCURRENCY,
      (batch, index) => evaluate(batch, depth, index + 1),
    );
    frontier = depth < REPASAR_MAX_FALLBACK_SPLIT_DEPTH
      ? unresolvedGroups.flatMap(unresolved => unresolved.length ? splitCoverageTargets(unresolved) : [])
      : [];
  }

  // Canonical Enjoyer source order, regardless of batch/round/provider
  // response ordering.
  const verdicts = orderedIds.filter(id => adjudicated.has(id)).map(id => adjudicated.get(id)!);
  const unadjudicatedTargetIds = orderedIds.filter(id => !adjudicated.has(id));
  if (unadjudicatedTargetIds.length > 0) {
    return { ok: false, verdicts, unadjudicatedTargetIds };
  }
  return { ok: true, verdicts };
}

// DISPLAY PRIORITIES — a small, UI-sized subset of the domain map,
// never the source of truth for coverage/score (those are computed over
// the FULL academic universe above). Ranks by importance tier so a
// large material's "top gaps"/"top strengths" surface the concepts that
// actually matter, not an arbitrary first-N slice.
const TIER_RANK: Record<string, number> = { critical: 0, supporting: 1, contextual: 2 };
function buildRepasarDisplayPriorities(
  targets: readonly { id: string; label: string; importanceTier: string }[],
  domainMap: RepasarDomainMap,
  limit = 8,
) {
  const byTier = (a: { importanceTier: string }, b: { importanceTier: string }) =>
    (TIER_RANK[a.importanceTier] ?? 3) - (TIER_RANK[b.importanceTier] ?? 3);
  const gaps = targets
    .filter(t => domainMap.statusByTargetId[t.id] && domainMap.statusByTargetId[t.id] !== 'demonstrated_correct')
    .sort(byTier)
    .slice(0, limit)
    .map(t => ({ id: t.id, label: t.label, importanceTier: t.importanceTier, status: domainMap.statusByTargetId[t.id] }));
  const strengths = targets
    .filter(t => domainMap.statusByTargetId[t.id] === 'demonstrated_correct')
    .sort(byTier)
    .slice(0, limit)
    .map(t => ({ id: t.id, label: t.label, importanceTier: t.importanceTier }));
  return { gaps, strengths };
}

function levelFromScore(score: number) {
  if (score >= 90) return '🏆 Dominio completo';
  if (score >= 75) return '🎓 Listo para practicar examen';
  if (score >= 55) return '📗 Comprensión sólida';
  if (score >= 35) return '📘 Comprensión básica';
  return '🌱 Idea inicial';
}

function masteryStage(score: number) {
  if (score >= 90) return 'dominio_completo';
  if (score >= 75) return 'listo_para_examen';
  if (score >= 55) return 'comprension_solida';
  if (score >= 35) return 'comprension_basica';
  return 'idea_inicial';
}

// ============================================================
// "PROFESSOR PAPER" LETTER GRADE — pure, deterministic representation of
// the ALREADY-canonical Repaso score. Never a second source of truth:
// the score itself is still 100% computed by calibrateRepasarScore <-
// computeRepasarMastery <- the canonical domainMap. This function only
// LABELS that number the way a graded paper would; it does not, and must
// never, let a provider assign a letter directly.
// ============================================================
export const REPASO_LETTER_GRADE_SCALE: { min: number; letter: string }[] = [
  { min: 97, letter: 'A+' }, { min: 93, letter: 'A' }, { min: 90, letter: 'A-' },
  { min: 87, letter: 'B+' }, { min: 83, letter: 'B' }, { min: 80, letter: 'B-' },
  { min: 77, letter: 'C+' }, { min: 73, letter: 'C' }, { min: 70, letter: 'C-' },
  { min: 60, letter: 'D' }, { min: 0, letter: 'F' },
];

export function computeRepasoLetterGrade(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  return REPASO_LETTER_GRADE_SCALE.find(band => clamped >= band.min)?.letter || 'F';
}


interface RepasarInitialQualityResult {
  parsed: any
  qualityFrac: number
  mastery: RepasarMastery
  score: number
  letterGrade: string
}

async function evaluateRepasarInitialQuality(args: {
  materia: string
  tema: string
  mode: RepasarReader
  selectedMode: {
    persona: string
    scoringGuide: string
    strictness: string
  }
  previousWeakConcepts: string[]
  sourceConceptMap: {
    concept: string
    importance: string
    canonicalStatus: 'mastered' | 'progress' | 'weak'
    canonicalEvidence: string
    canonicalMissingDetail: string
  }[]
  masteryContext: any
  materialText: string
  notes: string
  explanation: string
  domainMap: RepasarDomainMap
}): Promise<RepasarInitialQualityResult> {
  const {
    materia,
    tema,
    mode,
    selectedMode,
    previousWeakConcepts,
    sourceConceptMap,
    masteryContext,
    materialText,
    notes,
    explanation,
    domainMap,
  } = args

// Compact, bounded evidence summary injected into the feedback
    // prompt below — real numbers so the persona's narrative/summary
    // cannot contradict the deterministic metrics (mission: "profesor
    // decía dominio excepcional con 28% de cobertura real").
    const canonicalEvidenceSummary = `
COBERTURA ACADÉMICA REAL YA CALCULADA (NO la contradigas ni inventes otra):
- Total de targets del material: ${domainMap.totalAcademicTargets}
- Demostrados correctamente: ${domainMap.demonstratedCorrect}
- Demostrados parcialmente: ${domainMap.demonstratedPartial}
- Demostrados incorrectamente: ${domainMap.demonstratedIncorrect}
- No abordados en la explicación: ${domainMap.omitted}
- Cobertura: ${domainMap.coveragePercent}%
Tu feedback/summary/mainIssue DEBE ser consistente con estos números. Si la
cobertura es menor a 60%, NO uses frases como "dominio excepcional",
"comprensión completa/total" o "cobertura completa del material" — en su
lugar reconoce explícitamente que una parte del material no fue abordada,
aunque elogies con sinceridad la calidad de lo que SÍ explicó.`;

    const parsed: any = await __routeDeps.generateValidatedLegacyJson({
      taskType: 'summary',
      temperature: 0.22,
      // 3000 was structurally too tight: the prompt requires ONE
      // targetCoverage entry per material TARGET (unbounded — grows with
      // material size) PLUS conceptStatus PLUS the repair object PLUS
      // feedback/nextStep. For a real multi-page material this routinely
      // exceeds 3000 tokens mid-array, producing a truncated (unbalanced)
      // JSON object — deterministic INVALID_JSON on every retry, since
      // retries don't reduce the requested cardinality. Raised to match/
      // exceed sibling large-structured-output calls (exam: 4200-5500).
      maxTokens: 6000,
      messages: [
        {
          role: 'system',
          content: `
Eres un tutor pedagógico experto de StudyAL.

Evalúas comprensión real para un modo de repaso activo.
El estudiante NO está escribiendo un ensayo: está diciendo lo que recuerda y entendió después de leer.

PRINCIPIO CENTRAL — EVALÚA EVIDENCIA, NO OMISIONES:
Tu primera pregunta SIEMPRE es "¿qué demuestra esta respuesta que el
estudiante entiende?" — recién después preguntas "¿qué conocimiento
IMPORTANTE sigue faltando?". Nunca al revés.
Una explicación libre NO es un examen de cobertura literal del documento.
No esperamos que el estudiante reproduzca el 100% del material para
demostrar comprensión real — esperamos que demuestre que entendió la
tesis/idea central y sus relaciones principales, con sus propias palabras.
"¿Qué frases del material no mencionó?" NUNCA es la pregunta que guía el
score o el conceptStatus — es un antipatrón que confunde COMPRENSIÓN con
COBERTURA EXHAUSTIVA.
Tampoco al revés: mencionar muchas palabras clave del material SIN
explicarlas ni conectarlas no demuestra comprensión — eso es reconocimiento
superficial, no dominio, y no debe producir un score alto ni un
conceptStatus "mastered".

REGLA CENTRAL:
No califiques como 0 solo porque faltan conceptos.
Un 0 solo aplica si la respuesta está vacía, no tiene relación con el material, o contradice casi todo.
Si la explicación menciona ideas correctas aunque sea incompleta, debe recibir crédito real.
Acepta paráfrasis: si el estudiante explica un concepto correctamente CON
SUS PROPIAS PALABRAS pero sin usar el término técnico exacto, eso SÍ cuenta
como comprensión — nunca lo trates como si no lo supiera solo por el
wording. El lector puede valorar más o menos la precisión terminológica
(ver criterio por lector), pero ningún lector debe declarar "no lo sabe"
frente a una paráfrasis semánticamente correcta.

NO acepto scoring mediocre:
- Una respuesta con una idea correcta no puede recibir 0, 5 u 8.
- Si das un score bajo, explica exactamente qué faltó y qué sí entendió.
- El feedback debe servirle al estudiante para mejorar, no solo juzgarlo.
- No evalúes como ensayo. Evalúa como repaso activo.

Evalúa:
- qué ideas correctas sí entendió
- qué ideas importantes omitió
- qué conexiones todavía no hizo
- qué errores o confusiones aparecen
- qué debería corregir en el siguiente intento

Repasar es ADAPTATIVO:
Después del feedback, genera preguntas de seguimiento específicas para mejorar el siguiente intento.
Las preguntas deben atacar conceptos débiles, omisiones o relaciones no explicadas.
No hagas preguntas triviales ni genéricas.

Evalúa SOLO desde el lector seleccionado en MODO DE EXPLICACIÓN.
No evalúes con todos los lectores a la vez.

Criterio por lector — el lector cambia PROFUNDIDAD esperada, RIGOR,
LENGUAJE y calidad de conexiones exigidas. El lector NUNCA cambia: los
hechos del material, qué cuenta como comprensión real, el universo de
conceptos, ni convierte un detalle secundario en requisito absoluto. Una
respuesta correcta sigue siendo correcta para los 4 lectores — lo que
cambia es cuánta profundidad/precisión hace falta para llegar a cada banda
de la guía de puntaje.
- nino: prioriza idea central, lenguaje simple, claridad. Sé amable. No exijas términos técnicos ni detalles secundarios.
- universitario: prioriza comprensión académica, orden, conceptos clave y relaciones. Estricto moderado.
- profesor: prioriza rigor, precisión, relaciones/causalidad y profundidad — nunca cobertura literal del documento. Estricto alto EN PROFUNDIDAD, no en exigir que se repita cada dato.
- libre: prioriza utilidad global, claridad, estructura. Evalúa la evidencia presente tal cual, sin adaptar el estándar hacia arriba ni hacia abajo.

GUÍA DE PUNTAJE DEL LECTOR SELECCIONADO:
${selectedMode.scoringGuide}

OBLIGATORIO:
El score, reviewer.rating y feedback deben cambiar según el lector seleccionado.
La misma respuesta NO debe recibir el mismo puntaje como niño, universitario y profesor.
Para niño, premia mucho más la idea central.
Para profesor, exige mucho más precisión y conexiones.

El feedback debe ser MUY fácil de entender:
- frases cortas
- directo al punto
- cero lenguaje genérico
- explica qué recordó, qué entendió y qué olvidó
- no suenes como rúbrica genérica
- habla como el lector seleccionado
- el score NO debe ser el centro; el centro es ayudar a estudiar
- NUNCA escribas un número de puntaje (p.ej. "el puntaje es 35" o "30/100")
  dentro de summary/mainIssue/scoreReason/feedback/nextStep/reviewer — el
  score final se calibra aparte y narrar un número ahí puede contradecirlo

El usuario no necesita sentirse castigado.
Primero valida lo que sí recordó.
Luego muestra vacíos concretos.
Luego dile exactamente qué repasar y cómo mejorar.

DEFINICIÓN DE "status" EN conceptStatus (aplica igual a los 4 lectores; el
lector solo cambia CUÁNTA profundidad hace falta para llegar a "mastered"):

"mastered": el estudiante demuestra comprensión correcta y suficiente del
NÚCLEO del concepto. NO necesita: mencionar cada supporting detail, usar
las mismas palabras del material, enumerar todos los ejemplos, ni repetir
contexto obvio (nombres, fechas, lugares). Puede haber detalles
adicionales que mejorar y seguir siendo "mastered".

"progress": hay evidencia REAL de comprensión, pero falta una parte
CENTRAL necesaria para demostrar el concepto — no basta con que falte
cualquier detalle secundario para bajarlo a "progress". "Podría
profundizar más" NO es automáticamente "progress" si el núcleo ya está
demostrado — en ese caso es "mastered" (y el detalle que falta va en
"missing" como profundización opcional, no como carencia).

"weak": el concepto está ausente, es incorrecto, está contradicho, o se
menciona tan superficialmente (p.ej. solo nombrando la palabra clave sin
explicarla) que no demuestra comprensión real.

Para cada item de "conceptStatus" completa:
- "said": qué dijo el estudiante sobre ESE concepto, corto (una frase, cita
  o paráfrasis breve). Vacío si no lo mencionó.
- "missing": SOLO si status es "progress" o "weak", qué falta del NÚCLEO,
  corto y concreto, basado en el MATERIAL (no inventes). Si status es
  "mastered" y hay algo interesante para profundizar (no una carencia),
  puedes usar "missing" para ESO — se muestra como sugerencia opcional,
  nunca como algo que faltó. Vacío si no aplica.
No escribas párrafos largos en said/missing — son para una tarjeta corta.

"importance" de cada concepto — 3 niveles, genéricos (nunca dependen del
tema del documento):
- "critical": indispensable para comprender la TESIS o tesis/tema central.
  Su ausencia SÍ demuestra una deficiencia fundamental. Normalmente 0-2
  conceptos son "critical" en todo el material — es la excepción, no la
  regla. Un dato contextual importante (nombre, lugar, fecha, marco donde
  ocurre algo) NO se vuelve "critical" solo por parecer relevante.
- "supporting": enriquece o profundiza el núcleo, pero omitirlo no
  invalida la comprensión del concepto central. La mayoría de los
  conceptos "supporting" caen acá.
- "contextual": nombres propios, fechas, lugares, marcos, ejemplos —
  pueden ser relevantes pero normalmente NO determinan por sí solos el
  dominio global. Ejemplo abstracto: si alguien explica perfectamente un
  mecanismo pero omite repetir el nombre completo de la asignatura o el
  año en que ocurrió algo, eso NO destruye su comprensión del mecanismo.

Si el prompt incluye una sección "CONCEPTOS FIJOS DEL MATERIAL", el universo
de conceptStatus ya está definido — evalúa el estado de CADA uno de esos
para este intento, sin agregar ni quitar ninguno, sin importar el lector.

También debes generar "teachMissing": una mini clase corta SOLO de lo que
olvidó (explicación simple, ejemplo, analogía si ayuda). Es puramente
pedagógica — NUNCA es el rubric de verificación.

También debes generar "repair": el objeto ÚNICO y canónico de la
reparación de este intento, generado en esta misma pasada:
- "question": la pregunta exacta que se le mostrará al estudiante para que
  demuestre que ya entendió lo que le faltó.
- "topicLabel": una etiqueta CORTA (2-6 palabras) del área general que
  cubre esta reparación (p.ej. "Grandeza de los Falcons más allá de
  trofeos"). Es lo ÚNICO que se le muestra al estudiante como pista visual
  — NUNCA enumeres ahí los sub-conceptos o hechos, eso le regalaría la
  respuesta antes de intentarlo.
- "targetConcepts": 1 a 3 nombres de concepto (deben coincidir con los
  usados en conceptStatus) que esta pregunta evalúa. Uso interno, nunca se
  le muestra al estudiante.
- "requiredFacts": hechos del MATERIAL que la respuesta DEBE cubrir para
  pasar. Sé preciso: si son 3, requiredFacts debe tener EXACTAMENTE 3
  elementos, ni más ni menos. Nunca se le muestra al estudiante.
- "optionalFacts": hechos relacionados pero no obligatorios para pasar.
- "targetIds": los TARGET ids (de los bloques "[TARGET <id>]" del MATERIAL)
  que esta reparación enseña — deben ser EXACTAMENTE los targets que
  marcaste como "missing" o "incorrect" en "targetCoverage" para este
  intento. NUNCA incluyas un target que marcaste "covered", y NUNCA
  inventes un id que no exista en el MATERIAL.
REGLA DE CARDINALIDAD: si "question" menciona un número (p.ej. "los tres
pilares", "los dos criterios"), ese número DEBE ser exactamente
requiredFacts.length. Si no puedes garantizar el número exacto, usa una
pregunta abierta sin cardinal fijo (p.ej. "¿Qué aspectos... según el
texto?"). "question", "topicLabel", "targetConcepts" y "requiredFacts"
deben describir EXACTAMENTE el mismo objetivo — nunca generes una pregunta
sobre un tema y luego hechos requeridos sobre otro. En la corrección
(teach-check) SOLO se exigen los requiredFacts de este mismo objeto —
jamás otro hecho del material, aunque sea verdadero.

Nunca inventes contenido fuera del material.

COBERTURA — TARGETS AUTORIZADOS:
El MATERIAL de abajo está dividido en bloques "[TARGET <id>]" — cada uno es
una unidad de conocimiento real y autorizada del material. Para CADA
TARGET que aparezca, decide si la explicación del estudiante lo cubrió,
en "targetCoverage". "status" es "covered" (el estudiante demostró
comprensión real de ese target, aunque sea con otras palabras), "partial"
(lo menciona pero de forma incompleta, vaga o superficial — ni ausente ni
plenamente demostrado), "missing" (no lo mencionó / no lo demostró — esto
es SOLO ausencia, nunca lo trates como un error) o "incorrect" (lo
mencionó pero de forma equivocada o contradictoria).
NUNCA agregues un targetId que no exista en la lista de TARGETs de abajo
— si lo haces, se ignora por completo. NUNCA marques "covered" solo
porque el estudiante mencionó información correcta que NO aparece en
ningún TARGET (conocimiento externo, aunque sea verdadero, no cuenta
para cobertura). Esta es la única fuente de verdad para cobertura — el
servidor la usa para calcular el porcentaje real, no lo hagas tú.
Devuelve SOLO JSON válido.
`,
        },
        {
          role: 'user',
          content: `
MATERIA:
${materia}

TEMA:
${tema}

MODO DE EXPLICACIÓN:
${mode}

LECTOR SELECCIONADO:
${selectedMode.persona}

NIVEL DE EXIGENCIA:
${selectedMode.strictness}

CONCEPTOS DÉBILES PREVIOS:
${previousWeakConcepts.join(', ') || 'Ninguno'}

${sourceConceptMap.length ? `
CONCEPTOS FIJOS DEL MATERIAL (usa EXACTAMENTE estos ${sourceConceptMap.length}, no agregues ni quites ninguno, sin importar el lector):
${sourceConceptMap.map((c: any) => `- ${c.concept}`).join('\n')}
` : ''}

${masteryContext ? `
PERFIL DEL ESTUDIANTE (ADAPTA TU EVALUACIÓN A ESTO):
- Dominio general: ${masteryContext.overallMastery}%
- Comprensión: ${masteryContext.understanding}% | Memoria: ${masteryContext.memory}% | Aplicación: ${masteryContext.application}%
- Perfil: ${masteryContext.studentProfile}
- Conceptos críticos (< 20%): ${masteryContext.criticalConcepts?.join(', ') || 'Ninguno'}
- Conceptos débiles (< 40%): ${masteryContext.weakConcepts?.join(', ') || 'Ninguno'}
- Conceptos dominados: ${masteryContext.strongConcepts?.join(', ') || 'Ninguno'}

INSTRUCCIÓN ADAPTATIVA:
${masteryContext.studentProfile === 'beginner' ? 'El estudiante es principiante. Evalúa si mencionó los conceptos básicos. Sé generoso con el puntaje si muestra comprensión básica.' : ''}
${masteryContext.studentProfile === 'memorizer' ? 'El estudiante memoriza pero no conecta. Penaliza si solo enumera sin explicar relaciones entre conceptos.' : ''}
${masteryContext.studentProfile === 'understander' ? 'El estudiante entiende pero no recuerda detalles. Evalúa si captó las ideas principales aunque olvide detalles menores.' : ''}
${masteryContext.studentProfile === 'applier' ? 'El estudiante aplica pero no explica bien. Evalúa si puede transferir el conocimiento a ejemplos nuevos.' : ''}
${masteryContext.studentProfile === 'advanced' ? 'El estudiante está avanzado. Sé exigente. Penaliza si no conecta conceptos o no muestra profundidad.' : ''}

ENFOCA EL ANÁLISIS EN:
${masteryContext.criticalConcepts?.length ? `- Verificar especialmente si mencionó: ${masteryContext.criticalConcepts.slice(0, 3).join(', ')}` : ''}
${masteryContext.weakConcepts?.length ? `- Detectar si confundió: ${masteryContext.weakConcepts.slice(0, 3).join(', ')}` : ''}
${masteryContext.strongConcepts?.length ? `- No penalizar si omitió: ${masteryContext.strongConcepts.slice(0, 3).join(', ')} (ya los domina)` : ''}
` : ''}

MATERIAL:
"""
${materialText}
"""

NOTAS DEL ESTUDIANTE:
"""
${notes || 'Sin notas'}
"""

EXPLICACIÓN DEL ESTUDIANTE:
"""
${explanation}
"""
${canonicalEvidenceSummary}

Devuelve EXACTAMENTE este JSON:

{
  "score": 0,
  "level": "",
  "masteryStage": "",
  "summary": "",
  "mainIssue": "",
  "scoreReason": "",
  "estimatedNextScore": 0,
  "studyBreakdown": {
    "remembered": 0,
    "explained": 0,
    "missing": 0
  },
  "reviewer": {
    "persona": "${selectedMode.persona}",
    "rating": 0,
    "verdict": "",
    "feedback": "",
    "wouldUnderstand": false,
    "missingForThem": []
  },
  "conceptStatus": [
    {
      "concept": "",
      "status": "mastered | progress | weak",
      "importance": "critical | supporting | contextual",
      "note": "",
      "said": "",
      "missing": ""
    }
  ],
  "strengths": [],
  "missingConcepts": [],
  "confusions": [],
  "weakConcepts": [],
  "actions": [
    {
      "title": "",
      "detail": ""
    }
  ],
  "teachMissing": {
    "title": "",
    "explanation": "",
    "example": "",
    "analogy": ""
  },
  "repair": {
    "question": "",
    "topicLabel": "",
    "targetConcepts": [],
    "requiredFacts": [],
    "optionalFacts": [],
    "targetIds": []
  },
  "targetCoverage": [
    { "targetId": "", "status": "covered | partial | missing | incorrect" }
  ],
  "feedback": "",
  "nextStep": ""
}
`,
        },
      ],
      normalize: value => value,
      validate: value => {
        const record = value as any
        const errors: string[] = []
        if (!Number.isFinite(Number(record?.score))) errors.push('STRUCTURAL_VALIDATION_FAILED:review_score')
        if (!String(record?.feedback || record?.summary || '').trim()) errors.push('STRUCTURAL_VALIDATION_FAILED:review_feedback')
        if (record?.repair && typeof record.repair !== 'object') errors.push('STRUCTURAL_VALIDATION_FAILED:review_repair')
        return { valid: errors.length === 0, errors }
      },
      telemetryContext: { route: 'review', phase: 'analysis', mode },
    });

    const qualityFrac = cleanScore(parsed.score) / 100;
    const mastery = computeRepasarMastery(domainMap, qualityFrac);
    const score = calibrateRepasarScore({ explanation, mastery });

  return {
    parsed,
    qualityFrac,
    mastery,
    score,
    letterGrade: computeRepasoLetterGrade(score),
  }
}

function repasoCoverageFromStates(states: Readonly<Record<string, RepasoTargetState>>) {
  return Object.values(states).map(state => ({
    targetId: state.targetId,
    status: state.status,
    evidence: state.evidence,
    demonstrated: state.demonstrated,
    missingDetail: state.missingDetail,
  }))
}

/**
 * `nonAssessableTargetIds` (system coverage failures, never a student
 * mastery failure — see `RepasoArtifact.nonAssessableTargetIds`) are
 * excluded from the Score v2 denominator entirely: they can never be
 * demonstrated, so counting them against the student would be a
 * permanent, unrepairable score penalty for something StudyAL itself
 * could not validly require. The target's own state is untouched —
 * only which targets the CURRENT canonical score is computed over.
 */
function repasoScore(
  targets: readonly RepasarReviewTarget[],
  states: Readonly<Record<string, RepasoTargetState>>,
  nonAssessableTargetIds?: ReadonlySet<string>,
) {
  const assessableTargets = nonAssessableTargetIds?.size
    ? targets.filter(target => !nonAssessableTargetIds.has(target.id))
    : targets
  const score = computeRepasoCanonicalScore(
    computeRepasarDomainMap(assessableTargets, repasoCoverageFromStates(states)),
  )
  return { score, letterGrade: computeRepasoLetterGrade(score) }
}

function repasoNonAssessableTargetIdSet(artifact: RepasoArtifact): ReadonlySet<string> {
  return new Set(artifact.nonAssessableTargetIds || [])
}

export interface RepasoDiagnosisFeedbackItem {
  targetId: string
  status: RepasarCoverageStatus
  title: string
  targetLabel: string
  demonstrated: string
  missing: string
  pages: number[]
  importance: 'critical' | 'supporting' | 'contextual'
  topicId: string | null
  topicTitle: string | null
}

const REPASO_DIAGNOSIS_STATUS_TITLE: Record<RepasarCoverageStatus, string> = {
  covered: 'Bien demostrado',
  partial: 'Parcial',
  missing: 'No lo explicaste todavía',
  incorrect: 'Hay que corregir esto',
}

/**
 * Deterministic, provider-free UI projection of one adjudicated target. The
 * student must never see a correction card whose only content is the raw
 * coverage status — every unresolved target gets a concrete, canonically
 * grounded explanation of what was expected, never general knowledge.
 */
export function projectRepasoDiagnosisFeedback(
  targetState: RepasoTargetState,
  canonicalTarget: RepasarReviewTarget | undefined,
): RepasoDiagnosisFeedbackItem {
  const label = canonicalTarget?.label?.trim() || targetState.targetId
  let missing = String(targetState.missingDetail || '').trim()
  if ((targetState.status === 'missing' || targetState.status === 'incorrect') && !missing) {
    // Live provider coverage legitimately returns status="missing" with all
    // evidence fields blank — a valid adjudication, but not useful UI copy
    // on its own. Derive concise pedagogical content strictly from canonical
    // target data, in priority order, never from outside/general knowledge.
    const statement = String(canonicalTarget?.statement || '').trim()
    const firstSpanQuote = (canonicalTarget?.sourceSpans || [])
      .map(span => String(span.quote || '').trim())
      .find(Boolean)
    missing = statement
      || (firstSpanQuote ? `${label}: ${firstSpanQuote}` : '')
      || `${label}.`
  }
  const pages = canonicalTarget?.pages?.length
    ? canonicalTarget.pages
    : (canonicalTarget?.page ? [canonicalTarget.page] : [])
  return {
    targetId: targetState.targetId,
    status: targetState.status,
    title: REPASO_DIAGNOSIS_STATUS_TITLE[targetState.status],
    targetLabel: label,
    demonstrated: String(targetState.demonstrated || '').trim(),
    missing,
    pages,
    importance: canonicalTarget?.importanceTier || 'contextual',
    topicId: canonicalTarget?.topicId ?? null,
    topicTitle: canonicalTarget?.topicTitle ?? null,
  }
}

function repasoArtifactView(artifact: RepasoArtifact, targets: readonly RepasarReviewTarget[]) {
  const nonAssessableTargetIds = repasoNonAssessableTargetIdSet(artifact)
  const current = repasoScore(targets, artifact.currentTargetStates, nonAssessableTargetIds)
  const masteryStatus = computeRepasoMasteryStatus(
    artifact.currentTargetStates,
    artifact.finalVerification,
    nonAssessableTargetIds,
  )
  const targetById = new Map(targets.map(target => [target.id, target]))
  return {
    artifactId: artifact.artifactId,
    initialPaper: {
      explanation: artifact.initial.explanation,
      score: artifact.initial.initialScore,
      letterGrade: artifact.initial.initialLetterGrade,
      annotations: Object.values(artifact.initial.initialTargetStates),
      feedback: Object.values(artifact.initial.initialTargetStates)
        .map(state => projectRepasoDiagnosisFeedback(state, targetById.get(state.targetId))),
    },
    score: current.score,
    letterGrade: current.letterGrade,
    masteryStatus,
    scoreHistory: artifact.scoreHistory,
    recoveryAttemptCount: artifact.recoveryAttempts.length,
    finalVerification: artifact.finalVerification,
    // ANTES VS. AHORA: the "after" side of the Before/After comparison
    // (Repaso Final Result) needs the SAME shape as `initialPaper.
    // annotations` but for current, post-Recovery canonical state —
    // deterministic, straight from the persisted artifact, never
    // recomputed or fabricated. `nonAssessableTargetIds` travels
    // alongside so the client excludes system-coverage-failure targets
    // from "remaining unresolved" the same way completion itself does.
    currentAnnotations: Object.values(artifact.currentTargetStates),
    nonAssessableTargetIds: artifact.nonAssessableTargetIds || [],
    studentEvidencePaper: masteryStatus === 'mastered'
      ? buildRepasoStudentEvidencePaper(artifact)
      : [],
  }
}

export interface RepasoRecoveryFeedback {
  status: 'correct' | 'partial' | 'incorrect' | 'missing'
  title: string
  summary: string
  demonstrated: string[]
  missing: string[]
  /** LO QUE HICISTE BIEN — alias of `demonstrated`, kept for clarity in new UI copy. */
  didWell: string[]
  /** LO QUE TE FALTÓ / QUÉ CORREGIR — alias of `missing`. */
  needsWork: string[]
  /** Only for status==='incorrect': the contradicted claim + canonical correction, per target. */
  correction: string[]
  /** CÓMO MEJORARLO — one concise, deterministic, actionable instruction. Empty when not applicable (covered/missing). */
  suggestion: string
  /**
   * UNA MEJOR FORMA DE EXPLICARLO — assembled ONLY from canonical target
   * propositions/evidence already used to ground the Recovery question.
   * Never populated for 'missing' (would leak the answer before restudy)
   * and left '' whenever there isn't enough canonical material to build one
   * — never fabricated.
   */
  betterExplanation: string
  /** PISTA — for status==='missing' only: points at the concept without revealing the answer. */
  hint: string
  /**
   * Non-blocking enrichment notes — supporting/contextual-tier canonical
   * detail the student didn't mention, surfaced only when the ESSENTIAL
   * (highest-tier) targets in the group were already satisfied. Never
   * forces another retry by itself.
   */
  enrichment: string[]
  /** Pages to revisit, when the current group provided them. */
  pages: number[]
  scoreBefore: number
  scoreAfter: number
  letterBefore: string
  letterAfter: string
  scoreChanged: boolean
  groupResolved: boolean
}

const REPASO_TIER_ORDER: Record<string, number> = { critical: 0, supporting: 1, contextual: 2 }

export function projectRepasoRecoveryFeedback(
  attempt: RepasoRecoveryAttempt,
  targets: readonly RepasarReviewTarget[] = [],
  pages: number[] = [],
  assessedTargetIds?: ReadonlySet<string>,
): RepasoRecoveryFeedback {
  const materialLanguage = targets[0]?.materialLanguage || 'es'
  const targetById = new Map(targets.map(target => [target.id, target]))
  const isAssessed = (targetId: string) => !assessedTargetIds || assessedTargetIds.has(targetId)
  const sortByTier = (a: RepasoTargetAdjudication, b: RepasoTargetAdjudication) => {
    const ta = targetById.get(a.targetId); const tb = targetById.get(b.targetId)
    return (REPASO_TIER_ORDER[ta?.importanceTier || 'contextual'] ?? 3) - (REPASO_TIER_ORDER[tb?.importanceTier || 'contextual'] ?? 3)
  }
  const allAdjudications = [...attempt.adjudications].sort(sortByTier)
  // Blocking status/title/didWell/needsWork/correction are derived ONLY from
  // targets the frozen QUESTION actually assessed — a sibling the question
  // never asked about can never keep the student stuck in retry, no matter
  // how canonically important that sibling might be.
  const adjudications = allAdjudications.filter(item => isAssessed(item.targetId))
  const supportingGaps = allAdjudications.filter(item => !isAssessed(item.targetId) && item.status !== 'covered')
  const statuses = adjudications.map(item => item.status)
  const allCovered = statuses.length > 0 && statuses.every(status => status === 'covered')
  const allMissing = statuses.length > 0 && statuses.every(status => status === 'missing')
  const status: RepasoRecoveryFeedback['status'] = allCovered
    ? 'correct'
    : allMissing
      ? 'missing'
      : statuses.includes('incorrect')
        ? 'incorrect'
        : 'partial'
  const title = materialLanguage !== 'es' ? academicVerdict(materialLanguage, status === 'correct' ? 'correct' : status === 'partial' ? 'partial' : 'incorrect') : status === 'correct' ? 'Excelente'
    : status === 'partial' ? 'Casi lo tienes'
      : status === 'incorrect' ? 'Todavía no'
        : 'Vamos a reforzarlo'
  const summary = materialLanguage !== 'es' ? title : status === 'correct' ? 'Demostraste correctamente esta parte.'
    : status === 'partial' ? 'Ya demostraste parte de esto — te falta precisión en un punto concreto.'
      : status === 'incorrect' ? 'Hay una idea que no coincide con el material; vamos a corregirla.'
        : 'Todavía no encontramos evidencia de esto en tu respuesta.'

  const labelFor = (targetId: string) => targetById.get(targetId)?.label?.trim() || targetId

  const demonstrated = [...new Set(adjudications
    .filter(item => item.status === 'covered' || item.status === 'partial')
    .map(item => {
      const text = String(item.demonstrated || item.evidence || '').trim()
      return text ? `${labelFor(item.targetId)}: ${text}` : ''
    })
    .filter(Boolean))]

  const missing = [...new Set(adjudications
    .filter(item => item.status !== 'covered')
    .map(item => {
      const text = String(item.missingDetail || '').trim()
      return text ? `${labelFor(item.targetId)}: ${text}` : ''
    })
    .filter(Boolean))]

  // A genuine correction identifies the contradicted claim (the student's
  // OWN evidence) alongside the canonical proposition — never a bare
  // "incorrecto" label, and never invented outside the target's own data.
  const correction = status === 'incorrect' ? [...new Set(adjudications
    .filter(item => item.status === 'incorrect')
    .map(item => {
      const target = targetById.get(item.targetId)
      const statement = String(target?.statement || '').trim()
      const said = String(item.evidence || '').trim()
      if (!statement) return ''
      if (materialLanguage !== 'es') return `${labelFor(item.targetId)}: ${said ? `${said} → ` : ''}${statement}`
      return said
        ? `${labelFor(item.targetId)}: escribiste "${said}", pero el material establece: ${statement}`
        : `${labelFor(item.targetId)}: el material establece: ${statement}`
    })
    .filter(Boolean))] : []

  const suggestion = materialLanguage !== 'es' ? (missing[0] || correction[0] || '') : status === 'partial'
    ? (missing.length
      ? `Vuelve a explicarlo agregando exactamente lo que falta: ${missing[0]}.`
      : 'Vuelve a explicarlo con más precisión sobre lo que ya demostraste.')
    : status === 'incorrect'
      ? (correction.length
        ? `Corrige la idea contradicha antes de continuar: ${correction[0]}.`
        : 'Corrige la idea contradicha antes de continuar.')
      : ''

  // The model explanation is built ONLY from canonical target propositions
  // already used to ground this Recovery question — never a new provider
  // call, never outside knowledge. For 'missing' it stays empty on purpose
  // (giving the full answer before restudy would defeat the exercise); it
  // is also left empty whenever no qualifying target has a usable
  // statement, rather than fabricating one.
  const explanationTargetIds = status === 'partial' || status === 'incorrect'
    ? [...new Set(adjudications.filter(item => item.status === 'partial' || item.status === 'incorrect').map(item => item.targetId))]
    : status === 'correct'
      ? [...new Set(adjudications.map(item => item.targetId))]
      : []
  const betterExplanation = explanationTargetIds
    .map(id => String(targetById.get(id)?.statement || '').trim())
    .filter(Boolean)
    .join(' ')

  // A hint points AT the concept without revealing the canonical answer —
  // only the target's own label/name is used, never its statement/evidence.
  const hint = status === 'missing'
    ? [...new Set(adjudications.map(item => labelFor(item.targetId)))]
      .map(label => materialLanguage !== 'es' ? label : `Repasa en el material qué explica sobre: ${label}.`)
      .join(' ')
    : ''

  // Enrichment is surfaced ONLY once the essential knowledge is already
  // satisfied (status === 'correct') — otherwise the student is still
  // working on the blocking gap and an enrichment note would be noise.
  const enrichment = status === 'correct'
    ? [...new Set(supportingGaps.map(item => {
      const detail = String(item.missingDetail || '').trim()
      return detail ? (materialLanguage !== 'es' ? detail : `Para hacerlo aún más completo, recuerda que: ${detail}.`) : ''
    }).filter(Boolean))]
    : []

  return {
    status, title, summary, demonstrated, missing,
    didWell: demonstrated, needsWork: missing, correction, suggestion, betterExplanation, hint, enrichment, pages,
    scoreBefore: attempt.scoreBefore, scoreAfter: attempt.scoreAfter,
    letterBefore: attempt.letterBefore, letterAfter: attempt.letterAfter,
    scoreChanged: attempt.scoreBefore !== attempt.scoreAfter || attempt.letterBefore !== attempt.letterAfter,
    groupResolved: allCovered,
  }
}

const SUBSCRIPT_SUPERSCRIPT_DIGITS: Record<string, string> = {
  '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3', '\u2084': '4', '\u2085': '5', '\u2086': '6', '\u2087': '7', '\u2088': '8', '\u2089': '9',
  '\u2070': '0', '\u00b9': '1', '\u00b2': '2', '\u00b3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9',
}

/**
 * Canonical source text commonly renders chemical/mathematical formulas with
 * real Unicode sub/superscript digits (N\u2082O\u2084), while a target's own label may
 * use plain ASCII digits (N2O4). Without folding these to the same form, the
 * specificity/support token comparison below would treat "n2o4" and "n\u2082o\u2084"
 * as unrelated, wrongly rejecting a specific, well-supported question purely
 * over glyph choice \u2014 this was the live root cause of otherwise-valid
 * Recovery questions failing REPASO_RECOVERY_QUESTION_NOT_SPECIFIC/UNSUPPORTED.
 */
function normalizedQuestionText(value: string) {
  const digitFolded = value.replace(/[\u2080-\u2089\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079]/g, char => SUBSCRIPT_SUPERSCRIPT_DIGITS[char] || char)
  return digitFolded.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

const GENERIC_RECOVERY_QUESTION_PATTERNS = [
  /idea (?:academica )?principal (?:del|de este) (?:contexto|tema|material)/,
  /que (?:se )?presenta en (?:el|este) contexto/,
  /explica (?:el|este) (?:contexto|tema|material)/,
]

/* ------------------------------------------------------------------ */
/* QUESTION-SCOPED EXPECTATION — AUTHORING INTENT                       */
/*                                                                      */
/* assessedTargetIds alone say WHICH targets a frozen question covers — */
/* not HOW MUCH of each target's canonical detail it actually asked     */
/* for. The scope boundary is decided by AUTHORING-TIME STRUCTURE, never */
/* by pattern-matching the adjudicator's own missingDetail text after   */
/* the fact (that was the prior, insufficient design — see below):      */
/*                                                                      */
/*  - A target canonically labeled "Ejemplo de X" bundles a general     */
/*    claim PLUS extra worked-example specificity (a number, a named    */
/*    reaction) — a structural fact decided at canonical ingestion,     */
/*    long before this question existed (isRepasoExampleLabeledTarget). */
/*    When such a target is merely REFERENCED by a CONNECTED/RELATION/  */
/*    DEFINITION/FORMULA/fallback question (i.e. by its general label,  */
/*    not by asking for "el ejemplo" specifically), that extra worked   */
/*    detail is enrichment, not a requirement.                          */
/*  - Every OTHER target's own canonical statement IS its single        */
/*    essential claim — for those, a 'partial' verdict always means     */
/*    that exact essential claim was not fully demonstrated, so it      */
/*    always keeps blocking, regardless of family.                      */
/*  - Two authoring-time overrides force full detail even for an        */
/*    "Ejemplo de X" target: (a) the question's own frozen wording       */
/*    explicitly names that target's exact numeric/formula content      */
/*    (the question DID ask for it), or (b) the question was authored   */
/*    as the 'application' family specifically about that one example   */
/*    ("¿Qué muestra este ejemplo sobre X?").                            */
/*                                                                      */
/* This is a pure PROJECTION of canonical target STRUCTURE (label       */
/* shape) and the frozen question's own wording/family — never a second */
/* academic brain, never a provider call, and never a persisted field:  */
/* since the question, its family, and the canonical targets are all    */
/* already frozen, recomputing this on every read reproduces the        */
/* identical result every time (restore/retry "freeze" it for free).    */
/* ------------------------------------------------------------------ */

export interface RepasoRecoveryQuestionExpectation {
  targetId: string
  /**
   * True when this question requires this target's FULL canonical
   * detail (its essential claim is the whole story, or an authoring-time
   * override explicitly invoked the extra worked-example detail). False
   * only for an "Ejemplo de X" target whose extra worked-example detail
   * genuinely goes beyond what THIS question's wording/family asked for.
   */
  requiresFullDetail: boolean
}

function foldExactDetailDigits(value: string): string {
  return value.replace(/[₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]/g, char => SUBSCRIPT_SUPERSCRIPT_DIGITS[char] || char)
}

// Deliberately narrow: a decimal value (0.212, 4.72) or a capitalized
// compound-formula-shaped token (N2O4, NO2, H2O) — NOT bare small
// integers ("factor 2", "K²" folds to "k2" but never matches the
// formula pattern, which requires a leading capital letter). Used ONLY
// to detect whether the frozen QUESTION WORDING itself explicitly names
// an exact detail that belongs to a target's own canonical content —
// never to scan the adjudicator's missingDetail (that per-marker
// after-the-fact scanning was the prior design's flaw).
const EXACT_DETAIL_DECIMAL_PATTERN = /\d+[.,]\d+/g
// Bounded to a handful of letters/parentheses so a genuine multi-element
// compound (CaCO3, N2O4, NO2, H2O, Ca(OH)2, Pb(NO3)2) matches as one
// token, without scanning arbitrarily far into an unrelated sentence.
// Parentheses are included because polyatomic-ion notation — hydroxides,
// nitrates, sulfates — is common in exactly the heterogeneous-equilibrium
// examples this detector exists to recognize; excluding them was a real
// false-negative gap (a genuine worked example like "Ca(OH)2" failed to
// register as concrete evidence purely because of the parentheses).
// Parentheses are allowed only BEFORE the mandatory digit (so "Ca(OH)2"
// matches as one token) — never trailing after it, so a physical-state
// suffix immediately following a formula ("CaCO3(s)", "CO2(g)") is never
// swallowed into the marker, which would otherwise make the same
// compound's bare mention elsewhere ("CaCO3") fail to match it.
const EXACT_DETAIL_FORMULA_PATTERN = /(?<![A-Za-z0-9])[A-Z][A-Za-z0-9()]{0,10}\d[A-Za-z0-9]*/g

function extractExactDetailMarkers(text: string): Set<string> {
  const folded = foldExactDetailDigits(String(text || ''))
  const decimals = folded.match(EXACT_DETAIL_DECIMAL_PATTERN) || []
  const formulas = folded.match(EXACT_DETAIL_FORMULA_PATTERN) || []
  return new Set([...decimals, ...formulas].map(marker => marker.toLowerCase()))
}

export function deriveRepasoRecoveryQuestionExpectations(
  question: string,
  targets: readonly RepasarReviewTarget[],
  assessedTargetIds: readonly string[],
  questionFamily?: string,
): RepasoRecoveryQuestionExpectation[] {
  const questionMarkers = extractExactDetailMarkers(question)
  const targetById = new Map(targets.map(target => [target.id, target]))
  // 'application' is only ever authored (see repasoQuestionCandidates) for
  // a target or chunk that IS "Ejemplo de X" — the wording explicitly
  // says "usa el ejemplo" / "qué muestra este ejemplo", so every assessed
  // target in such a question requires its full worked-example detail,
  // regardless of chunk size.
  const isApplicationFamily = questionFamily === 'application'
  return assessedTargetIds.map(targetId => {
    const target = targetById.get(targetId)
    if (!isRepasoExampleLabeledTarget(target)) {
      return { targetId, requiresFullDetail: true }
    }
    const canonicalMarkers = extractExactDetailMarkers(`${target?.label || ''} ${target?.statement || ''}`)
    const explicitlyNamedInWording = [...canonicalMarkers].some(marker => questionMarkers.has(marker))
    return { targetId, requiresFullDetail: explicitlyNamedInWording || isApplicationFamily }
  })
}

/**
 * A 'partial' canonical verdict is satisfied FOR THE FROZEN QUESTION only
 * when this target's own worked-example detail was not required by THIS
 * question's authoring intent, AND the student demonstrated something
 * genuine (non-empty `demonstrated`). Never inspects `missingDetail` text
 * — the scope boundary comes entirely from `requiresFullDetail`.
 */
export function isRepasoPartialSatisfiedByQuestionScope(
  item: { status: RepasarCoverageStatus; demonstrated?: string },
  requiresFullDetail: boolean,
): boolean {
  if (item.status !== 'partial') return false
  if (requiresFullDetail) return false
  return Boolean(String(item.demonstrated || '').trim())
}

// Common short Spanish function words \u2014 never treated as anchors just
// because they happen to be capitalized by sentence position ("La
// constante...", "C\u00f3mo se relaciona...") or filtered as "unsupported
// compact tokens" just because they're short. A real academic symbol
// (Keq, kf, pH) never collides with this list.
const SPANISH_SHORT_STOPWORDS = new Set([
  'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'lo', 'le', 'les', 'se', 'su', 'sus',
  'mi', 'mis', 'tu', 'tus', 'nos', 'os', 'ya', 'no', 'si', 'es', 'son', 'del', 'y', 'o', 'e', 'u', 'ni',
  'de', 'en', 'con', 'por', 'para', 'sin', 'ha', 'han', 'hay', 'fue', 'era', 'soy', 'eres', 'somos',
  'muy', 'mas', 'tan', 'aun', 'ese', 'esa', 'eso', 'este', 'esta', 'esto', 'asi',
])

function recoveryAnchorTerms(targets: readonly RepasarReviewTarget[]) {
  const stop = new Set(['para', 'como', 'este', 'esta', 'estos', 'estas', 'sobre', 'entre', 'desde', 'hasta', 'porque', 'cual', 'idea', 'principal', 'concepto', 'contexto', 'material', 'tema'])
  const rawWords = targets.flatMap(target => `${target.label} ${target.statement}`.match(/[\p{L}\p{N}]+/gu) || [])
  // A short academic symbol (Keq, Kc, N2O4, pH) must count as an anchor just
  // like a long descriptive word \u2014 otherwise a question naming ONLY that
  // symbol is wrongly rejected as "not specific" purely for being short.
  // Only the length>=4 OR (has an uppercase letter or digit AND is not a
  // common short Spanish function word capitalized by sentence position).
  const qualifies = (word: string) => {
    if (word.length >= 4) return true
    const lower = word.toLowerCase()
    if (SPANISH_SHORT_STOPWORDS.has(lower)) return false
    // \p{Lu} ("any uppercase letter") rather than a Latin-only class \u2014 a
    // meaningful formula symbol like Greek "\u0394" (\u0394n, \u0394H, \u0394G) is just as
    // valid an academic anchor as "K"/"N" and must not be excluded merely
    // for not being in the Latin alphabet.
    return /\p{Lu}/u.test(word) || /\d/.test(word)
  }
  return [...new Set(rawWords.filter(qualifies).map(normalizedQuestionText).filter(term => term && !stop.has(term)))]
}

/**
 * Determines, from the AUTHORED QUESTION TEXT alone, exactly which
 * canonical target(s) that question asks the student to demonstrate.
 * Academic importance (importanceTier) is NOT question scope — a group is
 * an organizational/planning unit, and neither the deterministic composer
 * nor a provider is guaranteed to phrase a question that names every
 * grouped target. This function is the single source of truth for "what
 * did we actually ask," computed once at authoring time and frozen
 * alongside the question.
 *
 * For each candidate target, its DISTINCTIVE anchor terms (words in its
 * own label/statement that do not also belong to any sibling in the same
 * grounding unit) are checked against the question text — using only the
 * sibling's own terms avoids false positives from generic shared wording
 * ("reacción", "velocidad") that near-duplicate-labeled targets share.
 * Never fabricates content; if no target can be distinguished (e.g. a
 * single-target grounding, or a fully generic question), it degrades
 * gracefully to the full candidate set rather than returning nothing.
 */
export function deriveAssessedTargetIds(
  question: string,
  targets: readonly RepasarReviewTarget[],
): string[] {
  if (!targets.length) return []
  const normalizedQuestion = normalizedQuestionText(question)
  const termsByTarget = new Map(targets.map(target => [target.id, new Set(recoveryAnchorTerms([target]))]))
  const assessed: string[] = []
  for (const target of targets) {
    const ownTerms = termsByTarget.get(target.id) || new Set<string>()
    const otherTerms = new Set(targets
      .filter(other => other.id !== target.id)
      .flatMap(other => [...(termsByTarget.get(other.id) || [])]))
    const distinctiveTerms = [...ownTerms].filter(term => !otherTerms.has(term))
    // STRICT: a target is only assessed via one of its own DISTINCTIVE
    // terms — never falling back to terms it shares with a sibling. Near-
    // duplicate-labeled targets ("Reacción directa y su ley de velocidad" /
    // "Reacción inversa y su ley de velocidad") share generic words like
    // "reacción"/"velocidad"; matching on those alone previously caused a
    // narrowly-worded question to spuriously "assess" every sibling too.
    if (distinctiveTerms.length && distinctiveTerms.some(term => normalizedQuestion.includes(term))) {
      assessed.push(target.id)
    }
  }
  if (assessed.length) return assessed
  // No target had an unambiguous distinctive match. Fail toward the
  // NARROWEST defensible scope — the single target whose own terms overlap
  // the question text the most — never silently the entire candidate set.
  // This only fires for provider-authored questions (deterministic
  // authoring always supplies its own exact scope directly and never
  // reaches this function) or legacy pre-assessedTargetIds artifacts.
  let bestId = targets[0].id
  let bestScore = -1
  for (const target of targets) {
    const ownTerms = [...(termsByTarget.get(target.id) || [])]
    const matched = ownTerms.filter(term => normalizedQuestion.includes(term)).length
    if (matched > bestScore) { bestScore = matched; bestId = target.id }
  }
  return [bestId]
}

/**
 * Backward-compatible read boundary for a group's assessed scope. A group
 * persisted before `assessedTargetIds` existed derives it deterministically
 * from its own already-frozen `question` text — no provider call, no
 * migration write required. An unopened group (no question yet) has no
 * assessable scope yet.
 */
export function resolveRepasoAssessedTargetIds(
  group: NonNullable<RepasoArtifact['recoveryPlan']>['groups'][number],
  targets: readonly RepasarReviewTarget[],
): Set<string> {
  if (group.assessedTargetIds?.length) return new Set(group.assessedTargetIds)
  if (!group.question.trim()) return new Set()
  const groupIds = new Set(group.targetIds)
  const scopedTargets = targets.filter(target => groupIds.has(target.id))
  return new Set(deriveAssessedTargetIds(group.question, scopedTargets))
}

export function isSpecificRepasoRecoveryQuestion(
  question: string,
  targets: readonly RepasarReviewTarget[],
) {
  const normalized = normalizedQuestionText(question)
  if (!normalized.trim() || GENERIC_RECOVERY_QUESTION_PATTERNS.some(pattern => pattern.test(normalized))) return false
  const anchors = recoveryAnchorTerms(targets)
  return anchors.length === 0 || anchors.some(term => normalized.includes(term))
}

export function substantiveSourceSpan(span: { page: number; quote: string }) {
  const quote = String(span.quote || '').replace(/\s+/g, ' ').trim()
  if (!Number.isFinite(span.page) || span.page <= 0 || !quote) return false
  // Long explanatory prose is always substantive.
  if (quote.length >= 35 && quote.split(/\s+/).length >= 6) return true
  // A canonical target may be legitimately grounded by a short formula
  // (Kc = ..., Q < K, v_directa = v_inversa) or a concise definition
  // rather than a paragraph — raw character length alone would wrongly
  // reject these. Decorative titles ("Equilibrio químico") stay rejected:
  // they have neither a formula operator nor enough words to be a definition.
  const isFormulaLike = /[=<>]/.test(quote) && quote.length >= 3
  const isConciseDefinition = quote.split(/\s+/).length >= 3 && quote.length >= 12
  return isFormulaLike || isConciseDefinition
}

/**
 * A target LABELED as an example ("Ejemplo de X") authors a DEICTIC
 * question ("¿Qué muestra este ejemplo...?" / application family) that
 * depends on a concrete instance actually being visible on the
 * recommended page — a worked equation with real species/values, a
 * specific number. The generic `substantiveSourceSpan` shape check
 * (word count / length / bare "=") is not enough to guarantee that: a
 * decorative cover/title snippet can be long enough to pass it while
 * showing no actual example. Applies ONLY to example-labeled targets —
 * every other (non-deictic) canonical target keeps the general
 * substantiveness check unchanged.
 */
function isConcreteExampleSourceSpan(span: { page: number; quote: string }): boolean {
  return substantiveSourceSpan(span) && extractExactDetailMarkers(span.quote).size > 0
}

function repasoQualifyingSourceSpans(target: RepasarReviewTarget): { page: number; quote: string }[] {
  const spans = target.sourceSpans || []
  return isRepasoExampleLabeledTarget(target)
    ? spans.filter(isConcreteExampleSourceSpan)
    : spans.filter(substantiveSourceSpan)
}

export function effectiveRepasoPagesToReview(
  group: NonNullable<RepasoArtifact['recoveryPlan']>['groups'][number],
  targets: readonly RepasarReviewTarget[],
) {
  const grounding = buildRepasoRecoveryQuestionGrounding(group, targets)
  if (grounding.recommendedPages.length) return grounding.recommendedPages
  const targetIds = new Set(group.targetIds)
  const scoped = targets.filter(target => targetIds.has(target.id))
  const substantive = scoped.flatMap(target => repasoQualifyingSourceSpans(target).map(span => span.page))
  if (substantive.length) return [...new Set(substantive)].sort((a, b) => a - b)
  const grounded = scoped.flatMap(target => (target.sourceSpans || []).filter(span => Number.isFinite(span.page) && span.page > 0 && String(span.quote || '').trim()).map(span => span.page))
  if (grounded.length) return [...new Set(grounded)].sort((a, b) => a - b)
  return [...group.pages]
}

export interface RepasoRecoveryQuestionGrounding {
  targetIds: string[]
  targets: RepasarReviewTarget[]
  recommendedPages: number[]
  evidenceText: string
}

const REPASO_QUESTION_DEFAULT_CHUNK_SIZE = 3
const REPASO_QUESTION_MAX_CHUNK_SIZE = 4

/**
 * SEMANTIC HOMOGENEITY FIRST: an "Ejemplo de X" target bundles worked-
 * example specificity that a generic conceptual/relational question never
 * explicitly asks for (see `requiresFullDetail` in
 * `deriveRepasoRecoveryQuestionExpectations`). Silently mixing it into a
 * conceptual CONNECTED chunk produces a technically-explicit but
 * pedagogically ambiguous question ("Explica cómo se conectan: A, B,
 * ejemplo C, ejemplo D") that a genuine, complete CONCEPTUAL answer can
 * never fully resolve — this was the live root cause, not a grading gap.
 * The chunk is therefore drawn from whichever partition (example-labeled
 * vs non-example) the FIRST candidate (in canonical ingestion order)
 * belongs to; the other partition is deferred to its own future question
 * via the existing repartition mechanism, never silently absorbed.
 */
function selectRepasoSemanticChunkPool(candidates: readonly RepasarReviewTarget[]): RepasarReviewTarget[] {
  const firstIsExample = isRepasoExampleLabeledTarget(candidates[0])
  return candidates.filter(target => isRepasoExampleLabeledTarget(target) === firstIsExample)
}

/**
 * ONE QUESTION = ONE COHERENT LEARNING CHUNK — never one target forever,
 * and never the whole group merely because they happen to share it. A
 * semantically-homogeneous pool (already sorted by canonical `sourceOrder`
 * via their ingestion order) is capped at a conservative default chunk
 * size. A 4th target is allowed ONLY when ALL candidates share the exact
 * same topic AND their canonical `sourceOrder` values are strictly
 * consecutive — a deterministic, no-LLM proxy for "these were extracted
 * as one tightly connected derivation in the source material," matching
 * cases like PV=nRT -> P=(n/V)RT -> Kp=Kc(RT)^Δn -> definition of Δn.
 * Never a new planner, never a provider call — purely existing canonical
 * metadata. Any candidate beyond the chosen chunk is left out of the
 * returned unit; the caller's existing repartition mechanism (used
 * identically for ungroundable siblings) defers it into its own group.
 */
function selectRepasoQuestionChunk(rawCandidates: readonly RepasarReviewTarget[]): RepasarReviewTarget[] {
  const candidates = selectRepasoSemanticChunkPool(rawCandidates)
  if (candidates.length <= REPASO_QUESTION_DEFAULT_CHUNK_SIZE) return [...candidates]
  const sameTopic = candidates.every(target => target.topicId && target.topicId === candidates[0].topicId)
  const orders = candidates.map(target => target.sourceOrder ?? -1).sort((a, b) => a - b)
  const consecutive = orders.every((order, index) => index === 0 || (order >= 0 && order === orders[index - 1] + 1))
  if (candidates.length <= REPASO_QUESTION_MAX_CHUNK_SIZE && sameTopic && consecutive) return [...candidates]
  return candidates.slice(0, REPASO_QUESTION_DEFAULT_CHUNK_SIZE)
}

export function buildRepasoRecoveryQuestionGrounding(
  group: NonNullable<RepasoArtifact['recoveryPlan']>['groups'][number],
  targets: readonly RepasarReviewTarget[],
): RepasoRecoveryQuestionGrounding {
  const groupIds = new Set(group.targetIds)
  const scopedTargets = targets.filter(target => groupIds.has(target.id))
  // An example-labeled target only "counts" here when it has a genuinely
  // CONCRETE instance span — never a decorative/title snippet that merely
  // passes the generic length/shape heuristic (see
  // isConcreteExampleSourceSpan). A target with NO qualifying evidence
  // anywhere in the selected pages is excluded from candidates entirely —
  // deferred by the existing repartition mechanism below, never given a
  // misleading deictic question.
  const candidates = scopedTargets.filter(target => repasoQualifyingSourceSpans(target).length > 0)
  if (!candidates.length) {
    return { targetIds: [], targets: [], recommendedPages: [], evidenceText: '' }
  }
  // The frozen recovery group remains the academic answer authority for every
  // target it names. But grouping is a presentation/efficiency choice, not a
  // pedagogical guarantee that ALL siblings share readable evidence — a group
  // must not become entirely ungroundable just because ONE sibling lacks a
  // substantive span. The question unit is therefore the groundable SUBSET of
  // the group; any remainder is repartitioned by the caller into its own
  // group rather than silently dropped or blocking the whole group forever.
  //
  // GRANULARITY: group membership is an organizational/planning container,
  // never an implicit question-assessment unit. A group with more targets
  // than fit in one coherent, concise answer is chunked here — the SAME
  // repartition mechanism the caller already uses for ungroundable siblings
  // (grounding.targetIds.length !== group.targetIds.length) transparently
  // defers the remainder into its own trailing group, never silently
  // dropping or falsely covering it.
  const unit = selectRepasoQuestionChunk(candidates)
  const recommendedPages = [...new Set(unit.flatMap(target => repasoQualifyingSourceSpans(target).map(span => span.page)))].sort((a, b) => a - b)
  const evidenceText = unit.flatMap(target => repasoQualifyingSourceSpans(target)
    .filter(span => recommendedPages.includes(span.page))
    .map(span => `[p. ${span.page}] ${span.quote}`)).join('\n')
  return { targetIds: unit.map(target => target.id), targets: unit, recommendedPages, evidenceText }
}

const QUESTION_SUPPORT_STOP = new Set([
  'como', 'cual', 'cuales', 'explica', 'describe', 'relaciona', 'relacion', 'porque', 'manera', 'puedes',
  'segun', 'partir', 'entre', 'sobre', 'esta', 'este', 'estos', 'estas', 'para', 'cuando', 'donde', 'ocurre',
  'sistema', 'concepto', 'pregunta', 'material', 'informacion', 'significa',
])

export function isRepasoRecoveryQuestionSupported(
  question: string,
  grounding: RepasoRecoveryQuestionGrounding,
) {
  if (!grounding.targets.length || !grounding.recommendedPages.length || !grounding.evidenceText.trim()) return false
  const readableEvidence = normalizedQuestionText(grounding.evidenceText)
  const evidence = normalizedQuestionText(`${grounding.targets.map(target => target.label).join(' ')} ${grounding.evidenceText}`)
  // Unicode-aware extraction (matches compactAcademicTokens below) — an
  // ASCII-only [a-z0-9]+ regex silently drops a meaningful non-Latin
  // symbol like Greek "Δ" (Δn, as in "Δn en la relación Kc y Kp"), leaving
  // only the fragment "n" in readableTokens. A compact token "Δn" from the
  // question could then never be found as a whole unit in the evidence —
  // even when the evidence literally contains "Δn" — wrongly rejecting an
  // academically valid, well-supported question over a tokenization gap,
  // not a real grounding gap.
  // A compact academic symbol (Kp, Kc, Δn) that is part of a grounded
  // target's own canonical LABEL — its actual name/subject, e.g. "Definición
  // de Δn en la relación Kc y Kp" — is not a fabrication merely because the
  // specific source-span quote for that sub-concept doesn't happen to
  // repeat the symbol verbatim. `evidence` (labels + evidenceText) is the
  // superset used for the readableTokens check so a target's own identity
  // still counts as support; a symbol absent from BOTH the label and every
  // quote (never grounded anywhere) is still rejected as before.
  const readableTokens = new Set(evidence.match(/[\p{L}\p{N}]+/gu) || [])
  const terms = (normalizedQuestionText(question).match(/[\p{L}\p{N}]{4,}/gu) || []).filter(term => !QUESTION_SUPPORT_STOP.has(term))
  const supportedTerms = terms.filter(term => evidence.includes(term))
  if (terms.length && supportedTerms.length / terms.length < .7) return false
  // Extract whole Unicode words FIRST (\p{L} keeps an accented word like
  // "cómo"/"reacción" intact as one token) and only THEN classify by shape.
  // Running the old ASCII-only regex directly on raw text split accented
  // words at the accent mark ("cómo" -> "c" + "mo"), producing meaningless
  // fragments that were then wrongly flagged as unsupported academic tokens.
  const compactAcademicTokens = (question.match(/[\p{L}\p{N}]+/gu) || []).filter((token: string) => {
    const hasDigit = /\d/.test(token)
    if (hasDigit) return true
    const hasUpper = /\p{Lu}/u.test(token)
    const length = token.length
    return hasUpper ? length <= 7 : length <= 3
  })
  const genericCompact = new Set([
    'que', 'con', 'del', 'las', 'los', 'una', 'uno', 'por', 'sus', 'sin', 'y', 'e', 'o', 'u',
    ...SPANISH_SHORT_STOPWORDS,
  ])
  // A compact academic token (Keq, kf, N2O4) is unsupported whenever it is
  // absent from the readable evidence — whether it already belongs to this
  // target's own canonical identity (echoed without support) OR is an
  // entirely new symbol the question introduces on its own (a fabricated
  // relationship, e.g. asking about "kf"/"kr" when only Keq is grounded).
  // Both are equally invalid: the question must never outrun the evidence.
  const unsupportedCompact = compactAcademicTokens
    .map(token => normalizedQuestionText(token))
    .filter(token => !genericCompact.has(token) && !QUESTION_SUPPORT_STOP.has(token) && !readableTokens.has(token))
  return unsupportedCompact.length === 0
}

function truncateForLog(value: string, max = 160) {
  const trimmed = value.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * Specificity and support are DIFFERENT questions and are logged/tested
 * separately (a question can be specific but unsupported, or vice versa) —
 * collapsing both into one code hides which predicate actually rejected it.
 */
function logRepasoRecoveryQuestionValidation(context: {
  groupId: string
  targetIds: string[]
  question: string
  targets: readonly RepasarReviewTarget[]
  grounding: RepasoRecoveryQuestionGrounding
  authoringSource: 'deterministic' | 'deterministic_simple' | 'provider'
  providerAttemptsConsumed: number
}) {
  const specificityResult = isSpecificRepasoRecoveryQuestion(context.question, context.targets)
  const supportResult = specificityResult && isRepasoRecoveryQuestionSupported(context.question, context.grounding)
  console.log('[repaso-recovery-question-candidate]', {
    groupId: context.groupId,
    targetIds: context.targetIds,
    assessedTargetIds: specificityResult && supportResult ? context.targetIds : [],
    questionPreview: truncateForLog(context.question),
    canonicalTerms: recoveryAnchorTerms(context.targets),
    specificityResult,
    supportResult,
    exactSupportFailureReason: !specificityResult ? 'NOT_SPECIFIC' : !supportResult ? 'NOT_SUPPORTED' : null,
    authoringSource: context.authoringSource,
    providerAttemptsConsumed: context.providerAttemptsConsumed,
  })
  return specificityResult && supportResult
}

/**
 * Deterministic, provider-free question composed directly from the frozen
 * grounding unit's own target labels — never adds outside knowledge, never
 * invents a relationship between targets that isn't already grounded. Tried
 * BEFORE any provider call (spends zero calls when it succeeds), and again
 * as a minimal last-resort safety net if the provider path is exhausted.
 * `simple` restricts composition to the single strongest target only, for
 * the rare case where the full multi-target phrasing itself fails support.
 */
export type RepasoQuestionFamily =
  | 'definition' | 'formula' | 'mechanism' | 'relation' | 'connected' | 'application' | 'explanation_fallback'

/**
 * A target canonically curated as "Ejemplo de X" bundles TWO things: the
 * general rule/claim X illustrates, plus specific worked-example detail
 * (a numeric value, a named reaction/species) that goes beyond that core
 * claim. This label shape is decided once, at canonical ingestion — long
 * before any Recovery question exists — so using it to scope what a
 * question requires is reading AUTHORING INTENT already present in the
 * target's own canonical structure, never a new interpretation layer.
 */
function isRepasoExampleLabeledTarget(target: { label?: string } | undefined): boolean {
  return /^ejemplo de /i.test(String(target?.label || '').trim())
}

export interface RepasoDeterministicQuestionDraft {
  question: string
  /**
   * The EXACT targets this draft's own wording was composed from — known
   * directly by the composer, never reconstructed afterward by scanning
   * the finished question text against the full grounding unit. This is
   * what fixed a live bug where a single-target deterministic question
   * ended up frozen with all-4-target assessment scope: text-based
   * re-derivation against near-duplicate-labeled siblings (all sharing
   * words like "reacción"/"velocidad") could spuriously "match" targets
   * the question never actually asked about.
   */
  assessedTargetIds: string[]
  questionFamily: RepasoQuestionFamily
}

function joinRepasoLabels(labels: readonly string[]): string {
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
}

/**
 * A small, BOUNDED, deterministic repertoire of natural question forms —
 * never a new LLM planner, never randomness (candidates are tried in one
 * fixed, stable order so the SAME canonical shape always produces the SAME
 * wording on every open/restore). Each candidate is validated with the
 * exact same specificity+support gates as before; the first one to pass
 * wins. "Explica, según el material: ..." is deliberately LAST — the safe
 * fallback for when no more specific natural form can be confidently
 * instantiated from canonical structure, never the default.
 */
function repasoQuestionCandidates(scoped: readonly RepasarReviewTarget[]): { question: string; family: RepasoQuestionFamily }[] {
  const labels = scoped.map(target => String(target.label || '').trim()).filter(Boolean)
  const joined = joinRepasoLabels(labels)
  const candidates: { question: string; family: RepasoQuestionFamily }[] = []

  if (scoped.length === 1) {
    const label = labels[0]
    const kind = String(scoped[0].kind || '').toLowerCase()
    const definitionMatch = label.match(/^definici[oó]n de (.+)$/i)
    if (definitionMatch) {
      candidates.push({ question: `¿Qué representa ${definitionMatch[1]}?`, family: 'definition' })
    }
    const formulaMatch = label.match(/^expresi[oó]n de (.+)$/i)
    if (formulaMatch) {
      candidates.push({ question: `¿Cómo se expresa ${formulaMatch[1]}?`, family: 'formula' })
    }
    if (kind === 'formula' && !formulaMatch && !definitionMatch) {
      candidates.push({ question: `¿Qué representa ${label}?`, family: 'formula' })
    }
    // MECHANISM is deliberately conservative: only fires for a target
    // explicitly typed as a process (kind==='process'), never for a
    // generic 'concept' — many concept-kind targets are named entities
    // or constants (e.g. "Keq", "Reacción directa y su ley de velocidad")
    // for which "¿Cómo ocurre X?" is grammatically/semantically wrong.
    if (kind === 'process' && !definitionMatch && !formulaMatch) {
      candidates.push({ question: `¿Cómo ocurre ${label}?`, family: 'mechanism' })
    }
    // APPLICATION: a standalone question about an "Ejemplo de X" target
    // explicitly asks the student to engage with THAT worked example —
    // unlike a CONNECTED question that merely references the same target
    // by its general label, this wording explicitly invokes "el ejemplo",
    // so its exact worked detail legitimately becomes required (see
    // deriveRepasoRecoveryQuestionExpectations).
    const exampleMatch = label.match(/^ejemplo de (.+)$/i)
    if (exampleMatch && !definitionMatch && !formulaMatch) {
      candidates.push({ question: `¿Qué muestra este ejemplo sobre ${exampleMatch[1]}?`, family: 'application' })
    }
  } else if (scoped.length >= 2 && scoped.every(target => isRepasoExampleLabeledTarget(target))) {
    // A chunk made ENTIRELY of "Ejemplo de X" targets (chunking already
    // guarantees this homogeneity — see selectRepasoSemanticChunkPool)
    // explicitly asks the student to use/interpret the worked examples,
    // removing the ambiguity a generic CONNECTED wording would leave.
    candidates.push({ question: `Según el ejemplo del material, explica: ${joined}.`, family: 'application' })
  } else if (scoped.length === 2 && labels.some(label => /relaci[oó]n/i.test(label))) {
    candidates.push({ question: `¿Cómo se relacionan ${labels[0]} y ${labels[1]}?`, family: 'relation' })
  } else if (scoped.length >= 2) {
    candidates.push({ question: `Explica cómo se conectan: ${joined}.`, family: 'connected' })
  }

  // Safe, always-available fallback — last, never first.
  candidates.push({ question: `Explica, según el material: ${joined}.`, family: 'explanation_fallback' })
  return candidates
}

function composeDeterministicRepasoRecoveryQuestion(
  grounding: RepasoRecoveryQuestionGrounding,
  options: { simple?: boolean; groupId?: string } = {},
): RepasoDeterministicQuestionDraft | null {
  const scoped = options.simple ? grounding.targets.slice(0, 1) : grounding.targets
  const labels = scoped.map(target => String(target.label || '').trim()).filter(Boolean)
  const authoringSource = options.simple ? 'deterministic_simple' : 'deterministic'
  if (!labels.length) {
    if (options.groupId) {
      console.log('[repaso-recovery-question-candidate]', {
        groupId: options.groupId, authoringSource, targetIds: scoped.map(t => t.id), assessedTargetIds: [],
        questionPreview: null, questionFamily: null, specificityResult: false, supportResult: false,
        exactSupportFailureReason: 'NO_LABELS', providerAttemptsConsumed: 0,
      })
    }
    return null
  }
  // Validate against the SCOPED subset the question was actually built
  // from — not the full grounding unit — so a candidate is never trivially
  // "specific" merely because an unrelated sibling in the same grounding
  // happens to share an anchor term. Every family is tried, in the SAME
  // fixed order every time (deterministic/frozen/reproducible); the first
  // one to pass both gates is used.
  for (const { question, family } of repasoQuestionCandidates(scoped)) {
    const specificityResult = isSpecificRepasoRecoveryQuestion(question, scoped)
    const supportResult = specificityResult && isRepasoRecoveryQuestionSupported(question, grounding)
    if (options.groupId) {
      console.log('[repaso-recovery-question-candidate]', {
        groupId: options.groupId, authoringSource, targetIds: scoped.map(t => t.id),
        assessedTargetIds: specificityResult && supportResult ? scoped.map(t => t.id) : [],
        questionPreview: truncateForLog(question), questionFamily: family,
        specificityResult, supportResult,
        exactSupportFailureReason: !specificityResult ? 'NOT_SPECIFIC' : !supportResult ? 'NOT_SUPPORTED' : null,
        providerAttemptsConsumed: 0,
      })
    }
    if (specificityResult && supportResult) {
      return { question, assessedTargetIds: scoped.map(target => target.id), questionFamily: family }
    }
  }
  return null
}

/**
 * ONE call site owns the Recovery-question provider budget. The generic
 * generation pipeline's own comprehensive 4-stage ladder (normal + 2x
 * format_repair + 2x targeted_repair + simplified = 6 attempts) was
 * previously used unbounded here — and the caller ALSO retried this whole
 * function a second time, multiplying it to ~12 live provider calls for one
 * question. `failurePath: 'single_repair'` caps the pipeline itself at
 * exactly one repair attempt (max 2 calls total: normal + one targeted
 * retry from the SAME frozen grounding unit), and this function is now
 * called at most once per Recovery open — no nested/duplicated budgets.
 */
async function authorRepasoRecoveryQuestion(
  group: NonNullable<RepasoArtifact['recoveryPlan']>['groups'][number],
  groundedContext: RepasarGroundedContext,
): Promise<string> {
  const grounding = buildRepasoRecoveryQuestionGrounding(group, groundedContext.targets)
  const targets = grounding.targets
  if (!targets.length || !grounding.recommendedPages.length) throw new Error('REPASO_QUESTION_GROUNDING_INCOMPLETE')
  const groupIds = new Set(grounding.targetIds)
  const relations = groundedContext.relations.filter(
    relation => groupIds.has(relation.fromTargetId) && groupIds.has(relation.toTargetId),
  )
  const bounded = renderRepasarGroundedContextForPrompt({ ...groundedContext, targets, relations })
  const anchors = targets.map(target => `- ${target.label}: ${target.statement}`).join('\n')
  let providerAttemptsConsumed = 0
  // A repair attempt that returns the EXACT SAME question the normal
  // attempt already failed for cannot possibly pass this time — the
  // validator is deterministic given the same frozen grounding unit. Track
  // the first rejected normalized question and mark a verbatim repeat
  // non-retryable, so the pipeline stops instead of burning a pointless
  // identical second call.
  let firstRejectedNormalized: string | null = null
  const parsed: any = await __routeDeps.generateValidatedLegacyJson({
    taskType: 'evaluation_question', temperature: 0.15, maxTokens: 300, failurePath: 'single_repair',
    messages: [
      { role: 'system', content: `Escribe UNA pregunta breve, coherente y específica. La EVIDENCIA LEGIBLE es el límite estricto: pregunta únicamente algo que esas citas permitan contestar. Las proposiciones identifican el target, pero NO autorizan introducir relaciones, fórmulas o términos ausentes de la evidencia. Prohibido preguntar genéricamente por "la idea principal del contexto/tema/material". No dividas por target, no incluyas la respuesta ni pistas de páginas. Devuelve solo {"question":""}.` },
      { role: 'user', content: `CONCEPTOS Y PROPOSICIONES:\n${anchors}\n\nEVIDENCIA LEGIBLE AUTORIZADA (ÚNICA BASE PARA LA PREGUNTA):\n${grounding.evidenceText}\n\nCONTEXTO ESTRUCTURAL AUTORIZADO:\n${bounded}\nDevuelve exactamente {"question":""}.` },
    ],
    normalize: value => value,
    validate: value => {
      providerAttemptsConsumed += 1
      const question = String((value as any)?.question || '').trim()
      const valid = logRepasoRecoveryQuestionValidation({
        groupId: group.groupId, targetIds: grounding.targetIds, question, targets, grounding,
        authoringSource: 'provider', providerAttemptsConsumed,
      })
      if (valid) return { valid: true, errors: [] }
      const normalized = normalizedQuestionText(question)
      const isVerbatimRepeat = firstRejectedNormalized !== null && normalized === firstRejectedNormalized
      firstRejectedNormalized = firstRejectedNormalized ?? normalized
      return { valid: false, errors: ['REPASO_RECOVERY_QUESTION_NOT_SPECIFIC'], retryable: !isVerbatimRepeat }
    },
    telemetryContext: { route: 'review', phase: 'repaso_recovery_question' },
  })
  const question = String(parsed?.question || '').trim()
  if (!isSpecificRepasoRecoveryQuestion(question, targets) || !isRepasoRecoveryQuestionSupported(question, grounding)) {
    throw new Error('REPASO_QUESTION_GENERATION_INCOMPLETE')
  }
  return question
}

function selectFinalVerificationTargets(
  artifact: RepasoArtifact,
  targets: readonly RepasarReviewTarget[],
): { checkId: string; targetIds: string[] }[] {
  const targetById = new Map(targets.map(target => [target.id, target]))
  const weakIds = Object.values(artifact.initial.initialTargetStates)
    .filter(state => state.status !== 'covered')
    .map(state => state.targetId)
  const candidates = [...new Set([...weakIds, ...targets.map(target => target.id)])]
    .filter(id => artifact.currentTargetStates[id]?.status === 'covered')
    .sort((a, b) => {
      const ta = targetById.get(a); const tb = targetById.get(b)
      const tier = (TIER_RANK[ta?.importanceTier || 'contextual'] ?? 3) - (TIER_RANK[tb?.importanceTier || 'contextual'] ?? 3)
      if (tier) return tier
      return (ta?.sourceOrder ?? Infinity) - (tb?.sourceOrder ?? Infinity) || a.localeCompare(b)
    })
  const count = Math.min(6, candidates.length, Math.max(3, Math.ceil(candidates.length / 4)))
  return candidates.slice(0, count).map((targetId, index) => ({
    checkId: `fvcheck_${index + 1}_${targetId}`,
    targetIds: [targetId],
  }))
}

// RETIRED FROM THE ACTIVE PRODUCT FLOW (see repaso-final-open below) —
// kept, unused, for schema/compatibility reference only. No live code
// path calls this anymore; a new Repaso never generates a Final
// Verification set.
async function generateFinalVerification(
  artifact: RepasoArtifact,
  groundedContext: RepasarGroundedContext,
): Promise<RepasoFinalVerification> {
  const selected = selectFinalVerificationTargets(artifact, groundedContext.targets)
  if (selected.length === 0) throw new Error('REPASO_VERIFICATION_TARGETS_EMPTY')
  const selectedIds = new Set(selected.flatMap(check => check.targetIds))
  const bounded = renderRepasarGroundedContextForPrompt({
    ...groundedContext,
    targets: groundedContext.targets.filter(target => selectedIds.has(target.id)),
    relations: groundedContext.relations.filter(r => selectedIds.has(r.fromTargetId) && selectedIds.has(r.toTargetId)),
  })
  const parsed: any = await __routeDeps.generateValidatedLegacyJson({
    taskType: 'evaluation_question', temperature: 0.15, maxTokens: 900,
    messages: [
      { role: 'system', content: `Crea una verificación corta a libro cerrado. Una pregunta concisa por check, sin respuestas ni páginas. Devuelve solo {"checks":[{"checkId":"","question":""}]}.` },
      { role: 'user', content: `CHECKS CONGELADOS:\n${selected.map(c => `${c.checkId}: ${c.targetIds.join(',')}`).join('\n')}\nCONTEXTO AUTORIZADO:\n${bounded}` },
    ],
    normalize: value => value,
    validate: value => {
      const checks = Array.isArray((value as any)?.checks) ? (value as any).checks : []
      const ids = new Set(checks.map((c: any) => String(c?.checkId || '')))
      const valid = selected.every(c => ids.has(c.checkId)) && checks.every((c: any) => String(c?.question || '').trim())
      return { valid, errors: valid ? [] : ['REPASO_VERIFICATION_GENERATION_INCOMPLETE'] }
    },
    telemetryContext: { route: 'review', phase: 'repaso_final_question' },
  })
  const questionById = new Map((parsed.checks as any[]).map(check => [String(check.checkId), String(check.question).trim()]))
  const createdAt = new Date().toISOString()
  return {
    verificationId: `repaso_verify_${randomUUID()}`,
    createdAt,
    passed: false,
    checks: selected.map(check => ({
      ...check,
      question: questionById.get(check.checkId) || '',
      questionProvenance: 'provider', studentAnswer: null,
      adjudicatedTargetIds: [], adjudications: [], transitions: [], status: 'pending', attemptId: null,
    })),
  }
}

/**
 * SELF-HEALING COMPATIBILITY: a group frozen with a deictic 'application'
 * question BEFORE the concrete-example grounding fix
 * (isConcreteExampleSourceSpan) may point the student at a page with no
 * actual example — a known-misleading question, not a genuine academic
 * answer the student has engaged with. "Never regenerate a frozen
 * question" protects an ANSWERED question (there is a real attempt/score
 * tied to it); it was never meant to keep restoring, forever, a question
 * that is provably invalid under the CURRENT rules and that nobody has
 * answered yet. Re-validates ONLY an unanswered 'application' question
 * against fresh grounding; if it no longer qualifies, resets it to
 * unopened so the normal authoring path runs fresh on the next
 * repaso-recovery-open (deterministic, zero provider calls here — this
 * function itself never authors a replacement, it only clears a stale
 * one). Called from BOTH repaso-restore and repaso-recovery-open so a
 * page refresh heals the same way an explicit Continue does.
 */
async function repairStaleDeicticRepasoGroup(
  artifactIn: RepasoArtifact,
  groundedContext: RepasarGroundedContext,
  artifactStore: { get(id: string): Promise<RepasoArtifact | null>; set(artifact: RepasoArtifact): Promise<void> },
): Promise<{ artifact: RepasoArtifact; group: ReturnType<typeof currentRepasoRecoveryGroup> }> {
  let artifact = artifactIn
  const group = currentRepasoRecoveryGroup(artifact)
  if (
    !group ||
    !group.question.trim() ||
    group.questionFamily !== 'application' ||
    artifact.recoveryAttempts.some(attempt => attempt.groupId === group.groupId)
  ) {
    return { artifact, group }
  }
  const freshGrounding = buildRepasoRecoveryQuestionGrounding(group, groundedContext.targets)
  const stillSupported = freshGrounding.targetIds.length > 0
    && isRepasoRecoveryQuestionSupported(group.question, freshGrounding)
  if (stillSupported) return { artifact, group }
  const groups = artifact.recoveryPlan!.groups
  const idx = groups.findIndex(item => item.groupId === group.groupId)
  const reopenedGroup = {
    ...group, question: '', questionProvenance: 'template' as const, assessedTargetIds: undefined, questionFamily: undefined,
  }
  artifact = {
    ...artifact,
    recoveryPlan: { ...artifact.recoveryPlan!, groups: [...groups.slice(0, idx), reopenedGroup, ...groups.slice(idx + 1)] },
  }
  await artifactStore.set(artifact)
  return { artifact, group: reopenedGroup }
}

/**
 * REQUIRED PRODUCT INVARIANT: every target admitted into Repaso's required
 * mastery universe must have a viable canonical recovery path — Recovery
 * must never permanently 409 on a group whose targets have NO qualifying
 * evidence anywhere in the canonical material. That is a STATIC,
 * deterministic fact about the canonical source (re-checking it can never
 * change the outcome), so once `buildRepasoRecoveryQuestionGrounding`
 * finds zero candidates for an UNOPENED group, blocking forever is never
 * correct — but neither is fabricating a question or marking the targets
 * covered (no evidence exists to justify either).
 *
 * The honest, existing-architecture resolution is the SAME 'exhausted'
 * status `RepasoRecoveryGroup.status` already defines: it leaves the
 * group's targetIds and currentTargetStates completely untouched (still
 * genuinely 'missing', never fabricated as 'covered', never dropped from
 * the plan) while `currentRepasoRecoveryGroup` — unmodified — simply
 * skips a group in that status, so Continue advances instead of dead-
 * ending. Only ever applied to a group that has never been opened
 * (`!group.question.trim()`) and never answered; an already-authored or
 * already-answered group is untouched. Bounded by the group count so a
 * pathological cycle can never loop.
 */
async function skipEntirelyUngroundableRepasoGroups(
  artifactIn: RepasoArtifact,
  groundedContext: RepasarGroundedContext,
  artifactStore: { get(id: string): Promise<RepasoArtifact | null>; set(artifact: RepasoArtifact): Promise<void> },
): Promise<{ artifact: RepasoArtifact; group: ReturnType<typeof currentRepasoRecoveryGroup> }> {
  let artifact = artifactIn
  let group = currentRepasoRecoveryGroup(artifact)
  const guardLimit = (artifact.recoveryPlan?.groups.length ?? 0) + 1
  for (let guard = 0; group && !group.question.trim() && guard < guardLimit; guard++) {
    const grounding = buildRepasoRecoveryQuestionGrounding(group, groundedContext.targets)
    if (grounding.targetIds.length > 0) break
    console.error('[repaso-recovery-grounding]', {
      groupId: group.groupId,
      targetIds: group.targetIds,
      targetsFound: group.targetIds.length,
      targetsWithSourceSpans: groundedContext.targets.filter(t => group!.targetIds.includes(t.id) && (t.sourceSpans || []).length > 0).length,
      substantiveSpanCount: 0,
      rejectedReason: 'RECOVERY_TARGET_NOT_INDEPENDENTLY_RECOVERABLE_EXHAUSTED',
    })
    const groups = artifact.recoveryPlan!.groups
    const idx = groups.findIndex(item => item.groupId === group!.groupId)
    const exhaustedGroup = { ...group, status: 'exhausted' as const }
    // MASTERY/SCORE INVARIANT: a target with no valid canonical recovery
    // path is a SYSTEM coverage failure, never a student mastery failure.
    // Recording it here — append-only, provenance preserved, status left
    // exactly as-is ('missing', never fabricated 'covered') — is what lets
    // computeRepasoMasteryStatus/repasoScore exclude it from the "every
    // target resolved" gate and the score denominator, so this proven-
    // ungroundable target can never become a permanent, unrepairable
    // mastery/score dead-end for the student.
    const nonAssessableTargetIds = [...new Set([...(artifact.nonAssessableTargetIds || []), ...group.targetIds])]
    artifact = {
      ...artifact,
      recoveryPlan: { ...artifact.recoveryPlan!, groups: [...groups.slice(0, idx), exhaustedGroup, ...groups.slice(idx + 1)] },
      nonAssessableTargetIds,
    }
    await artifactStore.set(artifact)
    group = currentRepasoRecoveryGroup(artifact)
  }
  return { artifact, group }
}

export async function POST(req: NextRequest) {
  try {
    const session = await __routeDeps.getServerSession(authOptions);
    const userId = String((session?.user as { id?: string } | undefined)?.id || '');
    if (!userId) return errorResponse('UNAUTHORIZED', 401);

    // A client can legitimately send an empty/aborted POST body (a fetch
    // cancelled mid-flight, a duplicate request racing an abort signal) —
    // this is a malformed-request condition, not a server error. Handling
    // it explicitly avoids a raw "Unexpected end of JSON input" surfacing
    // as a generic 500 from the catch-all below.
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse('INVALID_CONFIG', 400, 'cuerpo de solicitud vacío o malformado');
    }

    if (RAW_SOURCE_AUTHORITY_KEYS.some(key => Object.prototype.hasOwnProperty.call(body || {}, key))) {
      return errorResponse('INVALID_CONFIG', 400, 'RAW_SOURCE_AUTHORITY_FORBIDDEN');
    }

    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) return errorResponse('INVALID_CONFIG', 400, 'sessionId requerido');

    // ── TARGET FREEZE ──────────────────────────────────────────────
    // `evaluate` (no `kind`) opens a NEW attempt → it freezes whatever
    // enrichment revision is authoritative right now. Every downstream
    // step of that SAME attempt (repair → teach-check → follow-up)
    // sends back only the opaque snapshotId, and the server restores
    // the frozen academic universe. Background enrichment may have
    // written R2 in the meantime; the live attempt never sees it.
    const repasoContinuationKinds = new Set([
      'repaso-recovery-open', 'repaso-recovery-answer',
      'repaso-final-open', 'repaso-final-answer', 'repaso-restore',
    ])
    const isRepasoContinuation = repasoContinuationKinds.has(String(body?.kind || ''))
    const artifactId = String(body?.artifactId || '').trim()
    const artifactStore = isRepasoContinuation ? __routeDeps.createRepasoArtifactStore() : null
    let restoredArtifact = artifactStore && artifactId ? await artifactStore.get(artifactId) : null
    if (isRepasoContinuation && !restoredArtifact) return errorResponse('REPASO_ARTIFACT_NOT_FOUND', 404)
    if (restoredArtifact && restoredArtifact.sessionId !== sessionId) {
      return errorResponse('REPASO_SESSION_MISMATCH', 403)
    }

    // ── DURABLE AUTHORITY ────────────────────────────────────────────
    // An artifact-bound continuation on an artifact that already carries
    // a frozen authority snapshot never touches the live session-
    // authority/materials-ownership dependency at all — it fails closed
    // on any ownership mismatch instead. A forged artifactId can never
    // borrow another user's ownership: the frozen snapshot IS that
    // user's own proven identity, compared directly against the
    // currently authenticated `userId` from `getServerSession` (local,
    // unaffected by this fix). Fresh creation, and any continuation on a
    // pre-migration artifact lacking the snapshot, still use the live
    // path — unchanged behavior for those cases — and opportunistically
    // backfill the snapshot the next time that live path succeeds, so
    // durability is gained forward without ever needing a migration.
    let enjoyerLookup: RepasarEnjoyerLookupResult
    if (restoredArtifact?.frozenAuthority) {
      if (restoredArtifact.frozenAuthority.userId !== userId) {
        return errorResponse('SESSION_NOT_FOUND', 404)
      }
      enjoyerLookup = await resolveRepasarEnjoyerAuthorityForContinuation(restoredArtifact.frozenAuthority)
    } else {
      enjoyerLookup = await resolveRepasarEnjoyerAuthority(sessionId, userId);
      if (enjoyerLookup.groundedContext && enjoyerLookup.sourceSelection && restoredArtifact && !restoredArtifact.frozenAuthority) {
        restoredArtifact = {
          ...restoredArtifact,
          frozenAuthority: {
            userId,
            materialIds: enjoyerLookup.sourceSelection.materialIds,
            selectedPages: enjoyerLookup.sourceSelection.selectedPages,
          },
        }
        await artifactStore!.set(restoredArtifact)
      }
    }
    if (!enjoyerLookup.groundedContext) return errorResponse(enjoyerLookup.code, enjoyerLookup.status);

    const isTeachCheck = body?.kind === 'teach-check';
    // ── READER FREEZE ────────────────────────────────────────────────
    // A NEW attempt legitimately takes whatever reader the user has
    // selected right now — that selection is frozen into the snapshot
    // from this point on. A `continue_attempt` call (teach-check) NEVER
    // supplies a reader here: reusing this same request's `body.mode`
    // for grading was the exact source of the live bug (a reader
    // re-read fresh on every call, capable of silently drifting from
    // what the attempt actually started with). The reader actually used
    // for evaluation is always read back from `frozenSnapshot.reader`
    // below — never from `body.mode` directly.
    const snapshotResolution = await __routeDeps.resolveRepasarSnapshot({
      groundedContext: enjoyerLookup.groundedContext,
      store: __routeDeps.createRepasarSnapshotStore(),
      intent: (isTeachCheck || isRepasoContinuation) ? 'continue_attempt' : 'new_attempt',
      requestedSnapshotId: isRepasoContinuation
        ? restoredArtifact!.initial.snapshotId
        : isTeachCheck ? String(body?.snapshotId || '').trim() : null,
      requestedReader: (isTeachCheck || isRepasoContinuation) ? undefined : normalizeReader(body?.mode),
    });
    if (!snapshotResolution.ok || !snapshotResolution.snapshot) {
      return errorResponse(snapshotResolution.code || 'SNAPSHOT_NOT_FOUND', snapshotResolution.status || 409);
    }
    const frozenSnapshot = snapshotResolution.snapshot;
    const groundedContext = snapshotGroundedContext(frozenSnapshot);
    // Authoritative for the ENTIRE remainder of this attempt — frozen at
    // creation, never re-read from a fresh client value again.
    const frozenReader: RepasarReader = frozenSnapshot.reader || 'libre';
    const groundedText = renderRepasarGroundedContextForPrompt(groundedContext);

    const modeConfig: Record<string, {
      persona: string;
      scoringGuide: string;
      strictness: string;
    }> = {
      nino: {
        persona: 'Niño',
        strictness: 'muy baja',
        scoringGuide: `
NIÑO — evalúa si captó la idea central con sus propias palabras.
0-29: no se entiende la idea central o está fuera de tema.
30-49: menciona algo relacionado pero la idea central no queda clara.
50-69: capta la idea central de forma básica.
70-84: explica la idea central con sentido y claridad, en lenguaje simple.
85-94: explica con seguridad y hace alguna conexión simple, aunque no use términos técnicos.
95-100: explicación clara, natural y sin errores, aunque sea simple.
NO exijas términos técnicos, nombres, fechas ni detalles secundarios para llegar a 70+.
`,
      },
      universitario: {
        persona: 'Universitario',
        strictness: 'media',
        scoringGuide: `
UNIVERSITARIO — evalúa si sirve para estudiar/responder en clase: idea central + relaciones + terminología razonable.
0-29: casi no hay contenido útil o está fuera del material.
30-49: menciona algo relacionado pero no comprende la idea central.
50-69: comprensión básica de la idea central, sin conectar con lo demás.
70-84: buena comprensión de la idea central y de varias relaciones, aunque falten detalles o profundidad.
85-94: comprensión sólida, conecta conceptos, terminología razonablemente precisa; puede faltar un detalle de profundidad menor.
95-100: comprensión completa, precisa y bien conectada.
Un detalle secundario u opcional omitido NO debe bajar una respuesta de 85+ a menos de 70.
`,
      },
      profesor: {
        persona: 'Profesor',
        strictness: 'alta',
        scoringGuide: `
PROFESOR — evalúa profundidad, integración, causalidad y precisión SOBRE la comprensión real demostrada, no sobre cobertura literal del documento.
0-29: irrelevante, vacía o muy equivocada.
30-49: la idea central está ausente o es superficial.
50-69: idea central correcta pero poco desarrollada, sin relaciones.
70-84: buena comprensión de la idea central y de varias relaciones/causas, con precisión razonable, aunque falte integrar algún matiz.
85-94: comprensión muy sólida, relaciones/causalidad bien explicadas, precisión alta; puede faltar profundidad en un aspecto secundario.
95-100: dominio excepcional: preciso, integrado, sin vacíos relevantes.
Ser más exigente significa pedir MÁS PROFUNDIDAD Y PRECISIÓN, no exigir que se repita cada dato del documento. Una respuesta que cubre bien la tesis y varias relaciones NO puede caer a 50-60 solo porque omitió un dato contextual o un ejemplo secundario — eso resta como mucho unos puntos dentro de la banda 70-94, nunca la tira a "comprensión básica".
`,
      },
      libre: {
        persona: 'Evaluador neutral',
        strictness: 'balanceada',
        scoringGuide: `
EVALUADOR NEUTRAL — evalúa estrictamente la evidencia presente, sin adaptar el estándar hacia arriba ni hacia abajo.
0-29: muy poca evidencia de comprensión.
30-49: comprensión parcial, con vacíos importantes.
50-69: comprensión básica pero incompleta.
70-84: buena comprensión; quedan aspectos relevantes por mejorar.
85-94: comprensión muy sólida; faltan detalles o profundidad menor.
95-100: dominio excepcional.
`,
      },
    };

    if (body?.kind === 'repaso-restore') {
      const deicticRepair = await repairStaleDeicticRepasoGroup(restoredArtifact!, groundedContext, artifactStore!)
      const { artifact, group: current } = await skipEntirelyUngroundableRepasoGroups(deicticRepair.artifact, groundedContext, artifactStore!)
      return NextResponse.json({
        ...repasoArtifactView(artifact, groundedContext.targets),
        ...(current?.question ? {
          groupId: current.groupId,
          question: current.question,
          pagesToReview: effectiveRepasoPagesToReview(current, groundedContext.targets),
          recoveryMaterialId: current.materialId,
        } : {}),
      })
    }

    if (body?.kind === 'repaso-recovery-open') {
      const deicticRepair = await repairStaleDeicticRepasoGroup(restoredArtifact!, groundedContext, artifactStore!)
      const repaired = await skipEntirelyUngroundableRepasoGroups(deicticRepair.artifact, groundedContext, artifactStore!)
      let artifact = repaired.artifact
      let group = repaired.group
      if (!group) {
        return NextResponse.json({
          ...repasoArtifactView(artifact, groundedContext.targets),
          verificationReady: computeRepasoMasteryStatus(artifact.currentTargetStates, artifact.finalVerification, repasoNonAssessableTargetIdSet(artifact)) === 'verification_ready',
        })
      }
      if (!group.question.trim()) {
        let grounding = buildRepasoRecoveryQuestionGrounding(group, groundedContext.targets)
        // A group with no successfully frozen question has never been shown
        // to the student, so it is still safe to repair/repartition — this
        // never touches a group that already has a frozen `question` (see
        // the `!group.question.trim()` guard above) or any covered target.
        if (!grounding.targetIds.length) {
          console.error('[repaso-recovery-grounding]', {
            groupId: group.groupId,
            targetIds: group.targetIds,
            targetsFound: group.targetIds.length,
            targetsWithSourceSpans: groundedContext.targets.filter(t => group!.targetIds.includes(t.id) && (t.sourceSpans || []).length > 0).length,
            substantiveSpanCount: 0,
            rejectedReason: 'RECOVERY_TARGET_CANONICAL_EVIDENCE_MISSING',
          })
          return errorResponse('REPASO_RECOVERY_GROUNDING_INCOMPLETE', 409)
        }
        if (grounding.targetIds.length !== group.targetIds.length) {
          const remainderIds = group.targetIds.filter(id => !grounding.targetIds.includes(id))
          console.warn('[repaso-recovery-grounding]', {
            groupId: group.groupId,
            targetIds: group.targetIds,
            targetsFound: group.targetIds.length,
            substantiveSpanCount: grounding.targetIds.length,
            candidatePages: grounding.recommendedPages,
            selectedAnchor: grounding.targetIds,
            rejectedReason: `repartitioned, ${remainderIds.length} target(s) deferred: ${remainderIds.join(',')}`,
          })
          const groups = artifact.recoveryPlan!.groups
          const idx = groups.findIndex(item => item.groupId === group!.groupId)
          const shrunkGroup: typeof group = { ...group, targetIds: grounding.targetIds, pages: grounding.recommendedPages }
          const remainderGroup: typeof group = {
            ...group,
            groupId: `${group.groupId}-repartitioned`,
            targetIds: remainderIds,
            pages: [],
            question: '',
          }
          artifact = {
            ...artifact,
            recoveryPlan: {
              ...artifact.recoveryPlan!,
              groups: [...groups.slice(0, idx), shrunkGroup, remainderGroup, ...groups.slice(idx + 1)],
            },
          }
          await artifactStore!.set(artifact)
          group = shrunkGroup
          grounding = buildRepasoRecoveryQuestionGrounding(group, groundedContext.targets)
        }
        // ONE owner of the Recovery-question budget, DETERMINISTIC-FIRST at
        // every tier before ever spending a provider call:
        // (1) full deterministic composition from the frozen grounding
        //     unit — zero provider calls when it already produces a
        //     specific, supported question;
        // (2) a minimal single-target deterministic fallback — ALSO zero
        //     provider calls, tried BEFORE the provider rather than after,
        //     since a live run showed the provider being asked (and
        //     spending 2 calls) for a question StudyAL could already
        //     compose from canonical data alone;
        // (3) provider authoring only when neither deterministic tier can
        //     produce a supported question, capped by
        //     authorRepasoRecoveryQuestion itself at <=2 calls (single
        //     repair attempt) — never invoked twice.
        // Never more than 2 provider calls per opened group, and 0 when
        // either deterministic tier already succeeds.
        let question: string
        let questionProvenance: 'template' | 'provider' = 'template'
        // FROZEN QUESTION -> EXPLICIT ASSESSED SCOPE, set atomically. For
        // BOTH deterministic tiers the composer itself already knows
        // exactly which targets its own wording came from — that draft
        // scope is trusted directly and NEVER reconstructed afterward by
        // scanning the finished question text. Re-deriving scope from text
        // against near-duplicate-labeled siblings (all sharing words like
        // "reacción"/"velocidad") previously let a single-target question
        // end up frozen with the ENTIRE group as its assessment scope — a
        // live-confirmed bug. Only the provider path (which has no
        // structured "ingredients" to trust) still uses text-derived scope.
        let assessedTargetIds: string[]
        let questionFamily: RepasoQuestionFamily | undefined
        // Both tiers are attempted (and logged as
        // [repaso-recovery-question-candidate], pass or fail) BEFORE ever
        // considering the provider.
        const smartFallback = composeDeterministicRepasoRecoveryQuestion(grounding, { groupId: group.groupId })
        const simpleFallback = smartFallback ? null : composeDeterministicRepasoRecoveryQuestion(grounding, { simple: true, groupId: group.groupId })
        if (smartFallback || simpleFallback) {
          const chosen = smartFallback || simpleFallback!
          question = chosen.question
          assessedTargetIds = chosen.assessedTargetIds
          questionFamily = chosen.questionFamily
        } else {
          try {
            question = await authorRepasoRecoveryQuestion(group, groundedContext)
            questionProvenance = 'provider'
          } catch {
            return errorResponse('REPASO_RECOVERY_QUESTION_UNSUPPORTED', 409)
          }
          // The provider has no structured "ingredients" to trust directly,
          // so scope is recovered deterministically from the authored text
          // — hardened to fail toward the NARROWEST defensible scope (a
          // single best-matching target) rather than ever silently
          // defaulting to the whole grounding unit. See deriveAssessedTargetIds.
          assessedTargetIds = deriveAssessedTargetIds(question, grounding.targets)
        }
        artifact = {
          ...artifact,
          recoveryPlan: {
            ...artifact.recoveryPlan!,
            groups: artifact.recoveryPlan!.groups.map(item => item.groupId === group.groupId
              ? { ...item, question, questionProvenance, assessedTargetIds, questionFamily }
              : item),
          },
        }
        await artifactStore!.set(artifact)
      }
      const current = currentRepasoRecoveryGroup(artifact)!
      const view = repasoArtifactView(artifact, groundedContext.targets)
      return NextResponse.json({
        ...view,
        groupId: current.groupId,
        question: current.question,
        pagesToReview: effectiveRepasoPagesToReview(current, groundedContext.targets),
        recoveryMaterialId: current.materialId,
      })
    }

    if (body?.kind === 'repaso-recovery-answer') {
      const artifact = restoredArtifact!
      const attemptClientId = String(body?.attemptClientId || '').trim()
      const answer = String(body?.answer || '').trim()
      if (!attemptClientId || !answer) return errorResponse('INVALID_CONFIG', 400, 'attemptClientId y answer requeridos')

      const persistedAttempt = artifact.recoveryAttempts.find(a => a.attemptId === attemptClientId)
      if (persistedAttempt) {
        const replayCurrent = currentRepasoRecoveryGroup(artifact)
        // A recovery-answer response — replay included — always snapshots the
        // group that was ACTUALLY ANSWERED, never "whatever is current now."
        // Mixing group identity fields from two different groups (e.g. Group
        // B's id with Group A's question) is exactly the live desync this
        // fix closes. `nextGroupId` remains the separate, explicit signal for
        // what Continue should open — the client must never treat it as part
        // of the current snapshot.
        const answeredGroup = artifact.recoveryPlan?.groups.find(g => g.groupId === persistedAttempt.groupId) ?? null
        const answeredPages = answeredGroup ? effectiveRepasoPagesToReview(answeredGroup, groundedContext.targets) : []
        // The frozen question's own assessed scope, not re-derived from
        // importance/tier and not re-guessed from the raw adjudication —
        // read from the SAME atomic snapshot the original answer used.
        const replayAssessedTargetIds = answeredGroup
          ? resolveRepasoAssessedTargetIds(answeredGroup, groundedContext.targets)
          : new Set(persistedAttempt.requestedTargetIds)
        return NextResponse.json({
          ...repasoArtifactView(artifact, groundedContext.targets),
          attempt: persistedAttempt,
          feedback: projectRepasoRecoveryFeedback(persistedAttempt, groundedContext.targets, answeredPages, replayAssessedTargetIds),
          nextGroupId: replayCurrent?.groupId || null,
          groupId: answeredGroup?.groupId ?? null,
          question: answeredGroup?.question ?? null,
          pagesToReview: answeredPages,
          recoveryMaterialId: answeredGroup?.materialId ?? null,
          idempotentReplay: true,
        })
      }

      // CORE INVARIANT: a Recovery answer is graded against the EXACT frozen
      // group the client says it is answering — resolved by explicit groupId
      // lookup in the persisted plan, never implicitly substituted for
      // "whatever is current now." `current` additionally establishes that
      // this frozen group is still the one the student is ALLOWED to answer
      // (groups must be resolved in order); a stale/resolved/skipped groupId
      // fails closed with REPASO_GROUP_NOT_CURRENT rather than silently
      // grading a different academic unit.
      const requestedGroupId = String(body?.groupId || '')
      const targetGroup = artifact.recoveryPlan?.groups.find(g => g.groupId === requestedGroupId)
      if (!targetGroup) return errorResponse('REPASO_GROUP_NOT_FOUND', 409)
      if (!targetGroup.question.trim()) return errorResponse('REPASO_GROUP_NOT_OPENED', 409)
      const current = currentRepasoRecoveryGroup(artifact)
      if (!current) return errorResponse('REPASO_NO_CURRENT_GROUP', 409)
      if (current.groupId !== targetGroup.groupId) {
        return errorResponse('REPASO_GROUP_NOT_CURRENT', 409)
      }
      const requestedTargetIds = targetGroup.targetIds.filter(id => artifact.currentTargetStates[id]?.status !== 'covered')
      const requestedSet = new Set(requestedTargetIds)
      const boundedTargets = groundedContext.targets.filter(target => requestedSet.has(target.id))
      const boundedContext: RepasarGroundedContext = {
        ...groundedContext,
        targets: boundedTargets,
        relations: groundedContext.relations.filter(r => requestedSet.has(r.fromTargetId) && requestedSet.has(r.toTargetId)),
      }
      const resolution = await resolveRepasarCoverage(boundedTargets, boundedContext, answer)
      if (!resolution.ok) {
        return NextResponse.json({
          error: 'REPASAR_COVERAGE_INCOMPLETE_RETRYABLE',
          totalTargets: boundedTargets.length,
          adjudicatedCount: resolution.verdicts.length,
          remainingTargetIds: resolution.unadjudicatedTargetIds,
        }, { status: 409 })
      }
      const rawAdjudications = resolution.verdicts as RepasoTargetAdjudication[]
      // Explicit fail-closed invariant: every adjudicated target must belong
      // to the frozen group being answered. resolveRepasarCoverage is scoped
      // to boundedTargets above so this can only fire on a genuine internal
      // inconsistency — never grade against a mismatched group silently.
      if (rawAdjudications.some(item => !requestedSet.has(item.targetId))) {
        return errorResponse('REPASO_GROUP_TARGET_MISMATCH', 409)
      }
      // QUESTION-SCOPED EXPECTATION (authoring intent): the raw canonical
      // adjudicator judges a target against its FULL canonical detail, not
      // against what THIS frozen question's own wording/family actually
      // asked. A 'partial' verdict on an "Ejemplo de X" target whose extra
      // worked-example detail was never invoked by this question's
      // wording/family is promoted to 'covered' here — before it ever
      // reaches transition/scoring/mastery logic — so every downstream
      // consumer (score, group progression, Continue, feedback) sees one
      // consistent, correctly-scoped truth. This never fabricates
      // evidence: only a target with genuine demonstrated content, whose
      // essential claim is not the whole of what's missing, is promoted;
      // every other target's 'partial' verdict — its own essential claim
      // incomplete, or the question explicitly asked for the exact detail
      // — is left exactly as adjudicated.
      const questionExpectations = new Map(
        deriveRepasoRecoveryQuestionExpectations(targetGroup.question, groundedContext.targets, [...requestedSet], targetGroup.questionFamily)
          .map(expectation => [expectation.targetId, expectation.requiresFullDetail]),
      )
      const adjudications = rawAdjudications.map(item => {
        if (isRepasoPartialSatisfiedByQuestionScope(item, questionExpectations.get(item.targetId) ?? true)) {
          return { ...item, status: 'covered' as const, missingDetail: '' }
        }
        return item
      })
      const preview = previewRepasoTransitions({
        currentTargetStates: artifact.currentTargetStates,
        adjudications,
        allowedTargetIds: requestedSet,
        kind: 'recovery',
        attemptId: attemptClientId,
      })
      const nonAssessableTargetIds = repasoNonAssessableTargetIdSet(artifact)
      const before = repasoScore(groundedContext.targets, artifact.currentTargetStates, nonAssessableTargetIds)
      const after = repasoScore(groundedContext.targets, preview.nextTargetStates, nonAssessableTargetIds)
      const createdAt = new Date().toISOString()
      const attempt: RepasoRecoveryAttempt = {
        attemptId: attemptClientId, groupId: targetGroup.groupId, createdAt, answer,
        requestedTargetIds, adjudicatedTargetIds: adjudications.map(a => a.targetId),
        adjudications, transitions: preview.transitions,
        scoreBefore: before.score, scoreAfter: after.score,
        letterBefore: before.letterGrade, letterAfter: after.letterGrade,
      }
      let next = applyRecoveryAttempt(artifact, attempt)

      // QUESTION-SCOPED MASTERY: the FROZEN QUESTION, not the organizational
      // group, defines what the student was actually asked to demonstrate.
      // `assessedTargetIds` was fixed atomically with the question at
      // authoring time (never re-derived from importance/tier, and never
      // re-guessed here). Only those targets gate retry/resolution/feedback
      // for THIS question. A sibling in `targetGroup.targetIds` that the
      // question never actually asked about — assessed or not, resolved or
      // not — is deferred into its own trailing group: preserved for a
      // later, separate Recovery pass, never silently marked covered (no
      // false mastery) and never allowed to block THIS question either.
      const assessedTargetIds = resolveRepasoAssessedTargetIds(targetGroup, groundedContext.targets)
      const unresolvedAssessed = requestedTargetIds.filter(id => assessedTargetIds.has(id) && next.currentTargetStates[id]?.status !== 'covered')
      const deferrable = requestedTargetIds.filter(id => !assessedTargetIds.has(id) && next.currentTargetStates[id]?.status !== 'covered')
      if (unresolvedAssessed.length === 0 && deferrable.length > 0 && next.recoveryPlan) {
        const deferredGroupId = `${targetGroup.groupId}-deferred`
        const alreadyDeferred = next.recoveryPlan.groups.some(g => g.groupId === deferredGroupId)
        if (!alreadyDeferred) {
          const deferredGroup = {
            ...targetGroup,
            groupId: deferredGroupId,
            targetIds: deferrable,
            question: '',
            questionProvenance: 'template' as const,
            assessedTargetIds: undefined,
          }
          next = {
            ...next,
            recoveryPlan: {
              ...next.recoveryPlan,
              groups: [
                ...next.recoveryPlan.groups.map(g => g.groupId === targetGroup.groupId
                  ? { ...g, targetIds: g.targetIds.filter(id => !deferrable.includes(id)) }
                  : g),
                deferredGroup,
              ],
            },
          }
        }
      }
      await artifactStore!.set(next)
      const nextCurrent = currentRepasoRecoveryGroup(next)
      const answeredPages = effectiveRepasoPagesToReview(targetGroup, groundedContext.targets)
      const currentQuestionResolved = unresolvedAssessed.length === 0
      const answerFeedback = projectRepasoRecoveryFeedback(attempt, groundedContext.targets, answeredPages, assessedTargetIds)
      console.log('[repaso-recovery-answer]', {
        groupId: targetGroup.groupId,
        question: truncateForLog(targetGroup.question),
        groupTargetIds: targetGroup.targetIds,
        assessedTargetIds: [...assessedTargetIds],
        assessedStatuses: [...assessedTargetIds].map(id => next.currentTargetStates[id]?.status ?? null),
        currentQuestionResolved,
        remainingUnresolvedTargetIds: deferrable,
        feedbackStatus: answerFeedback.status,
        nextGroupId: nextCurrent?.groupId ?? null,
      })
      // Invariant: a 'partial' verdict with no scoped blocking gap is a bug
      // (per the certified product model, the student was never told what
      // essential part of THIS question is missing) — surfaced loudly in
      // DEV rather than silently trapping the student in an unwinnable retry.
      if (answerFeedback.status === 'partial' && answerFeedback.needsWork.length === 0 && process.env.NODE_ENV !== 'production') {
        console.error('[repaso-recovery-answer] INVARIANT VIOLATION: partial status with no scoped blocking gap', {
          groupId: targetGroup.groupId, assessedTargetIds: [...assessedTargetIds],
        })
      }
      return NextResponse.json({
        ...repasoArtifactView(next, groundedContext.targets),
        attempt,
        feedback: answerFeedback,
        // `nextGroupId` is a separate, explicit signal only — the client
        // must never fold it into the active groupId/question snapshot.
        nextGroupId: nextCurrent?.groupId || null,
        // The response ALWAYS snapshots the group that was JUST ANSWERED —
        // whether it is now resolved or still unresolved. It never jumps
        // ahead to `nextCurrent` before the student clicks Continuar: doing
        // so previously let Group B's id enter the view while Group A's
        // frozen question text was still the one on screen/being retried.
        // Advancing to the next group is exclusively repaso-recovery-open's
        // job (called by continueAfterRecoveryFeedback), which replaces the
        // ENTIRE group snapshot atomically from a single source.
        groupId: targetGroup.groupId,
        question: targetGroup.question,
        pagesToReview: answeredPages,
        recoveryMaterialId: targetGroup.materialId,
        idempotentReplay: false,
      })
    }

    if (body?.kind === 'repaso-final-open') {
      const artifact = restoredArtifact!
      if (computeRepasoMasteryStatus(artifact.currentTargetStates, artifact.finalVerification, repasoNonAssessableTargetIdSet(artifact)) === 'not_ready') {
        return errorResponse('REPASO_VERIFICATION_NOT_READY', 409)
      }
      // FINAL PRODUCT FLOW: Final Verification is retired from the active
      // path — Recovery completion IS the final result now, with no
      // closed-book stage in between. A brand-new verification set is
      // never generated (zero provider calls here). A LEGACY artifact
      // that already persisted one before this change stays fully
      // readable — never regenerated, never required again — for
      // backward compatibility only.
      if (!artifact.finalVerification) {
        return errorResponse('REPASO_FINAL_VERIFICATION_RETIRED', 410)
      }
      return NextResponse.json(repasoArtifactView(artifact, groundedContext.targets))
    }

    if (body?.kind === 'repaso-final-answer') {
      const artifact = restoredArtifact!
      if (!artifact.finalVerification) return errorResponse('REPASO_VERIFICATION_NOT_OPEN', 409)
      const attemptClientId = String(body?.attemptClientId || '').trim()
      const answer = String(body?.answer || '').trim()
      if (!attemptClientId || !answer) return errorResponse('INVALID_CONFIG', 400, 'attemptClientId y answer requeridos')
      const replay = artifact.finalVerification.checks.find(check => check.attemptId === attemptClientId)
      if (replay) {
        return NextResponse.json({ ...repasoArtifactView(artifact, groundedContext.targets), check: replay, idempotentReplay: true })
      }
      const check = artifact.finalVerification.checks.find(item => item.status === 'pending')
      if (!check) return errorResponse('REPASO_VERIFICATION_COMPLETE', 409)
      if (String(body?.checkId || '') !== check.checkId) return errorResponse('REPASO_CHECK_NOT_CURRENT', 409)
      const checkIds = new Set(check.targetIds)
      const targets = groundedContext.targets.filter(target => checkIds.has(target.id))
      const boundedContext: RepasarGroundedContext = {
        ...groundedContext, targets,
        relations: groundedContext.relations.filter(r => checkIds.has(r.fromTargetId) && checkIds.has(r.toTargetId)),
      }
      const resolution = await resolveRepasarCoverage(targets, boundedContext, answer)
      if (!resolution.ok) {
        return NextResponse.json({ error: 'REPASAR_COVERAGE_INCOMPLETE_RETRYABLE', remainingTargetIds: resolution.unadjudicatedTargetIds }, { status: 409 })
      }
      const adjudications = resolution.verdicts as RepasoTargetAdjudication[]
      const preview = previewRepasoTransitions({
        currentTargetStates: artifact.currentTargetStates,
        adjudications, allowedTargetIds: checkIds,
        kind: 'final_verification', attemptId: attemptClientId,
      })
      const finalNonAssessableTargetIds = repasoNonAssessableTargetIdSet(artifact)
      const before = repasoScore(groundedContext.targets, artifact.currentTargetStates, finalNonAssessableTargetIds)
      const after = repasoScore(groundedContext.targets, preview.nextTargetStates, finalNonAssessableTargetIds)
      const passed = adjudications.every(adj => adj.status === 'covered')
      let next = applyFinalVerificationResult(artifact, {
        verificationId: artifact.finalVerification.verificationId,
        checkId: check.checkId, studentAnswer: answer,
        adjudicatedTargetIds: adjudications.map(a => a.targetId), adjudications,
        transitions: preview.transitions, status: passed ? 'passed' : 'failed',
        scoreBefore: before.score, scoreAfter: after.score,
        letterBefore: before.letterGrade, letterAfter: after.letterGrade,
        createdAt: new Date().toISOString(), attemptId: attemptClientId,
      })
      if (!passed) {
        const reopened = buildRepasoRecoveryPlan({
          planId: next.recoveryPlan?.planId || `replan_${randomUUID()}`,
          createdAt: next.recoveryPlan?.createdAt || new Date().toISOString(),
          targets: groundedContext.targets,
          relations: groundedContext.relations,
          currentTargetStates: next.currentTargetStates,
        })
        const existingIds = new Set(next.recoveryPlan?.groups.map(group => group.groupId) || [])
        next = {
          ...next,
          recoveryPlan: {
            planId: next.recoveryPlan?.planId || reopened.planId,
            createdAt: next.recoveryPlan?.createdAt || reopened.createdAt,
            groups: [
              ...(next.recoveryPlan?.groups || []),
              ...reopened.groups.filter(group => !existingIds.has(group.groupId)),
            ],
          },
        }
      }
      await artifactStore!.set(next)
      return NextResponse.json({
        ...repasoArtifactView(next, groundedContext.targets),
        check: next.finalVerification!.checks.find(item => item.checkId === check.checkId),
        idempotentReplay: false,
      })
    }


    if (body?.kind === 'repaso-initial') {
      const reviewTargets = groundedContext.targets
      const explanation = String(body?.explanation || '').trim()

      const coverageResolution = await resolveRepasarCoverage(
        reviewTargets,
        groundedContext,
        explanation,
      )

      if (!coverageResolution.ok) {
        return NextResponse.json(
          {
            error: 'REPASAR_COVERAGE_INCOMPLETE_RETRYABLE',
            totalTargets: reviewTargets.length,
            adjudicatedCount: coverageResolution.verdicts.length,
            remainingTargetIds: coverageResolution.unadjudicatedTargetIds,
          },
          { status: 409 },
        )
      }

      const validTargetCoverage = coverageResolution.verdicts

      const domainMap = computeRepasarDomainMap(
        reviewTargets,
        validTargetCoverage,
      )

      // REPASO SCORE V2 — deterministic, derives ONLY from the canonical
      // domain map (existing IMPORTANCE_WEIGHT tiers, existing
      // correct/partial/total weights). No provider quality call, no
      // qualityFrac, no reader/persona effect. Legacy/default evaluate
      // deliberately keeps its own provider-composed formula unchanged —
      // see evaluateRepasarInitialQuality, still used below by legacy.
      const score = computeRepasoCanonicalScore(domainMap)
      const letterGrade = computeRepasoLetterGrade(score)

      const artifactId = `repaso_${randomUUID()}`
      const planId = `replan_${randomUUID()}`
      const createdAt = new Date().toISOString()

      let artifact = createRepasoArtifact({
        artifactId,
        sessionId,
        snapshotId: frozenSnapshot.snapshotId,
        fingerprint: frozenSnapshot.fingerprint,
        explanation,
        createdAt,
        adjudications: validTargetCoverage,
        initialScore: score,
        initialLetterGrade: letterGrade,
      })
      // DURABLE AUTHORITY: freeze the ownership/source-selection identity
      // that `resolveRepasarEnjoyerAuthority` (the live path, the ONLY
      // path reachable here since a brand-new artifact never has a prior
      // frozenAuthority to bypass it) already proved live, right now —
      // so every future artifact-bound continuation can validate against
      // this snapshot instead of the live dependency.
      if (enjoyerLookup.sourceSelection) {
        artifact = {
          ...artifact,
          frozenAuthority: {
            userId,
            materialIds: enjoyerLookup.sourceSelection.materialIds,
            selectedPages: enjoyerLookup.sourceSelection.selectedPages,
          },
        }
      }

      const recoveryPlan = buildRepasoRecoveryPlan({
        planId,
        createdAt,
        targets: groundedContext.targets,
        relations: groundedContext.relations,
        currentTargetStates: artifact.currentTargetStates,
      })

      artifact = { ...artifact, recoveryPlan }

      const artifactStore = __routeDeps.createRepasoArtifactStore()
      await artifactStore.set(artifact)

      return NextResponse.json({
        ...repasoArtifactView(artifact, groundedContext.targets),
        snapshotId: artifact.initial.snapshotId,
        initialScore: artifact.initial.initialScore,
        initialLetterGrade: artifact.initial.initialLetterGrade,
        recoveryPlan: artifact.recoveryPlan,
      })
    }

    if (body?.kind === 'teach-check') {
      const repair = cleanRepair(body.repair);
      // Compat: si no llega `repair` (contrato canónico), cae al viejo
      // `concept` suelto — pero `repair` es la vía normal desde el cliente.
      const concept = repair.targetConcepts[0] || String(body.concept || '').trim();
      const lesson = String(body.lesson || '').trim();
      const answer = String(body.answer || '').trim();
      const mode: RepasarReader = frozenReader;
      // Autoridad: SIEMPRE el snapshot Enjoyer grounded del fingerprint
      // exacto, restaurado server-side; nunca texto crudo del cliente.
      const materialText = groundedText.slice(0, 12000);

      if (!concept && !repair.question) {
        return NextResponse.json({ error: 'No hay concepto para verificar.' }, { status: 400 });
      }

      if (!answer) {
        return NextResponse.json({ error: 'No hay respuesta para verificar.' }, { status: 400 });
      }

      const requiredFacts = repair.requiredFacts;
      const hasFixedFacts = requiredFacts.length > 0;

      // TRACEABILITY: revalida los repairTargetIds que el cliente devuelve
      // (los mismos que `evaluate` grounded contra este snapshot) contra el
      // universo AUTORITATIVO congelado — nunca se confía en el texto libre del
      // cliente como identidad. Un id que no exista en el snapshot (o que el
      // cliente haya alterado) se descarta silenciosamente, nunca se acepta
      // como si fuera un target real. Ver REP-TRACE-2/3.
      const knownTargetIds = new Set(groundedContext.targets.map(target => target.id))
      const requestedRepairTargetIds = Array.isArray(body.repair?.repairTargetIds)
        ? body.repair.repairTargetIds.map((value: any) => String(value || '').trim()).filter(Boolean)
        : []
      const verifiedTargetIds = requestedRepairTargetIds.filter((id: string) => knownTargetIds.has(id))

      // CONTRATO DETERMINISTA: si hay una lista fija de requiredFacts, no le
      // pedimos al modelo un veredicto libre (passed/stillMissing de texto
      // abierto) — eso es lo que le dejaba espacio para inventar un hecho
      // fuera del contrato (p.ej. "Conexión con la afición" cuando no era
      // parte de la reparación). En cambio, le pedimos un juicio hecho-por-
      // hecho, EN EL MISMO ORDEN que nuestra propia lista, y el servidor
      // (no el modelo) decide "passed" y arma "stillMissing" solo a partir
      // de esos índices — así es estructuralmente imposible que aparezca un
      // hecho que no estaba en el contrato.
      const parsedCheck: any = await __routeDeps.generateValidatedLegacyJson({
        taskType: 'evaluation_question',
        temperature: 0.18,
        maxTokens: 1200,
        messages: [
          {
            role: 'system',
            content: hasFixedFacts ? `
Eres un tutor de StudyAL.
Vas a juzgar, HECHO POR HECHO, si el estudiante cubrió cada uno de los
HECHOS REQUERIDOS de esta reparación — nada más y nada menos.

CONTRATO DETERMINISTA (no lo rompas):
Los HECHOS REQUERIDOS de abajo son la ÚNICA checklist. Están numerados.
No agregues, no quites, no sustituyas ningún hecho por otro del material
aunque sea verdadero — si una idea no está en esa lista numerada, IGNÓRALA
por completo: no cuenta a favor ni en contra, y NUNCA la menciones como
"faltante".
Un hecho puede estar cubierto aunque aparezca mezclado dentro de la
explicación de otro concepto, con palabras totalmente distintas, o en
otro orden — lo que importa es si la IDEA está presente en la respuesta
completa, no el lugar, el título bajo el que aparece, ni el wording exacto.
Mencionar un hecho verdadero del material que NO está en la lista NO
compensa un hecho de la lista que sí falte.
No castigues por no usar palabras exactas ni por no repetir analogías o
ejemplos de ninguna mini lección — esas nunca son parte del rubric.

Para CADA hecho de la lista, EN ESE MISMO ORDEN, decide si está cubierto.

"improvedAnswer": SOLO una reformulación más clara de LA MISMA RESPUESTA
DEL ESTUDIANTE, cubriendo exactamente los HECHOS REQUERIDOS de arriba —
ni uno más, ni uno menos. Prohibido:
- inventar una taxonomía, categorización o estructura nueva que el
  estudiante no usó (p.ej. no agrupes en "pilares"/"dimensiones"/tipos
  nuevos si el estudiante no los mencionó);
- agregar hechos, ejemplos o analogías que no estén en HECHOS REQUERIDOS;
- cambiar el enfoque o el orden conceptual de la respuesta original.
Es pulir wording/claridad de lo que el estudiante ya dijo bien, no
reescribir una respuesta distinta.
Devuelve SOLO JSON válido.
` : `
Eres un tutor de StudyAL.
Verifica si el estudiante entendió el concepto que se le mostró.
No evalúes todo el material, solo esta reparación.
No castigues por no usar palabras exactas.
Acepta cualquier paráfrasis semánticamente correcta respecto al MATERIAL
FUENTE. Nunca exijas una analogía o ejemplo de la mini lección.

"improvedAnswer": SOLO una reformulación más clara de LA MISMA RESPUESTA
DEL ESTUDIANTE. No inventes una taxonomía o estructura nueva, no agregues
hechos que el estudiante no mencionó — es pulir wording, no reescribir
una respuesta distinta.
Devuelve SOLO JSON válido.
`,
          },
          {
            role: 'user',
            content: `
LECTOR:
${mode}

PREGUNTA QUE SE LE HIZO AL ESTUDIANTE:
${repair.question || '(sin pregunta específica, usa el concepto de abajo)'}

CONCEPTO GENERAL (solo contexto, NO es la checklist):
${repair.topicLabel || repair.targetConcepts.join(', ') || concept}

${hasFixedFacts ? `HECHOS REQUERIDOS (evalúa EXACTAMENTE estos ${requiredFacts.length}, en este orden — es la ÚNICA checklist):
${requiredFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : 'No hay una lista fija de hechos — usa el MATERIAL FUENTE como guía general para el concepto objetivo.'}

HECHOS OPCIONALES (contexto, nunca obligatorios para pasar):
${repair.optionalFacts.length ? repair.optionalFacts.map((f) => `- ${f}`).join('\n') : 'Ninguno'}

MATERIAL FUENTE (contexto para interpretar los hechos, nunca para agregar hechos nuevos a la checklist):
"""
${materialText || 'No se proporcionó material fuente.'}
"""

MINI LECCIÓN (solo contexto de lo que ya se le enseñó; NUNCA es el rubric):
"""
${lesson || 'Sin mini lección'}
"""

RESPUESTA DEL ESTUDIANTE:
"""
${answer}
"""

Devuelve EXACTAMENTE este JSON${hasFixedFacts ? ` (factCoverage debe tener EXACTAMENTE ${requiredFacts.length} elementos, uno por cada hecho, en el mismo orden)` : ''}:
{
  ${hasFixedFacts ? `"factCoverage": [
    { "covered": false, "note": "" }
  ],` : `"passed": false,
  "score": 0,
  "stillMissing": [],`}
  "message": "",
  "improvedAnswer": ""
}
`,
          },
        ],
        normalize: value => value,
        validate: value => {
          const record = value as any
          const errors: string[] = []
          if (hasFixedFacts) {
            if (!Array.isArray(record?.factCoverage) || record.factCoverage.length !== requiredFacts.length) {
              errors.push('STRUCTURAL_VALIDATION_FAILED:teach_check_fact_coverage_length')
            }
          } else if (typeof record?.passed !== 'boolean') {
            errors.push('STRUCTURAL_VALIDATION_FAILED:teach_check_passed')
          }
          if (!String(record?.message || '').trim()) errors.push('STRUCTURAL_VALIDATION_FAILED:teach_check_message')
          return { valid: errors.length === 0, errors }
        },
        telemetryContext: { route: 'review', phase: 'teach_check', concept },
      });

      let passed: boolean;
      let stillMissing: string[];
      let understood: string[];

      if (hasFixedFacts) {
        // Alineado por ÍNDICE a nuestra propia lista — el texto de
        // stillMissing/understood sale SIEMPRE de requiredFacts[i], nunca
        // de lo que el modelo devuelva como texto libre. Un índice faltante
        // (respuesta más corta de lo pedido) se trata como no cubierto
        // (fail-closed).
        const coverageArr = Array.isArray(parsedCheck.factCoverage) ? parsedCheck.factCoverage : [];
        const perFact = requiredFacts.map((fact, i) => ({ fact, covered: Boolean(coverageArr[i]?.covered) }));
        passed = perFact.length > 0 && perFact.every((f) => f.covered);
        stillMissing = perFact.filter((f) => !f.covered).map((f) => f.fact);
        understood = perFact.filter((f) => f.covered).map((f) => f.fact);
      } else {
        const score = cleanScore(parsedCheck.score);
        passed = Boolean(parsedCheck.passed) || score >= 70;
        stillMissing = cleanArray(parsedCheck.stillMissing);
        understood = cleanArray(parsedCheck.understood);
      }

      return NextResponse.json({
        // Same frozen attempt identity the client sent back (or the
        // legacy freeze established for a pre-freeze session).
        snapshotId: frozenSnapshot.snapshotId,
        enrichmentRevision: frozenSnapshot.enrichmentRevision,
        check: {
          passed,
          message: String(parsedCheck.message || ''),
          understood,
          stillMissing,
          improvedAnswer: String(parsedCheck.improvedAnswer || ''),
          // TRACEABILITY: los mismos target ids que `evaluate` marcó como
          // missing/incorrect, revalidados contra el snapshot arriba.
          // `confirmedTargetIds` solo se llena si el intento pasó — nunca
          // se "confirma" un target por texto libre del provider.
          targetIds: verifiedTargetIds,
          confirmedTargetIds: passed ? verifiedTargetIds : [],
        },
      });
    }

    // Autoridad académica: SIEMPRE el contexto grounded del Enjoyer
    // persistido y exacto, nunca materialText del cliente.
    const reviewTargets = groundedContext.targets;
    const targetBatches = chunkRepasarTargets(reviewTargets, REPASAR_TARGET_BATCH_SIZE);
    // Primary (narrative) call only ever sees its own batch's targets —
    // for the common case (targetBatches.length === 1) this is the
    // exact same full `groundedText` as before.
    const materialText = targetBatches.length > 1
      ? renderRepasarGroundedContextForPrompt({ ...groundedContext, targets: targetBatches[0] })
      : groundedText;
    const explanation = String(body.explanation || '').trim();
    const notes = String(body.notes || '').trim();
    const mode: RepasarReader = frozenReader;


    const selectedMode = modeConfig[mode] || modeConfig.libre;
    const materia = String(body.materia || '').trim();
    const tema = String(body.tema || '').trim();
    const previousWeakConcepts = Array.isArray(body.previousWeakConcepts) ? body.previousWeakConcepts : [];
    const masteryContext = body.masteryContext || null;

    if (!reviewTargets.length) {
      return NextResponse.json({ error: 'El material no tiene contenido revisable.' }, { status: 400 });
    }

    if (!explanation) {
      return NextResponse.json({ error: 'No hay explicación del usuario.' }, { status: 400 });
    }

    // ============================================================
    // CANONICAL ACADEMIC EVALUATION — ONE persona-neutral pass over
    // ALL batches, run BEFORE any reader/persona call. This is the
    // real-Clutch-2 fix: the SAME text against the SAME frozen snapshot
    // previously produced different target-level verdicts per reader
    // (niño 30/77 correct, universitario 29/77, profesor 21/77) because
    // targetCoverage was decided INSIDE the persona-flavored call below
    // — a "Profesor" scoringGuide literally instructs stricter standards
    // ("evalúa profundidad... precisión"), and the model applied that
    // strictness to fact-detection itself, not just to feedback tone.
    // Academic evidence (what the text demonstrates) must never depend
    // on which reader persona is selected — only feedback prose may.
    // Run in PARALLEL, in bounded rounds, until EVERY canonical target
    // has an explicit verdict — batches are a transport/reliability
    // detail and must never change how much of the material gets
    // adjudicated (1, 51, 150 targets all reach 100% or an explicit
    // retryable failure, never a silent partial "success").
    const coverageResolution = await resolveRepasarCoverage(reviewTargets, groundedContext, explanation);
    if (!coverageResolution.ok) {
      // Never persist/return a domainMap that renders transport-
      // unadjudicated targets as academic "no aparecieron" — that is
      // exactly the confusion this contract forbids (see
      // resolveRepasarCoverage's docstring: ACADEMIC missing vs
      // TRANSPORT/unadjudicated are never the same thing).
      return NextResponse.json({
        error: 'REPASAR_COVERAGE_INCOMPLETE_RETRYABLE',
        totalTargets: reviewTargets.length,
        adjudicatedCount: coverageResolution.verdicts.length,
        remainingTargetIds: coverageResolution.unadjudicatedTargetIds,
      }, { status: 409 });
    }
    const validTargetCoverage = coverageResolution.verdicts;
    const coveredTargetIds = validTargetCoverage
      .filter((entry: any) => entry.status === 'covered')
      .map((entry: any) => entry.targetId);
    // ACADEMIC UNIVERSE — server-authoritative, reader-invariant by
    // construction (computed from the canonical pass above, never from
    // anything the persona/feedback call returns).
    const domainMap = computeRepasarDomainMap(reviewTargets, validTargetCoverage);
    // Single source of truth for "what the student actually said"/"what's
    // missing" about a target — the SAME evidence/missingDetail strings
    // the canonical pass used to decide status. Never re-derived from the
    // persona/feedback call below.
    const canonicalEvidenceByTargetId = new Map(
      validTargetCoverage.map(entry => [entry.targetId, entry.evidence]),
    );
    const canonicalMissingDetailByTargetId = new Map(
      validTargetCoverage.map(entry => [entry.targetId, entry.missingDetail]),
    );
    // conceptStatus is a compact UI projection, never a second academic
    // taxonomy. Its identities and status come from the canonical Enjoyer
    // verdict; the reader provider contributes only explanatory wording.
    const sourceConceptMap = reviewTargets.slice(0, 12).map(target => ({
      concept: target.label,
      importance: target.importanceTier as Importance,
      canonicalStatus: domainMap.statusByTargetId[target.id] === 'demonstrated_correct'
        ? 'mastered' as const
        : domainMap.statusByTargetId[target.id] === 'demonstrated_partial'
          ? 'progress' as const
          : 'weak' as const,
      canonicalEvidence: canonicalEvidenceByTargetId.get(target.id) || '',
      canonicalMissingDetail: canonicalMissingDetailByTargetId.get(target.id) || '',
    }));
    const reviewCoverage = computeRepasarCoverage(reviewTargets, coveredTargetIds);
    const nonCoveredTargetIds = new Set(
      validTargetCoverage.filter(entry => entry.status !== 'covered').map(entry => entry.targetId),
    );
    const {
  parsed,
  qualityFrac,
  mastery,
  score,
  letterGrade,
} = await evaluateRepasarInitialQuality({
  materia,
  tema,
  mode,
  selectedMode,
  previousWeakConcepts,
  sourceConceptMap,
  masteryContext,
  materialText,
  notes,
  explanation,
  domainMap,
});
    const strengths = cleanArray(parsed.strengths);
    const missingConcepts = cleanArray(parsed.missingConcepts);
    const confusions = cleanArray(parsed.confusions);
    const conceptStatus = reconcileConceptStatus(parsed.conceptStatus, sourceConceptMap.length ? sourceConceptMap : null);

    // targetCoverage/domainMap/reviewCoverage/nonCoveredTargetIds were
    // already computed ABOVE from the canonical, persona-neutral pass —
    // this call's own `parsed.targetCoverage` (if any) is intentionally
    // never read: academic evidence is decided once, before persona is
    // ever injected, never re-decided per reader.

    const repairRaw = cleanRepair(parsed.repair);
    const requestedRepairTargetIds = Array.isArray(parsed.repair?.targetIds)
      ? parsed.repair.targetIds.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];
    const repairTargetIds = requestedRepairTargetIds
      .filter((id: string) => nonCoveredTargetIds.has(id))
      .slice(0, 5);
    // Fail-safe: si el provider no ancló ningún id válido pero SÍ hay
    // targets sin cubrir, usamos esos directamente — la reparación nunca
    // queda sin identidad grounded cuando hay gaps reales. Prioridad
    // DETERMINÍSTICA (nunca orden arbitrario de Set): mismo criterio que
    // "Corrige primero" (selectRepasarNextPriorityTargetId) — incorrecto
    // antes que parcial antes que omitido; crítico antes que supporting/
    // contextual; empate por centralidad de relaciones autorizadas.
    const priorityOrderedGaps = sortRepasarGapsByPriority(reviewTargets, domainMap, groundedContext.relations);
    const nextPriorityTargetId = priorityOrderedGaps[0] || null;
    const gapGroupsResult = buildRepasarGapGroups(reviewTargets, domainMap, groundedContext.relations);

    // "Para dominar el 100%" — every pending target (partial/incorrect/
    // omitted) resolved to a real, labeled academic item EXACTLY ONCE,
    // sourced 100% from the canonical domainMap (never re-asked of the
    // provider). Bounded so a 1000+-target material can't blow up the
    // payload: groups already come pre-clustered/bounded from
    // buildRepasarGapGroups; the remainder beyond that is itemized up to
    // GAP_REMAINDER_ITEM_CAP with labels, and anything past that is an
    // honest overflow COUNT (never silently dropped from the total —
    // domainMap's own counts remain the source of truth either way).
    const reviewTargetById = new Map(reviewTargets.map(t => [t.id, t]));
    const toGapItem = (id: string) => {
      const t = reviewTargetById.get(id);
      if (!t) return null;
      const status = domainMap.statusByTargetId[id];
      return {
        id, label: t.label, importanceTier: t.importanceTier, status,
        // Same single canonical evidence/missingDetail source as
        // conceptStatus's "Dijiste"/"Falta" (see canonicalEvidenceByTargetId
        // above) — never fabricated, and NEVER populated for an omitted
        // target (the invariant in reconcileCoverageEvidenceInvariant
        // guarantees omitted <=> empty evidence).
        evidence: canonicalEvidenceByTargetId.get(id) || '',
        missingDetail: canonicalMissingDetailByTargetId.get(id) || '',
      };
    };
    const GAP_REMAINDER_ITEM_CAP = 200;
    const gapRemainderItems = gapGroupsResult.remainderTargetIds.slice(0, GAP_REMAINDER_ITEM_CAP).map(toGapItem).filter(Boolean);
    const gapRemainderOverflow = Math.max(0, gapGroupsResult.remainderTargetIds.length - GAP_REMAINDER_ITEM_CAP);
    const pendingAcademicTargets = domainMap.demonstratedPartial + domainMap.demonstratedIncorrect + domainMap.omitted;
    const finalRepairTargetIds = repairTargetIds.length > 0
      ? repairTargetIds
      : priorityOrderedGaps.slice(0, 5);
    const repair = {
      ...repairRaw,
      question: sanitizeQuestionCardinality(repairRaw.question, repairRaw.requiredFacts.length),
      repairTargetIds: finalRepairTargetIds,
    };

    const reviewer = parsed.reviewer ? cleanReviewer(parsed.reviewer) : null;
    if (reviewer) {
      reviewer.rating = score;
      reviewer.persona = reviewer.persona || selectedMode.persona;
      reviewer.verdict = enforceNarrativeConsistency(reviewer.verdict, domainMap);
      reviewer.feedback = enforceNarrativeConsistency(reviewer.feedback, domainMap);
    }

    return NextResponse.json({
      // Frozen attempt identity — the client must send this back for
      // teach-check so the follow-up is graded against THIS attempt's
      // academic universe, not a newer enrichment revision.
      snapshotId: frozenSnapshot.snapshotId,
      enrichmentRevision: frozenSnapshot.enrichmentRevision,
      review: reviewCoverage,
      analysis: {
        score,
        level: levelFromScore(score),
        // Additive field — the "professor paper" letter grade. Existing
        // clients ignore it safely; consumed by the upcoming corrected-
        // paper UI (see REPASO_LETTER_GRADE_SCALE above).
        letterGrade: computeRepasoLetterGrade(score),
        masteryStage: String(parsed.masteryStage || masteryStage(score)),
        metrics: {
          // "coverage" es el porcentaje determinístico de review targets
          // del Enjoyer cubiertos por la explicación (ver
          // reviewCoverage arriba) — idéntico a mastery.recallPercent.
          coverage: reviewCoverage.coveragePercent,
          clarity: score,
          depth: score,
          connections: score,
        },
        summary: enforceNarrativeConsistency(stripScoreMentions(String(parsed.summary || parsed.feedback || '')), domainMap),
        mainIssue: enforceNarrativeConsistency(stripScoreMentions(String(parsed.mainIssue || '')), domainMap),
        scoreReason: enforceNarrativeConsistency(stripScoreMentions(String(parsed.scoreReason || '')), domainMap),
        estimatedNextScore: cleanScore(Math.max(parsed.estimatedNextScore || 0, Math.min(100, score + (score < 55 ? 25 : 15)))),
        // Las tres métricas siguientes vienen 100% de computeRepasarMastery
        // — NUNCA de números independientes que la IA invente. "Recordaste"
        // = amplitud del universo académico real demostrado (ponderada por
        // importancia, lector-invariante). "Explicaste" = calidad de lo que
        // SÍ abordó (única señal que la IA aporta, acotada 0-100). "Falta
        // reforzar" = fracción ponderada de gaps académicos reales
        // (parcial+incorrecto+omitido) — NUNCA `100 - dominio`: dominio ya
        // compone cobertura+calidad+penalización, así que su complemento no
        // es "cuánto material queda" (ese fue exactamente el bug real:
        // 13/76 gaps ~17% del material mostrándose como "50% Falta
        // reforzar" solo porque dominio había colapsado a 50).
        studyBreakdown: {
          remembered: mastery.recallPercent,
          explained: Math.round(qualityFrac * 100),
          missing: mastery.reinforcementPercent,
        },
        reviewer,
        conceptStatus,
        // ACADEMIC UNIVERSE (server-authoritative, N-agnostic — never a
        // provider-invented micro-taxonomy): totals over ALL reviewTargets,
        // plus a small, importance-ranked display slice for the UI. This
        // is what "Mapa de dominio" must read its totals from, never
        // conceptStatus.length.
        domainMap: {
          totalAcademicTargets: domainMap.totalAcademicTargets,
          demonstratedCorrect: domainMap.demonstratedCorrect,
          demonstratedPartial: domainMap.demonstratedPartial,
          demonstratedIncorrect: domainMap.demonstratedIncorrect,
          omitted: domainMap.omitted,
          coveragePercent: domainMap.coveragePercent,
          ...buildRepasarDisplayPriorities(reviewTargets, domainMap),
          // "Para dominar el 100%" — every pending target labeled and
          // grouped, sourced ONLY from the canonical domainMap. Groups
          // carry their own member `items` (id/label/importanceTier/
          // status) so the UI never needs a second lookup or another
          // provider call. `pendingAcademicTargets` is the single
          // authoritative "X conceptos necesitan refuerzo" number — it
          // MUST equal the count actually inspectable across
          // groups+remainder (asserted by REP-GAP-CONSISTENCY tests).
          pendingAcademicTargets,
          gapGroups: gapGroupsResult.groups.map(group => ({
            ...group,
            items: group.targetIds.map(toGapItem).filter(Boolean),
          })),
          gapRemainderCount: gapGroupsResult.remainderCount,
          gapRemainder: gapRemainderItems,
          gapRemainderOverflow,
          nextPriorityTargetId,
          nextPriorityTarget: nextPriorityTargetId ? toGapItem(nextPriorityTargetId) : null,
        },
        strengths,
        missingConcepts,
        confusions,
        weakConcepts: cleanArray(parsed.weakConcepts),
        actions: Array.isArray(parsed.actions)
          ? parsed.actions.map(cleanAction).filter((a: any) => a.title || a.detail).slice(0, 4)
          : [],
        teachMissing: parsed.teachMissing ? cleanMiniLesson(parsed.teachMissing) : null,
        repair,
        feedback: enforceNarrativeConsistency(stripScoreMentions(String(parsed.feedback || '')), domainMap),
        nextStep: stripScoreMentions(String(parsed.nextStep || '')),
      },
    });
  } catch (err: any) {
    console.error('REPASAR API ERROR:', err);
    // A transient upstream session-authority failure (already retried once
    // in resolveRepasarEnjoyerAuthority) surfaces as 503, not a generic
    // 500 — an accurate signal that nothing was mutated and the exact same
    // request can safely be retried, instead of masking it as an opaque
    // server error.
    const message = err?.message || 'Error analizando comprensión.'
    const status = SESSION_AUTHORITY_TRANSIENT_PATTERN.test(String(message)) ? 503 : 500
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
