import { generateValidatedLegacyJson } from '../ai/legacyRouteGeneration'
import type { PageChunk, KnowledgeUnitKind, RelationType, ImportanceTier } from './types'
import { detectStructuralEmphasis } from './importance'
import { recoverLLMResponse } from './truncationRecovery'
import { quoteExistsInSource } from './provenanceValidation'
import {
  createChunkTelemetry,
  recordRejection,
  type ChunkTelemetry,
  type RejectionReason,
} from './extractionTelemetry'
import { classifyFailure } from './retryClassification'
import { normalizeSemanticText } from './identity'

// ============================================================
// Extracción por chunk. Exhaustiva, SIN piso ni techo de cantidad.
//
// A. JSON Truncation Recovery — CONECTADO AL CAMINO LIVE REAL:
//    generateValidatedLegacyJson recibe recoverableArrayKeys=['units','relations'].
//    Cuando safeParseJson falla, legacyRouteGeneration intenta recovery
//    parcial con recoverLLMResponse ANTES de lanzar INVALID_JSON.
//    El resultado recuperado llega a normalize() con metadata __recovery__.
//
// C. Provenance Whitespace Normalization.
// D. Telemetría auditable raw/accepted/rejected con reasons.
// E. Retry Classification.
// ============================================================

export interface RawExtractedUnit {
  kind: KnowledgeUnitKind
  canonicalSubject: string
  qualifiers: string[]
  label: string
  statement: string
  quote?: string
  page: number
  domainTags: string[]
  modelSuggestedTier: ImportanceTier | null
  term?: string
  expression?: string
  variables?: { symbol: string; meaning: string }[]
  steps?: { order: number; text: string }[]
  illustratesSubject?: string
  value?: string
  aliases?: string[]
  /**
   * Provenance-of-provenance (P0 mission, Phase 6): 'fallback' when
   * this unit came from the deterministic exact-source fallback
   * (deterministicFallback.ts), never a provider call. Absent/undefined
   * means real provider-derived (rich) extraction — the default, so
   * every existing caller that never sets this field is unaffected.
   */
  origin?: 'rich' | 'fallback'
}

export interface RawExtractedRelation {
  type: RelationType
  fromSubject: string
  toSubject: string
  statement: string
  quote?: string
  page: number
}

export interface ChunkExtractionResult {
  units: RawExtractedUnit[]
  relations: RawExtractedRelation[]
  warnings: string[]
  droppedInvalidProvenance: number
  droppedStructural: number
  telemetry?: ChunkTelemetry
}

const VALID_KINDS: KnowledgeUnitKind[] = [
  'concept', 'fact', 'definition', 'formula', 'process', 'example', 'event_or_data', 'terminology',
]
const VALID_RELATION_TYPES: RelationType[] = [
  'depends_on', 'causes', 'part_of', 'contrasts_with', 'example_of', 'defined_by', 'applies_formula', 'precedes',
]
const VALID_TIERS: ImportanceTier[] = ['critical', 'supporting', 'contextual']

// Keys que le decimos a legacyRouteGeneration que recovery ante truncación
const EXTRACTION_ARRAY_KEYS = ['units', 'relations'] as const

