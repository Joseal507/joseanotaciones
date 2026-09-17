import type {
  KnowledgeUnit, KnowledgeRelation, Provenance, MergeLogEntry,
  KnowledgeUnitKind, ImportanceTier, PageChunk,
} from './types'
import type { RawExtractedUnit, RawExtractedRelation, ChunkExtractionResult } from './extraction'
import { buildIdentity, identityId, decideMerge, normalizeSemanticText, mergeKindGroup } from './identity'
import { combineImportance, detectStructuralEmphasis } from './importance'
import { mergeSourceEvidence } from '../materials/sourceEvidence'
import type { SourceEvidence } from '../materials/sourceEvidence'
import { classifyAcademicRole, isDocumentBoilerplateText } from './academicRole'

const IS_DEV = process.env.NODE_ENV !== 'production'

interface Candidate {
  tempId: string
  raw: RawExtractedUnit
  chunk: PageChunk
  identity: ReturnType<typeof buildIdentity>
  structuralDeclared: boolean
  structuralEmphasized: boolean
}

function originOf(raw: RawExtractedUnit): 'rich' | 'fallback' {
  return raw.origin === 'fallback' ? 'fallback' : 'rich'
}

interface CanonicalAccumulator {
  id: string
  kind: KnowledgeUnitKind
  identity: ReturnType<typeof buildIdentity>
  label: string
  statement: string
  provenance: Provenance[]
  evidence: SourceEvidence[]
  domainTags: Set<string>
  displayQualifiers: Set<string>
  modelTiers: ImportanceTier[]
  structuralDeclared: boolean
  structuralEmphasized: boolean
  origin: 'rich' | 'fallback' | 'mixed'
  term?: string
  expression?: string
  variables: Map<string, { symbol: string; meaning: string }>
  steps: Map<number, string>
  illustratesSubject?: string
  value?: string
  aliases: Set<string>
}

export interface MergeResult {
  units: KnowledgeUnit[]
  relations: KnowledgeRelation[]
  mergeLog: MergeLogEntry[]
  unitsExtractedRaw: number
  droppedAmbiguousRelations: number
  relationWarnings: string[]
}

function tierRank(tier: ImportanceTier | null): number {
  if (tier === 'critical') return 3
  if (tier === 'supporting') return 2
  if (tier === 'contextual') return 1
  return 0
}

function bestModelTier(tiers: ImportanceTier[]): ImportanceTier | null {
  if (!tiers.length) return null
  return tiers.reduce((best, current) => (tierRank(current) > tierRank(best) ? current : best), tiers[0])
}

function appendProvenance(target: Provenance[], candidate: Provenance): void {
  const duplicate = target.some(existing =>
    existing.materialId === candidate.materialId
    && existing.page === candidate.page
    && existing.chunkId === candidate.chunkId
    && existing.quote === candidate.quote
  )
  if (!duplicate) target.push(candidate)
}

