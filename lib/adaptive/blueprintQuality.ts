export type BlueprintQualityStatus = 'complete' | 'degraded';

export interface BlueprintQualityMetrics {
  totalBlocks: number;
  concepts: number;
  formulas: number;
  entities: number;
  facts: number;
  examples: number;
  notes: number;
  genericNotes: number;
  genericNoteRatio: number;
  relationCount: number;
  highImportanceBlocks: number;
  textContainsFormulaLike: boolean;
}

export interface BlueprintQualityResult {
  status: BlueprintQualityStatus;
  metrics: BlueprintQualityMetrics;
  reasons: string[];
}

function norm(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function uniqueBy<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function looksFormula(text: string) {
  const t = norm(text);
  return (
    /(?:^|[^a-z])en\s*=/.test(t) ||
    /(?:^|[^a-z])[a-z]\s*=/.test(t) ||
    /\/n\^?2/.test(t) ||
    /eV\/n\^?2/i.test(text) ||
    /equation|ecuacion|formula|fórmula/.test(t)
  );
}

function looksEntity(text: string) {
  // Solo considerar entidades labels cortos (nombres propios, instituciones)
  if (text.length > 50) return false;
  const t = norm(text);
  return /^(niels bohr|bohr|rutherford|ernest|institute|instituto|nobel|world war)/.test(t) ||
    /(bohr|rutherford)/.test(t);
}

function looksApplication(text: string) {
  const t = norm(text);
  return /spectrum|espectro|transition|transicion|absor|emit|emision|emisión|hydrogen|hidrogeno/.test(t);
}

function looksConcept(text: string) {
  const t = norm(text);
  return /model|modelo|energy level|nivel de energia|quantum|cuantica|interpretation|interpretacion|reality|realidad|structure|estructura/.test(t);
}

function noteIsTooGeneric(block: any) {
  const kind = norm(block?.kind);
  const label = norm(block?.label);
  const summary = norm(block?.summary);

  if (kind !== 'note') return false;

  // nota genérica si no aporta estructura clara
  if (looksFormula(label + ' ' + summary)) return false;
  if (looksEntity(label + ' ' + summary)) return false;
  if (looksApplication(label + ' ' + summary)) return false;
  if (looksConcept(label + ' ' + summary)) return false;

  return true;
}

export function enrichBlueprintHeuristics(rawBlueprint: any): any {
  const blueprint = JSON.parse(JSON.stringify(rawBlueprint || {}));
  const blocks: any[] = blueprint.blocks || [];
  const concepts: any[] = blueprint.concepts || [];

  for (const block of blocks) {
    const label = String(block?.label || '');
    const summary = String(block?.summary || '');
    const text = `${label} ${summary}`;
    const kind = norm(block?.kind);

    // NUEVO: detectar entidades-párrafo (label muy largo = párrafo del PDF, no nombre)
    // Si el label tiene más de 60 chars, probablemente es un summary mal clasificado
    if (kind === 'entity' && label.length > 60) {
      // Intentar reclasificar por contenido del label
      if (looksFormula(label)) {
        block.kind = 'formula';
      } else if (looksConcept(label)) {
        block.kind = 'concept';
      } else {
        // Si no se puede clasificar, degradar a note (no exponer al usuario)
        block.kind = 'note';
      }
    }

    // Reclasificar notas genéricas cuando hay evidencia fuerte
    if (kind === 'note') {
      if (looksFormula(text)) {
        block.kind = 'formula';
      } else if (looksApplication(text)) {
        block.kind = 'example';
      } else if (looksEntity(label)) {   // solo usar label, no summary
        block.kind = 'entity';
      } else if (looksConcept(text)) {
        block.kind = 'concept';
      }
    }

    // Si importance viene muy baja por fallback, subir un poco cuando hay señal fuerte
    if ((block.importance ?? 50) <= 55) {
      if (block.kind === 'formula') block.importance = Math.max(block.importance || 50, 80);
      if (block.kind === 'concept') block.importance = Math.max(block.importance || 50, 70);
      if (block.kind === 'entity') block.importance = Math.max(block.importance || 50, 60);
      if (block.kind === 'example') block.importance = Math.max(block.importance || 50, 65);
    }

    // Si no tiene difficulty pero parece nuclear
    if (!block.difficulty || block.difficulty === 'basic') {
      if (block.kind === 'formula') block.difficulty = 'advanced';
      else if (/quantum|copenhagen|energy level|modelo atomico|atomic model/i.test(text)) {
        block.difficulty = 'intermediate';
      }
    }
  }

  // reconstruir concepts desde blocks si faltan
  const conceptKinds = new Set(['concept', 'definition', 'formula', 'entity', 'example', 'fact']);
  const derivedConcepts = blocks
    .filter(b => conceptKinds.has(norm(b.kind)))
    .map((b, i) => ({
      id: b.id || `derived_${i}`,
      name: b.label || '',
      kind: b.kind || 'concept',
      summary: b.summary || '',
      importance: b.importance ?? 50,
      difficulty: b.difficulty || 'basic',
      pages: b.pages || [],
      dependsOn: b.dependsOn || [],
      relatedTo: b.relatedTo || [],
    }))
    .filter(c => String(c.name || '').trim().length > 0);

  const mergedConcepts = uniqueBy(
    [...concepts, ...derivedConcepts],
    (c: any) => norm(c.name || c.label || c.id || '')
  );

  blueprint.blocks = blocks;
  blueprint.concepts = mergedConcepts;
  blueprint.uniqueConceptsIndex = mergedConcepts;

  return blueprint;
}

export function evaluateBlueprintQuality(blueprint: any): BlueprintQualityResult {
  const blocks: any[] = blueprint?.blocks || [];
  const concepts: any[] = blueprint?.concepts || [];

  const totalBlocks = blocks.length;
  const conceptBlocks = blocks.filter(b => norm(b.kind) === 'concept');
  const formulaBlocks = blocks.filter(b => norm(b.kind) === 'formula');
  const entityBlocks = blocks.filter(b => norm(b.kind) === 'entity');
  const factBlocks = blocks.filter(b => norm(b.kind) === 'fact');
  const exampleBlocks = blocks.filter(b => norm(b.kind) === 'example');
  const noteBlocks = blocks.filter(b => norm(b.kind) === 'note');
  const genericNotes = noteBlocks.filter(noteIsTooGeneric);

  const relationCount = blocks.reduce((sum, b) => {
    const rels = Array.isArray(b?.relations) ? b.relations.length : 0;
    const deps = Array.isArray(b?.dependsOn) ? b.dependsOn.length : 0;
    return sum + rels + deps;
  }, 0);

  const textContainsFormulaLike = blocks.some(b =>
    looksFormula(`${b?.label || ''} ${b?.summary || ''}`)
  );

  const metrics: BlueprintQualityMetrics = {
    totalBlocks,
    concepts: conceptBlocks.length,
    formulas: formulaBlocks.length,
    entities: entityBlocks.length,
    facts: factBlocks.length,
    examples: exampleBlocks.length,
    notes: noteBlocks.length,
    genericNotes: genericNotes.length,
    genericNoteRatio: totalBlocks > 0 ? genericNotes.length / totalBlocks : 0,
    relationCount,
    highImportanceBlocks: blocks.filter(b => (b.importance ?? 0) >= 80).length,
    textContainsFormulaLike,
  };

  const reasons: string[] = [];

  if (metrics.totalBlocks >= 20 && metrics.concepts < 5) {
    reasons.push(`Muy pocos conceptos detectados para ${metrics.totalBlocks} bloques (${metrics.concepts})`);
  }

  if (metrics.genericNoteRatio > 0.55) {
    reasons.push(`Demasiadas notas genéricas (${Math.round(metrics.genericNoteRatio * 100)}%)`);
  }

  if (metrics.textContainsFormulaLike && metrics.formulas === 0) {
    reasons.push('Se detectó patrón de fórmula en el texto pero no hay bloques fórmula');
  }

  if (metrics.entities < 2 && metrics.totalBlocks >= 15) {
    reasons.push('Muy pocas entidades detectadas para el tamaño del material');
  }

  if (metrics.relationCount < 3 && metrics.totalBlocks >= 15) {
    reasons.push('Muy pocas relaciones/dependencias para el tamaño del material');
  }

  const status: BlueprintQualityStatus = reasons.length > 0 ? 'degraded' : 'complete';

  return {
    status,
    metrics,
    reasons,
  };
}