function buildPrompt(chunk: PageChunk): string {
  if (chunk.sourceKind === 'vision') {
    return `Eres un extractor de conocimiento fiel a una descripción verificada de contenido VISUAL de una página académica.

MISIÓN: extrae conceptos, relaciones, fórmulas, estructuras, datos y relaciones espaciales explícitamente descritas. No asumas detalles ausentes. El provenance visual se adjunta externamente; NO generes quote ni inventes texto literal.

Usa los mismos tipos de unidad: concept | fact | definition | formula | process | example | event_or_data | terminology.
RELACIONES: depends_on | causes | part_of | contrasts_with | example_of | defined_by | applies_formula | precedes.
Cada unidad necesita canonicalSubject, qualifiers, label, statement, page, domainTags y modelSuggestedTier. Cada relación necesita fromSubject, toSubject, statement, type y page.

Descripción visual verificada (página ${chunk.pages[0]}):
${chunk.text}

Devuelve SOLO JSON válido:
{"units":[{"kind":"concept","canonicalSubject":"...","qualifiers":[],"label":"...","statement":"...","page":${chunk.pages[0]},"domainTags":[],"modelSuggestedTier":"supporting"}],"relations":[{"type":"part_of","fromSubject":"...","toSubject":"...","statement":"...","page":${chunk.pages[0]} }]}`
  }
  return `Eres un extractor de conocimiento exhaustivo y fiel a la fuente. Responde en el mismo idioma del material.

MISIÓN: extraer TODA unidad de conocimiento materialmente distinta y verificable del fragmento — hechos, conceptos, procesos, fórmulas y datos— sin resumir varias ideas diferentes en una sola, sin omitir ideas secundarias académicas y sin inventar nada. No conviertas dos frases que expresan la misma idea en duplicados.

TIPOS DE UNIDAD (usa el que corresponda, nunca inventes otro):
- "concept": una idea o noción general
- "fact": un hecho puntual
- "definition": una definición formal de un término
- "formula": una expresión simbólica/matemática con sus variables
- "process": un procedimiento con pasos ordenados
- "example": un ejemplo que ilustra otra unidad
- "event_or_data": una fecha, cifra o dato puntual
- "terminology": un término técnico y sus variantes/sinónimos vistos en el material

IDENTIDAD (crítico para no duplicar conocimiento):
- "canonicalSubject": el nombre ESTÁNDAR del sujeto, como aparecería en un índice temático.
- "qualifiers": contexto breve y literal de la fuente que (a) distingue esta unidad de otras con canonicalSubject parecido, O (b) identifica la instancia, ejemplo, experimento, caso, sistema, condición o escenario necesario para que la unidad tenga sentido de forma aislada. Para datos, mediciones, resultados de tablas, condiciones experimentales o valores de ejemplo ("event_or_data" y similares): si el valor depende de un escenario concreto, incluye SIEMPRE el contexto mínimo que identifica ese escenario, aunque no exista otra unidad con el mismo canonicalSubject. Usa únicamente contexto respaldado por la fuente — nunca inventes nombres de ejemplos, condiciones ni escenarios. No copies párrafos completos ni uses qualifiers para información académica que pertenece al statement; mantenlos cortos. Un hecho o concepto universal, que no depende de ninguna instancia concreta, puede seguir con qualifiers: [].

PROVENANCE (obligatorio, sin excepción):
- "quote": copia y pega una secuencia literal completa de 10 a 30 palabras del fragmento. Conserva exactamente palabras, símbolos y orden: NO parafrasees, normalices ni reconstruyas la cita.
- PROHIBIDO insertar "[...]", puntos suspensivos o texto omitido dentro de quote. Ejemplo inválido: "Inicialmente [...] 2.0 M". Usa una secuencia contigua exacta; si la tabla no ofrece una secuencia literal suficiente, no emitas ese objeto.
- "page": el número de página EXACTO de donde salió, tomado de los marcadores [Pagina N] del fragmento.
Una unidad sin quote+page verificable en el fragmento será DESCARTADA.

"domainTags": 1-3 etiquetas libres derivadas del propio material.
"modelSuggestedTier": "critical"|"supporting"|"contextual".

CAMPOS ESPECÍFICOS POR TIPO:
- definition: "term"
- formula: "expression", "variables": [{"symbol","meaning"}]
- process: "steps": [{"order","text"}]
- example: "illustratesSubject"
- event_or_data: "value"
- terminology: "aliases": [string]

RELACIONES: depends_on | causes | part_of | contrasts_with | example_of | defined_by | applies_formula | precedes
Cada relación necesita "fromSubject", "toSubject", "statement", "quote", "page".
La cita de cada relación también debe ser una copia literal presente en el fragmento. Si no existe una cita literal que respalde una unidad o relación, no la emitas.

Fragmento (páginas ${chunk.pages.join(', ')} del material):
${chunk.text}

Devuelve SOLO JSON válido:
{
  "units": [
    { "kind": "...", "canonicalSubject": "...", "qualifiers": [], "label": "...", "statement": "...", "quote": "...", "page": 0, "domainTags": [], "modelSuggestedTier": "supporting" }
  ],
  "relations": [
    { "type": "...", "fromSubject": "...", "toSubject": "...", "statement": "...", "quote": "...", "page": 0 }
  ]
}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

interface DropCounts { invalidProvenance: number; structural: number }

// General, structural, domain-agnostic rescue for ONE specific gap: an
// `event_or_data` unit is the one KnowledgeUnit kind Flashcards' validator
// requires to carry a non-empty qualifier when the value is instance/
// scenario-bound (a universal constant needs none; a measurement tied to
// a specific system/experiment/example does — see validate.ts's
// contextless_question gate). The extraction prompt already asks the
// model to put that distinguishing context directly into `qualifiers` —
// but real-deck evidence showed the model sometimes judges `qualifiers`
// empty while still putting the distinguishing context into `quote` (the
// verbatim source line), because `quote` and `qualifiers` are two
// independent model outputs with no cross-check between them. This never
// infers or invents anything: it only promotes the model's OWN already-
// verified-in-source `quote` field, and only when quantifiable structural
// signals suggest real content was left out of `qualifiers` — never a
// kind/domain-specific string match.
const EVENT_OR_DATA_QUALIFIER_QUOTE_MAX_LENGTH = 160
// A minimum count of NOVEL content tokens (present in the quote, absent
// from the statement) is the structural signal that the quote carries
// real distinguishing content the statement's own paraphrase dropped —
// raw character length is NOT a reliable proxy (a terse formula-notation
// quote is often textually SHORTER than its prose statement while still
// carrying strictly more distinguishing information, e.g. species names
// a paraphrase folded into a generic "el valor es X").
const EVENT_OR_DATA_QUALIFIER_MIN_NOVEL_TOKENS = 1
function rescueEventOrDataQualifierFromQuote(kind: string, qualifiers: string[], statement: string, quote: string | undefined): string[] {
  if (kind !== 'event_or_data' || qualifiers.length > 0 || !quote) return qualifiers
  const trimmedQuote = quote.trim()
  if (!trimmedQuote || trimmedQuote.length > EVENT_OR_DATA_QUALIFIER_QUOTE_MAX_LENGTH) return qualifiers
  const statementTokens = new Set(normalizeSemanticText(statement).split(' ').filter(Boolean))
  const quoteTokens = normalizeSemanticText(trimmedQuote).split(' ').filter(Boolean)
  const novelTokens = quoteTokens.filter(t => !statementTokens.has(t))
  if (novelTokens.length < EVENT_OR_DATA_QUALIFIER_MIN_NOVEL_TOKENS) return qualifiers
  return [trimmedQuote]
}

function normalizeRawUnit(
  raw: any,
  chunk: PageChunk,
  warnings: string[],
  drops: DropCounts,
  telemetry: ChunkTelemetry,
): RawExtractedUnit | null {
  const kind = String(raw?.kind || '') as KnowledgeUnitKind
  if (!VALID_KINDS.includes(kind)) {
    warnings.push(`unidad descartada (kind inválido: ${String(raw?.kind)}) en ${chunk.id}`)
    drops.structural++
    recordRejection(telemetry, 'invalid_kind', {
      kind: String(raw?.kind),
      canonicalSubject: raw?.canonicalSubject,
      detail: `kind inválido: ${String(raw?.kind)}`,
    })
    return null
  }
  const isVisual = chunk.sourceKind === 'vision'
  // Normalization, not weakened validation (mission: "si el modelo
  // devuelve información estructurada válida pero bajo un campo
  // alternativo permitido por nuestro propio contrato, normalízala
  // correctamente"): the extraction prompt's own schema tells the
  // model event_or_data units ALSO carry a `value` field ("una fecha,
  // cifra o dato puntual"). Live evidence showed the model repeatedly
  // filling `value` (a real, contractually-defined, already-schema-
  // legal field) while leaving `statement` empty for this one kind —
  // not a malformed response, but the model treating the terse value
  // as self-sufficient. `statement` is still REQUIRED afterward,
  // exactly as before; this only computes it from data the model
  // ALREADY provided and that already passed its own validation
  // (isNonEmptyString), never inventing new content. Quote/page/
  // provenance verification below is completely unaffected.
  // Same normalization, formula's own schema-legal field: the prompt's
  // "CAMPOS ESPECÍFICOS POR TIPO" section tells the model formula units
  // carry "expression" (the symbolic expression itself). Live evidence
  // (c1:s2) showed the SAME pattern as event_or_data — the model fills
  // `expression` and leaves `statement` empty, treating the symbolic
  // expression as self-sufficient. Backfill only, never invented: the
  // expression is already model-provided, already-schema-legal content.
  const isMissingStatement = !isNonEmptyString(raw?.statement)
  const effectiveStatement = isMissingStatement && kind === 'event_or_data' && isNonEmptyString(raw?.value)
    ? raw.value
    : isMissingStatement && kind === 'formula' && isNonEmptyString(raw?.expression)
      ? raw.expression
      : raw?.statement
  if (!isNonEmptyString(raw?.canonicalSubject) || !isNonEmptyString(effectiveStatement) || (!isVisual && !isNonEmptyString(raw?.quote))) {
    // Diagnostic precision (mission: "determina exactamente qué required
    // field está fallando") — name the SPECIFIC missing field(s), not
    // just "some required field", so a live run's rejection telemetry
    // pinpoints the exact defect without needing another investigation
    // pass. Field NAMES only, never the raw payload/content.
    const missingFields = [
      !isNonEmptyString(raw?.canonicalSubject) && 'canonicalSubject',
      !isNonEmptyString(effectiveStatement) && 'statement',
      (!isVisual && !isNonEmptyString(raw?.quote)) && 'quote',
    ].filter(Boolean) as string[]
    warnings.push(`unidad descartada (campos requeridos ausentes: ${missingFields.join(',')}) en ${chunk.id}`)
    drops.structural++
    recordRejection(telemetry, 'malformed_unit', {
      kind,
      canonicalSubject: raw?.canonicalSubject,
      detail: `campos requeridos ausentes: ${missingFields.join(',')}`,
    })
    return null
  }
  const page = Number(raw?.page)
  if (!Number.isInteger(page) || !chunk.pages.includes(page)) {
    warnings.push(`unidad descartada (page ${raw?.page} fuera del chunk ${chunk.id}, páginas válidas: ${chunk.pages.join(',')})`)
    drops.invalidProvenance++
    recordRejection(telemetry, 'invalid_provenance', {
      kind,
      canonicalSubject: raw?.canonicalSubject,
      page: raw?.page,
      detail: `page ${raw?.page} fuera del chunk, válidas: ${chunk.pages.join(',')}`,
    })
    return null
  }
  const quote = isVisual ? undefined : String(raw.quote).trim()
  if (!isVisual && !quoteExistsInSource(chunk.text, quote!)) {
    warnings.push(`unidad descartada (quote no verificable textualmente en ${chunk.id}): "${quote!.slice(0, 40)}..."`)
    drops.invalidProvenance++
    recordRejection(telemetry, 'quote_not_in_source', {
      kind,
      canonicalSubject: raw?.canonicalSubject,
      page,
      detail: `quote no encontrada en source: "${quote!.slice(0, 60)}"`,
    })
    return null
  }
  const modelTier = VALID_TIERS.includes(raw?.modelSuggestedTier) ? raw.modelSuggestedTier as ImportanceTier : null
  telemetry.acceptedUnits++
  const statementTrimmed = String(effectiveStatement).trim()
  const rawQualifiers = Array.isArray(raw?.qualifiers) ? raw.qualifiers.map((q: any) => String(q)).filter(Boolean) : []
  const qualifiers = rescueEventOrDataQualifierFromQuote(kind, rawQualifiers, statementTrimmed, quote)
  return {
    kind,
    canonicalSubject: String(raw.canonicalSubject).trim(),
    qualifiers,
    label: isNonEmptyString(raw?.label) ? String(raw.label).trim() : String(raw.canonicalSubject).trim(),
    statement: statementTrimmed,
    quote,
    page,
    domainTags: Array.isArray(raw?.domainTags) ? raw.domainTags.map((t: any) => String(t)).filter(Boolean) : [],
    modelSuggestedTier: modelTier,
    term: isNonEmptyString(raw?.term) ? raw.term : undefined,
    expression: isNonEmptyString(raw?.expression) ? raw.expression : undefined,
    variables: Array.isArray(raw?.variables)
      ? raw.variables.map((v: any) => ({ symbol: String(v?.symbol || ''), meaning: String(v?.meaning || '') })).filter((v: any) => v.symbol)
      : undefined,
    steps: Array.isArray(raw?.steps)
      ? raw.steps.map((s: any, idx: number) => ({ order: Number.isFinite(Number(s?.order)) ? Number(s.order) : idx + 1, text: String(s?.text || '') })).filter((s: any) => s.text)
      : undefined,
    illustratesSubject: isNonEmptyString(raw?.illustratesSubject) ? raw.illustratesSubject : undefined,
    value: isNonEmptyString(raw?.value) ? raw.value : undefined,
    aliases: Array.isArray(raw?.aliases) ? raw.aliases.map((a: any) => String(a)).filter(Boolean) : undefined,
  }
}

function normalizeRawRelation(
  raw: any,
  chunk: PageChunk,
  warnings: string[],
  drops: DropCounts,
  telemetry: ChunkTelemetry,
): RawExtractedRelation | null {
  const type = String(raw?.type || '') as RelationType
  if (!VALID_RELATION_TYPES.includes(type)) {
    warnings.push(`relación descartada (type inválido: ${String(raw?.type)}) en ${chunk.id}`)
    drops.structural++
    telemetry.rejectedRelations++
    return null
  }
  const isVisual = chunk.sourceKind === 'vision'
  if (!isNonEmptyString(raw?.fromSubject) || !isNonEmptyString(raw?.toSubject) || !isNonEmptyString(raw?.statement) || (!isVisual && !isNonEmptyString(raw?.quote))) {
    warnings.push(`relación descartada (campos requeridos ausentes) en ${chunk.id}`)
    drops.structural++
    telemetry.rejectedRelations++
    return null
  }
  const page = Number(raw?.page)
  if (!Number.isInteger(page) || !chunk.pages.includes(page)) {
    warnings.push(`relación descartada (page fuera del chunk ${chunk.id})`)
    drops.invalidProvenance++
    telemetry.rejectedRelations++
    return null
  }
  const quote = isVisual ? undefined : String(raw.quote).trim()
  if (!isVisual && !quoteExistsInSource(chunk.text, quote!)) {
    warnings.push(`relación descartada (quote no verificable textualmente en ${chunk.id}): "${quote!.slice(0, 40)}..."`)
    drops.invalidProvenance++
    telemetry.rejectedRelations++
    return null
  }
  telemetry.acceptedRelations++
  return {
    type,
    fromSubject: String(raw.fromSubject).trim(),
    toSubject: String(raw.toSubject).trim(),
    statement: String(raw.statement).trim(),
    quote,
    page,
  }
}

/**
 * Procesa el objeto parsed (que puede ser un resultado normal o un resultado
 * parcialmente recuperado de truncación) y actualiza la telemetría.
 *
 * El __recovery__ metadata es inyectado por legacyRouteGeneration cuando
 * safeParseJson falló pero recoverLLMResponse salvó objetos completos.
 */
function processNormalizedPayload(
  parsed: unknown,
  chunk: PageChunk,
  warnings: string[],
  drops: DropCounts,
  telemetry: ChunkTelemetry,
): { units: RawExtractedUnit[]; relations: RawExtractedRelation[] } {
  const obj = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    ? parsed as Record<string, unknown>
    : {}

  // Leer metadata de recovery si existe
  const recoveryMeta = obj.__recovery__ as {
    isPartial?: boolean
    strategy?: string
    truncatedObjectsPerArray?: Record<string, number>
  } | undefined

  if (recoveryMeta) {
    telemetry.wasRecovered = recoveryMeta.isPartial ?? false
    telemetry.recoveryStrategy = (recoveryMeta.strategy as ChunkTelemetry['recoveryStrategy']) ?? 'partial_recovery'
    const truncated = recoveryMeta.truncatedObjectsPerArray ?? {}
    telemetry.truncatedObjectsInResponse = Object.values(truncated).reduce((a, b) => a + b, 0)
    if (telemetry.wasRecovered) {
      warnings.push(`chunk ${chunk.id}: respuesta LLM truncada — recovery parcial aplicado, ${telemetry.truncatedObjectsInResponse} objeto(s) incompleto(s) descartado(s)`)
    }
  }

  const rawUnits: unknown[] = Array.isArray(obj.units) ? obj.units : []
  const rawRelations: unknown[] = Array.isArray(obj.relations) ? obj.relations : []

  telemetry.rawUnits = rawUnits.length
  telemetry.rawRelations = rawRelations.length

  const units = rawUnits
    .map((raw: any) => normalizeRawUnit(raw, chunk, warnings, drops, telemetry))
    .filter((u): u is RawExtractedUnit => u !== null)

  const relations = rawRelations
    .map((raw: any) => normalizeRawRelation(raw, chunk, warnings, drops, telemetry))
    .filter((r): r is RawExtractedRelation => r !== null)

  return { units, relations }
}

export interface ExtractChunkResult {
  extraction: ChunkExtractionResult
}

export async function extractChunk(chunk: PageChunk, batchLabel: string): Promise<ExtractChunkResult> {
  const prompt = buildPrompt(chunk)
  const drops: DropCounts = { invalidProvenance: 0, structural: 0 }
  const warnings: string[] = []
  const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
  let lastFailureClass: ReturnType<typeof classifyFailure> | null = null

  const result = await generateValidatedLegacyJson<{ units: RawExtractedUnit[]; relations: RawExtractedRelation[] }>({
    taskType: 'material_analysis',
    prompt,
    maxTokens: 4000,
    temperature: 0.15,
    // FIX 1: declarar las claves recuperables — conecta recovery al camino live real
    recoverableArrayKeys: [...EXTRACTION_ARRAY_KEYS],
    normalize: (parsed: unknown) => {
      return processNormalizedPayload(parsed, chunk, warnings, drops, telemetry)
    },
    validate: value => {
      const units = (value as any)?.units || []
      const errors: string[] = []
      if (units.length === 0) {
        const failureMsg = telemetry.wasRecovered
          ? 'recoverable-format:no_units_after_recovery'
          : 'STRUCTURAL_VALIDATION_FAILED:no_units_survived_validation'
        errors.push(failureMsg)
        lastFailureClass = classifyFailure(new Error(failureMsg), {
          wasRecovered: telemetry.wasRecovered,
          recoveredCount: units.length,
        })
      }
      return { valid: errors.length === 0, errors }
    },
    telemetryContext: { route: 'material-brain', phase: 'extract', chunk: batchLabel },
    // Material extraction owns scope refinement. Avoid six prompt variants for
    // the same structural failure: one normal attempt + one focused repair.
    failurePath: 'single_repair',
  }).then(value => ({ value, ok: true as const })).catch(error => {
    lastFailureClass = classifyFailure(error, {
      wasRecovered: telemetry.wasRecovered,
      recoveredCount: telemetry.acceptedUnits,
    })
    return { value: { units: [], relations: [] }, ok: false as const, error }
  })

  if (!result.ok) {
    const errMsg = (result as any).error?.message || 'error desconocido'
    const failClass = lastFailureClass?.class || 'transient'
    warnings.push(`chunk ${chunk.id} falló extracción tras agotar reintentos: ${errMsg} [class:${failClass}]`)
  }

  return {
    extraction: {
      units: result.value.units,
      relations: result.value.relations,
      warnings,
      droppedInvalidProvenance: drops.invalidProvenance,
      droppedStructural: drops.structural,
      telemetry,
    },
  }
}

/**
 * Helper para tests de integración: permite inyectar un provider mock
 * que devuelve raw text (posiblemente truncado) y verificar que el
 * camino real de extraction.ts recupera correctamente.
 *
 * El `mockAlaiText` simula lo que devolvería alai().text antes de safeParseJson.
 */
export async function extractChunkWithMockProvider(
  chunk: PageChunk,
  mockAlaiText: string,
): Promise<ExtractChunkResult> {
  const drops: DropCounts = { invalidProvenance: 0, structural: 0 }
  const warnings: string[] = []
  const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)

  // Simular exactamente el camino de legacyRouteGeneration:
  // 1. safeParseJson
  // 2. si falla, recoverLLMResponse con las mismas keys
  const { safeParseJson } = await import('../alai')
  const parsed = safeParseJson(mockAlaiText)

  let payloadToNormalize: unknown
  if (parsed !== null) {
    payloadToNormalize = parsed
    telemetry.recoveryStrategy = 'full_parse'
  } else {
    // Mismo recovery que haría legacyRouteGeneration
    const recovery = recoverLLMResponse(mockAlaiText, [...EXTRACTION_ARRAY_KEYS])
    const hasRecovered = EXTRACTION_ARRAY_KEYS.some(key => (recovery.result[key]?.length ?? 0) > 0)
    if (hasRecovered) {
      payloadToNormalize = {
        ...recovery.result,
        __recovery__: {
          isPartial: recovery.isPartial,
          strategy: recovery.strategy,
          truncatedObjectsPerArray: recovery.truncatedObjectsPerArray,
        },
      }
    } else {
      // 0 objetos recuperados — mismo resultado que INVALID_JSON sin recovery
      warnings.push(`chunk ${chunk.id} falló extracción tras agotar reintentos: INVALID_JSON:truncated_no_recovery [class:recoverable-format]`)
      return {
        extraction: {
          units: [],
          relations: [],
          warnings,
          droppedInvalidProvenance: 0,
          droppedStructural: 0,
          telemetry,
        },
      }
    }
  }

  const { units, relations } = processNormalizedPayload(payloadToNormalize, chunk, warnings, drops, telemetry)

  return {
    extraction: {
      units,
      relations,
      warnings,
      droppedInvalidProvenance: drops.invalidProvenance,
      droppedStructural: drops.structural,
      telemetry,
    },
  }
}

/**
 * Helper para tests y recovery manual: extrae unidades de raw LLM text.
 */
export function tryRecoverUnitsFromRawLLMText(
  rawText: string,
  chunk: PageChunk,
): {
  units: RawExtractedUnit[]
  relations: RawExtractedRelation[]
  wasRecovered: boolean
  truncatedCount: number
} {
  const recovery = recoverLLMResponse(rawText, [...EXTRACTION_ARRAY_KEYS])
  const drops: DropCounts = { invalidProvenance: 0, structural: 0 }
  const warnings: string[] = []
  const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
  telemetry.rawUnits = recovery.result.units?.length || 0
  telemetry.rawRelations = recovery.result.relations?.length || 0

  const units = (recovery.result.units || [])
    .map((raw: any) => normalizeRawUnit(raw, chunk, warnings, drops, telemetry))
    .filter((u): u is RawExtractedUnit => u !== null)

  const relations = (recovery.result.relations || [])
    .map((raw: any) => normalizeRawRelation(raw, chunk, warnings, drops, telemetry))
    .filter((r): r is RawExtractedRelation => r !== null)

  const truncatedCount = Object.values(recovery.truncatedObjectsPerArray).reduce((a, b) => a + b, 0)
  return { units, relations, wasRecovered: recovery.isPartial, truncatedCount }
}