export function mergeExtractions(
  perChunkResults: { chunk: PageChunk; extraction: ChunkExtractionResult }[],
): MergeResult {
  const mergeLog: MergeLogEntry[] = []
  const buckets = new Map<string, CanonicalAccumulator[]>()
  let unitsExtractedRaw = 0
  let tempCounter = 0

  const allCandidates: Candidate[] = []
  for (const { chunk, extraction } of perChunkResults) {
    for (const raw of extraction.units) {
      unitsExtractedRaw++
      if (isDocumentBoilerplateText(raw.statement) || isDocumentBoilerplateText(raw.quote || '')) continue
      const identity = buildIdentity(raw.kind, raw.canonicalSubject, raw.qualifiers)
      const emphasis = chunk.sourceKind === 'vision'
        ? { declared: false, emphasized: false }
        : detectStructuralEmphasis(chunk.text, raw.quote || '')
      allCandidates.push({
        tempId: `tmp_${tempCounter++}`,
        raw,
        chunk,
        identity,
        structuralDeclared: emphasis.declared,
        structuralEmphasized: emphasis.emphasized,
      })
    }
  }

  for (const candidate of allCandidates) {
    const bucketKey = `${mergeKindGroup(candidate.raw.kind)}::${candidate.identity.semanticKey}`
    const bucket = buckets.get(bucketKey) || []

    let matched: CanonicalAccumulator | null = null
    for (const existing of bucket) {
      const decision = decideMerge(
        candidate.raw.kind, candidate.identity, candidate.raw.statement,
        existing.kind, existing.identity, existing.statement,
        { expression: candidate.raw.expression },
        { expression: existing.expression },
      )
      if (decision.merge) {
        matched = existing
        mergeLog.push({
          kind: 'merged',
          candidateIds: [existing.id, candidate.tempId],
          canonicalId: existing.id,
          reason: `${decision.reason} (overlap=${decision.overlap.toFixed(2)}) :: "${candidate.raw.canonicalSubject}" -> "${existing.label}"`,
        })
        break
      } else if (bucket.length > 0) {
        mergeLog.push({
          kind: 'not_merged',
          candidateIds: [existing.id, candidate.tempId],
          reason: `${decision.reason} (overlap=${decision.overlap.toFixed(2)}) :: "${candidate.raw.canonicalSubject}" vs "${existing.label}"`,
        })
      }
    }

    const provenance: Provenance | null = candidate.chunk.sourceKind === 'vision'
      ? null
      : {
          materialId: candidate.chunk.materialId,
          page: candidate.raw.page,
          quote: candidate.raw.quote || '',
          chunkId: candidate.chunk.id,
        }
    const evidence = candidate.chunk.evidence || []

    if (matched) {
      if (provenance) appendProvenance(matched.provenance, provenance)
      matched.evidence = mergeSourceEvidence(matched.evidence, evidence)
      candidate.raw.domainTags.forEach(tag => matched!.domainTags.add(tag))
      candidate.raw.qualifiers.forEach(q => { if (q.trim()) matched!.displayQualifiers.add(q.trim()) })
      matched.modelTiers.push(...(candidate.raw.modelSuggestedTier ? [candidate.raw.modelSuggestedTier] : []))
      matched.structuralDeclared = matched.structuralDeclared || candidate.structuralDeclared
      matched.structuralEmphasized = matched.structuralEmphasized || candidate.structuralEmphasized
      if (matched.origin !== originOf(candidate.raw)) matched.origin = 'mixed'
      applyExtras(matched, candidate.raw)
    } else {
      const propositionIdentity = candidate.raw.kind === 'formula'
        ? (candidate.raw.expression || candidate.raw.statement)
        : candidate.raw.statement
      const id = identityId(candidate.raw.kind, candidate.identity, propositionIdentity)
      const created: CanonicalAccumulator = {
        id,
        kind: candidate.raw.kind,
        identity: candidate.identity,
        label: candidate.raw.label,
        statement: candidate.raw.statement,
        provenance: provenance ? [provenance] : [],
        evidence: mergeSourceEvidence(evidence),
        domainTags: new Set(candidate.raw.domainTags),
        displayQualifiers: new Set(candidate.raw.qualifiers.map(q => q.trim()).filter(Boolean)),
        modelTiers: candidate.raw.modelSuggestedTier ? [candidate.raw.modelSuggestedTier] : [],
        structuralDeclared: candidate.structuralDeclared,
        structuralEmphasized: candidate.structuralEmphasized,
        origin: originOf(candidate.raw),
        variables: new Map(),
        steps: new Map(),
        aliases: new Set(),
      }
      applyExtras(created, candidate.raw)
      bucket.push(created)
      buckets.set(bucketKey, bucket)
    }
  }

  const allCanonical = [...buckets.values()].flat()
  const { relations, droppedAmbiguousRelations, relationWarnings } = resolveRelations(perChunkResults, allCanonical)

  const prerequisiteTargets = new Set(
    relations.filter(r => ['depends_on', 'part_of', 'precedes'].includes(r.type)).map(r => r.toUnitId),
  )

  const unitsWithRelations = new Set<string>()
  for (const r of relations) {
    unitsWithRelations.add(r.fromUnitId)
    unitsWithRelations.add(r.toUnitId)
  }

  const units: KnowledgeUnit[] = allCanonical.map(acc => {
    const importance = combineImportance({
      declaredInMaterial: acc.structuralDeclared,
      examMarked: acc.structuralEmphasized,
      repeatedAcrossPages: acc.provenance.length > 1,
      prerequisiteFor: prerequisiteTargets.has(acc.id),
      modelSuggestedTier: bestModelTier(acc.modelTiers),
    })
    const unit = assembleUnit(acc, importance)
    unit.academicRole = classifyAcademicRole(unit, unitsWithRelations)
    return unit
  })

  return { units, relations, mergeLog, unitsExtractedRaw, droppedAmbiguousRelations, relationWarnings }
}

function applyExtras(target: CanonicalAccumulator, raw: RawExtractedUnit) {
  if (raw.term && !target.term) target.term = raw.term
  if (raw.expression && !target.expression) target.expression = raw.expression
  if (raw.value && !target.value) target.value = raw.value
  if (raw.illustratesSubject && !target.illustratesSubject) target.illustratesSubject = raw.illustratesSubject
  for (const v of raw.variables || []) target.variables.set(v.symbol, v)
  for (const s of raw.steps || []) if (!target.steps.has(s.order)) target.steps.set(s.order, s.text)
  for (const a of raw.aliases || []) target.aliases.add(a)
  if (raw.statement.length > target.statement.length * 1.4) target.statement = raw.statement
}

function assembleUnit(acc: CanonicalAccumulator, importance: ReturnType<typeof combineImportance>): KnowledgeUnit {
  const base = {
    id: acc.id,
    identity: acc.identity,
    label: acc.label,
    statement: acc.statement,
    importance,
    provenance: acc.provenance,
    ...(acc.evidence.length > 0 ? { evidence: acc.evidence } : {}),
    domainTags: [...acc.domainTags],
    origin: acc.origin,
    ...(acc.displayQualifiers.size > 0 ? { displayQualifiers: [...acc.displayQualifiers] } : {}),
  }
  switch (acc.kind) {
    case 'definition':
      return { ...base, kind: 'definition', term: acc.term || acc.label }
    case 'formula':
      return { ...base, kind: 'formula', expression: acc.expression || '', variables: [...acc.variables.values()] }
    case 'process':
      return {
        ...base,
        kind: 'process',
        steps: [...acc.steps.entries()].sort((a, b) => a[0] - b[0]).map(([order, text]) => ({ order, text })),
      }
    case 'example':
      return { ...base, kind: 'example', illustrates: acc.illustratesSubject || '' }
    case 'event_or_data':
      return { ...base, kind: 'event_or_data', value: acc.value }
    case 'terminology':
      return { ...base, kind: 'terminology', aliases: [...acc.aliases] }
    case 'fact':
      return { ...base, kind: 'fact' }
    case 'concept':
    default:
      return { ...base, kind: 'concept' }
  }
}

// Relation subjects the model emits commonly follow the same
// "<core subject> [<qualifier/context>]" shape KnowledgeUnit
// canonicalSubject+qualifiers already use — e.g. "Presión [derivada de
// la ley de los gases ideales]". The bracketed suffix is CONTEXT about
// the subject, not part of its identity: it can legitimately name a
// completely different real entity (e.g. "la ley de los gases
// ideales", itself a real KnowledgeUnit elsewhere) without that making
// THIS relation's subject actually be about two entities. Using the
// full bracketed string for semanticKey/fuzzy-substring matching (as
// before) let that mentioned entity's own semanticKey get pooled in as
// a false cross-entity ambiguity. Only the CORE subject (before any
// bracket) is used for entity-bucket matching below; the bracket
// content is still passed through to scoring via `subject` in
// `contextString`, where it belongs (real discriminating content), not
// used to decide WHICH entity's bucket we are even looking in.
const RELATION_SUBJECT_BRACKET_PATTERN = /^(.*?)\s*\[(.*)\]\s*$/

function coreRelationSubject(subject: string): string {
  const match = subject.match(RELATION_SUBJECT_BRACKET_PATTERN)
  return match ? match[1].trim() : subject.trim()
}

function resolveSubjectWithContext(
  subject: string,
  rawRelation: RawExtractedRelation,
  bySemanticKey: Map<string, CanonicalAccumulator[]>,
): ResolveSubjectResult {
  const coreSubject = coreRelationSubject(subject)
  const key = normalizeSemanticText(coreSubject)
  let candidates = bySemanticKey.get(key)
  // The ANCHOR key(s) actually responsible for this candidate pool —
  // NOT the raw subject text. A model-produced relation subject is
  // often a rich descriptive phrase ("Constante de equilibrio de una
  // reacción multiplicada por un número"), not a bare canonical name —
  // bracket/qualifier-shaped annotations and rule descriptions are
  // common. Only the tokens of the actual matched semanticKey(s) are
  // "trivially shared by every candidate in this bucket and therefore
  // non-discriminating"; the REST of the subject text can carry real,
  // discriminating proposition content that scoring below must not
  // discard (see the exclusion set built from this, not from `subject`
  // directly).
  let anchorKeys: string[] = candidates && candidates.length > 0 ? [key] : []

  // Live evidence root cause ("en equilibrio" pooling 33 unrelated
  // candidates): a relation subject that is a short, generic phrase
  // ("en equilibrio") normalizes (stopwords stripped — "en" is one) to
  // a SINGLE common word ("equilibrio"). `candidateKey.includes(key)`
  // then matches EVERY real entity whose semanticKey merely CONTAINS
  // that one common word anywhere ("equilibrio quimico", "constante
  // equilibrio", "expresion equilibrio", ...) — a single generic token
  // is not a meaningful identity signal, it is noise. The legitimate
  // use of this fuzzy branch (bridging a cosmetic wrapper like
  // "Concepto de equilibrio químico" to the real "equilibrio quimico"
  // entity) ALWAYS involves a multi-token key on at least one side; a
  // lone token never needs to fuzzy-bridge anything (it either exact-
  // matches or it doesn't identify anything specific). Requiring at
  // least 2 tokens on the SHORTER side of the comparison keeps the
  // legitimate bridging case working while refusing to let a single
  // common word pool the entire domain.
  const MIN_FUZZY_MATCH_TOKENS = 2
  const keyTokenCount = key.split(' ').filter(Boolean).length

  if (!candidates || candidates.length === 0) {
    const matchingKeys: string[] = []
    if (keyTokenCount >= MIN_FUZZY_MATCH_TOKENS) {
      for (const candidateKey of bySemanticKey.keys()) {
        const candidateTokenCount = candidateKey.split(' ').filter(Boolean).length
        const shorterTokenCount = Math.min(keyTokenCount, candidateTokenCount)
        if (shorterTokenCount < MIN_FUZZY_MATCH_TOKENS) continue
        if (key.includes(candidateKey) || candidateKey.includes(key)) matchingKeys.push(candidateKey)
      }
    }
    if (matchingKeys.length === 1) {
      candidates = bySemanticKey.get(matchingKeys[0])
      anchorKeys = matchingKeys
    } else if (matchingKeys.length > 1) {
      // Genuine cross-entity ambiguity: the subject fuzzy-matches
      // several DIFFERENT real entities/topics, not several
      // propositions of ONE entity — never resolved via the entity-
      // representative fallback below (that fallback only applies to
      // a single, confirmed entity's own propositions).
      const pooled = matchingKeys.flatMap(k => bySemanticKey.get(k) || [])
      return { unit: null, ambiguousCount: pooled.length, ambiguousCandidates: pooled }
    }
    if (IS_DEV && keyTokenCount > 0 && keyTokenCount < MIN_FUZZY_MATCH_TOKENS && matchingKeys.length === 0) {
      console.log('[MaterialBrain] material_brain_relation_subject_too_generic', JSON.stringify({
        subject: coreSubject, normalizedKey: key,
      }))
    }
  }

  if (!candidates || candidates.length === 0) return { unit: null }
  if (candidates.length === 1) return { unit: candidates[0] }

  const contextString = `${subject} ${rawRelation.statement} ${rawRelation.quote || ''}`
  const normalizedContext = normalizeSemanticText(contextString)
  const contextTokens = new Set(normalizedContext.split(' ').filter(Boolean))
  // Only the matched ENTITY KEY's own tokens are excluded from
  // proposition-overlap scoring below — every candidate in this bucket
  // trivially shares exactly those tokens (that is how they were
  // bucketed), so that specific overlap carries zero discriminating
  // power. Anything else in the subject/statement/quote text — even
  // when it lives inside the same `subject` string — is real content
  // and must remain available to distinguish candidates (this was
  // previously over-excluded by stripping the ENTIRE subject string,
  // which threw away genuinely discriminating rule/qualifier text the
  // model had folded into the subject itself).
  const anchorTokens = new Set(anchorKeys.flatMap(k => k.split(' ').filter(Boolean)))
  const propositionContextTokens = new Set([...contextTokens].filter(token => !anchorTokens.has(token)))

  const scored = candidates.map(candidate => {
    let score = 0
    for (const q of candidate.identity.qualifiers) {
      const normQ = normalizeSemanticText(q)
      if (!normQ) continue
      if (normalizedContext.includes(normQ)) {
        score += 2
      } else {
        for (const token of normQ.split(' ').filter(Boolean)) {
          if (contextTokens.has(token)) score += 1
        }
      }
    }
    // Proposition-level signal (mission: "entity + kind + proposition +
    // qualifiers + source context", not qualifiers alone). When several
    // real, distinct propositions legitimately share one entity/topic
    // (atomicity is intentionally preserved — see identity.ts), most of
    // them carry qualifiers:[] (a proposition being universal, not
    // instance-bound, is exactly why it has no qualifier), so qualifier
    // overlap alone can never distinguish them and every real candidate
    // ties at score 0 — a FALSE ambiguity, not a genuine one. Token
    // overlap between the relation's own statement/quote and each
    // candidate's own statement is the same discriminator decideMerge
    // already uses for merge decisions, applied here to relation-target
    // selection instead: it lets a relation that clearly echoes one
    // specific proposition's content resolve to THAT unit, while two
    // candidates with equally low (near-zero) overlap still tie and
    // correctly fall through to ambiguous rejection below — never
    // inventing a link the relation's own text does not support.
    const candidateStatementTokensAll = normalizeSemanticText(candidate.statement).split(' ').filter(Boolean)
    const candidateStatementTokens = new Set(candidateStatementTokensAll.filter(token => !anchorTokens.has(token)))
    let propositionOverlap = 0
    for (const token of candidateStatementTokens) if (propositionContextTokens.has(token)) propositionOverlap++
    // Normalized by candidate statement length (not a raw count) so a
    // long, mostly-unrelated statement cannot outscore a short, truly
    // matching one just by sharing more incidental common words.
    // Require at least two distinct shared content tokens, not one — a
    // single coincidentally-shared word (e.g. the relation type's own
    // generic verb, "depende"/"causa", happening to also appear in an
    // unrelated candidate's statement) must never alone decide a
    // winner between real propositions.
    if (propositionOverlap >= 2 && candidateStatementTokens.size > 0) {
      score += Math.round((propositionOverlap / candidateStatementTokens.size) * 3)
    }
    return { candidate, score }
  })

  scored.sort((a, b) => b.score - a.score)

  if (scored[0].score > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
    return { unit: scored[0].candidate }
  }

  // ─── Entity-level relation fallback ──────────────────────────────
  // Architectural fix (not another scorer weight): a relation whose
  // text gives NO content signal distinguishing among candidates is
  // not necessarily "genuinely ambiguous" in the cross-entity sense —
  // by this point `candidates` is ALREADY guaranteed to be a SINGLE
  // entity/topic's own propositions (the only path that reaches here;
  // the fuzzy cross-entity pool above returns early as genuinely
  // ambiguous and never reaches this code). A relation like
  // "X part_of Equilibrio químico" is very often semantically an
  // ENTITY-level claim (about the topic as a whole), not a claim about
  // any ONE of its N distinct propositions specifically — forcing it
  // onto an arbitrarily-picked proposition would assert something the
  // source relation text never actually said (a false specificity).
  //
  // Rather than inventing a new relation-target ID space (which would
  // silently break every existing downstream consumer that looks up
  // relation.fromUnitId/toUnitId as a real KnowledgeUnit id — Flashcards,
  // Quiz, Free tools, the Debug Viewer — all untouched in this change),
  // this resolves to the single most defensible REAL unit standing in
  // for "the entity as a whole": the entity's own 'definition' unit if
  // exactly one exists, else its 'concept' unit if exactly one exists —
  // the two kinds that, by construction (extraction.ts's own prompt:
  // "definition: una definición formal de un término" / "concept: una
  // idea o noción general"), are the closest real proxy for the topic
  // itself, not a narrower fact/example/process about it. The result is
  // marked `resolution: 'entity_representative'` (additive, optional —
  // existing consumers reading only fromUnitId/toUnitId are unaffected)
  // so this is auditable and distinguishable from a precise proposition
  // match. If there is no single definition/concept candidate either,
  // this is genuinely undecidable even at entity granularity and still
  // rejects below — never guessing among several equally-plausible
  // definitional units.
  for (const preferredKind of ENTITY_REPRESENTATIVE_KIND_PRIORITY) {
    const matches = candidates.filter(candidate => candidate.kind === preferredKind)
    if (matches.length === 1) return { unit: matches[0], resolution: 'entity_representative' }
    if (matches.length > 1) {
      // A rich, well-developed topic legitimately has SEVERAL real
      // 'concept'/'definition' propositions (live evidence: this is
      // the common case for a topic like "Equilibrio químico", not an
      // edge case) — kind alone does not uniquely identify "the"
      // representative among them. `importance.tier` is an EXISTING,
      // already model-assigned signal (declared_in_material/
      // exam_marked/etc. — see importance.ts), not a new heuristic
      // invented here: further narrowing to the 'critical'-tier
      // candidate(s) among this kind is the same kind of signal the
      // rest of Material Brain already treats as "this is the central,
      // foundational content" (see eligibility.ts). If that uniquely
      // identifies one candidate, it is the representative; if not
      // (still >1, or none), this specific kind tier is genuinely
      // undecidable and the search continues to the next kind rather
      // than guessing among equally-plausible critical candidates.
      const critical = matches.filter(candidate => candidate.modelTiers.includes('critical'))
      if (critical.length === 1) return { unit: critical[0], resolution: 'entity_representative' }
      break
    }
  }

  return { unit: null, ambiguousCount: candidates.length, ambiguousCandidates: candidates }
}

/** Priority order for entity-level relation fallback — see resolveSubjectWithContext. */
const ENTITY_REPRESENTATIVE_KIND_PRIORITY: KnowledgeUnitKind[] = ['definition', 'concept']

interface ResolveSubjectResult {
  unit: CanonicalAccumulator | null
  ambiguousCount?: number
  ambiguousCandidates?: CanonicalAccumulator[]
  resolution?: 'entity_representative'
}

function resolveRelations(
  perChunkResults: { chunk: PageChunk; extraction: ChunkExtractionResult }[],
  canonical: CanonicalAccumulator[],
): { relations: KnowledgeRelation[]; droppedAmbiguousRelations: number; relationWarnings: string[] } {
  const bySemanticKey = new Map<string, CanonicalAccumulator[]>()
  for (const unit of canonical) {
    const key = unit.identity.semanticKey
    const list = bySemanticKey.get(key) || []
    list.push(unit)
    bySemanticKey.set(key, list)
  }

  const relations: KnowledgeRelation[] = []
  const relationWarnings: string[] = []
  let droppedAmbiguousRelations = 0
  let relCounter = 0

  for (const { chunk, extraction } of perChunkResults) {
    for (const raw of extraction.relations as RawExtractedRelation[]) {
      const fromRes = resolveSubjectWithContext(raw.fromSubject, raw, bySemanticKey)
      const toRes = resolveSubjectWithContext(raw.toSubject, raw, bySemanticKey)

      if (fromRes.ambiguousCount || toRes.ambiguousCount) {
        droppedAmbiguousRelations++
        // BUGFIX (live diagnostic inconsistency: "candidateCount=2 but
        // candidates[] contains 5 entries"): `count` and `candidates`
        // must always come from the SAME side. Picking each
        // independently via `a || b` could report fromRes's count
        // alongside toRes's candidate list whenever both sides were
        // ambiguous via different branches. Report each side that is
        // actually ambiguous explicitly and separately instead of
        // collapsing to a single (possibly mismatched) pair.
        const count = fromRes.ambiguousCount ?? toRes.ambiguousCount
        relationWarnings.push(
          `relación descartada (ambigua entre ${count} candidatas): "${raw.type}" de "${raw.fromSubject}" a "${raw.toSubject}" en chunk ${chunk.id}`,
        )
        // DEV-only diagnostic (mission: prove whether the residual
        // ambiguity is still cosmetic-duplicate fragmentation or
        // genuinely distinct propositions of one entity) — candidate
        // canonicalSubject + kind only, never statements/quotes/provider
        // payloads. `from`/`to` are reported independently so the
        // count always matches the length of its OWN candidate list.
        if (IS_DEV) {
          const describe = (res: ResolveSubjectResult) => res.ambiguousCount
            ? { candidateCount: res.ambiguousCount, candidates: (res.ambiguousCandidates || []).map(c => ({ canonicalSubject: c.identity.canonicalSubject, kind: c.kind, qualifiers: c.identity.qualifiers })) }
            : null
          console.log('[MaterialBrain] material_brain_relation_ambiguous', JSON.stringify({
            chunkId: chunk.id, relationType: raw.type, fromSubject: raw.fromSubject, toSubject: raw.toSubject,
            from: describe(fromRes), to: describe(toRes),
          }))
        }
        continue
      }

      if (!fromRes.unit || !toRes.unit) continue

      relations.push({
        id: `rel_${relCounter++}`,
        type: raw.type,
        fromUnitId: fromRes.unit.id,
        toUnitId: toRes.unit.id,
        ...(fromRes.resolution ? { fromResolution: fromRes.resolution } : {}),
        ...(toRes.resolution ? { toResolution: toRes.resolution } : {}),
        statement: raw.statement,
        importance: combineImportance({
          declaredInMaterial: false,
          examMarked: false,
          repeatedAcrossPages: false,
          prerequisiteFor: false,
          modelSuggestedTier: null,
        }),
        provenance: chunk.sourceKind === 'vision'
          ? []
          : [{ materialId: chunk.materialId, page: raw.page, quote: raw.quote || '', chunkId: chunk.id }],
        ...(chunk.evidence?.length ? { evidence: mergeSourceEvidence(chunk.evidence) } : {}),
      })
    }
  }
  return { relations, droppedAmbiguousRelations, relationWarnings }
}
