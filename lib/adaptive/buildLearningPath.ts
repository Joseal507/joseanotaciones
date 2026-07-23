import type {
  CanonicalBlueprint,
  CanonicalBlock,
  CanonicalConcept,
  CanonicalTopic,
  LearningPath,
  LearningPathEdge,
  LearningPathUnit,
  LearningRole,
} from './learningPathTypes';
import { validateLearningPath } from './validateLearningPath';

const ROLE_ORDER: Record<LearningRole, number> = {
  foundation: 0,
  problem: 1,
  mechanism: 2,
  application: 3,
  integration: 4,
  context: 5,
};

function norm(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function intersects(a: number[] = [], b: number[] = []) {
  const sb = new Set(b);
  return a.some(x => sb.has(x));
}

// Si un topic tiene demasiados bloques, se divide en subunidades
// para que ninguna sesión quede sobrecargada
const MAX_BLOCKS_PER_UNIT = 8;

function toCanonicalBlueprint(raw: any): CanonicalBlueprint {
  const blocks = raw?.blocks?.length
    ? raw.blocks
    : (raw?.globalOrderedAnalysis || []);

  // Ordenar bloques por globalOrder para garantizar consistencia
  const sortedBlocks = [...blocks].sort((a: any, b: any) =>
    (a.globalOrder ?? 0) - (b.globalOrder ?? 0)
  );

  // Derivar topics desde los bloques si no vienen explícitos
  // manteniendo el orden de primera aparición en el material
  let topics = raw?.topics?.length
    ? raw.topics
    : (raw?.topicsIndex || []);

  if (!topics.length && sortedBlocks.length) {
    // Inferir topics desde los bloques, en orden del material
    const seen = new Map<string, any>();
    for (const b of sortedBlocks) {
      const key = b.topicId || b.topicLabel;
      if (key && !seen.has(key)) {
        seen.set(key, {
          id: b.topicId || key,
          title: b.topicLabel || key,
          pages: b.pages || [],
          order: b.globalOrder,
        });
      }
    }
    topics = [...seen.values()];
  }

  return {
    version: raw?.version || 1,
    createdAt: raw?.createdAt || Date.now(),
    topics,
    blocks: sortedBlocks,
    concepts: raw?.concepts?.length
      ? raw.concepts
      : (raw?.uniqueConceptsIndex || []),
    materials: raw?.materials || [],
  };
}

function classifyBlockRole(block: CanonicalBlock): LearningRole {
  const label = norm(block.label);
  const summary = norm(block.summary);
  const topic = norm(block.topicLabel);
  const kind = norm(block.kind);
  const text = `${label} ${summary} ${topic}`;

  // ── PRIORIDAD 1: señales muy fuertes por kind / label ─────────────
  if (
    kind === 'formula' ||
    kind === 'example' ||
    /equation|ecuacion|formula|spectrum|espectro|transition|transicion|hydrogen|hidrogeno/.test(text)
  ) return 'application';

  // ── PRIORIDAD 2: topic del blueprint ───────────────────────────────
  if (/vida|biography|early life|formacion|formación|educacion|educación/.test(topic)) return 'foundation';
  if (/problema|problem|rutherford/.test(topic)) return 'problem';
  if (/modelo atomico|atomic model|bohr.*model/.test(topic)) return 'mechanism';
  if (/mecanica cuantica|quantum mechanic|interpretacion|interpretation|copenhague|copenhagen/.test(topic)) return 'integration';
  if (/liderazgo|legado|legacy|etica|ethics/.test(topic)) return 'context';
  if (/contexto|context|general/.test(topic)) return 'foundation';

  // ── PRIORIDAD 3: señales del contenido ─────────────────────────────
  if (/legacy|legado|technology|tecnolog|leadership|liderazgo|wwii|world war|nobel|institute|collaboration|debate|ethic|history|historia/.test(text)) {
    return 'context';
  }

  if (/quantum mechanics|mecanica cuantica|copenhagen|interpretation|philosophical|reality|realidad|knowledge|conocimiento/.test(text)) {
    return 'integration';
  }

  if (/problem|problema|limitations?|limitaciones?|rutherford|insufficient|insuficiente|mystery|misterio/.test(text)) {
    return 'problem';
  }

  if (/model|modelo|orbit|orbita|energy levels|niveles de energia|atomic structure|estructura atomica/.test(text)) {
    return 'mechanism';
  }

  if (/biography|biografia|born|nacio|education|educacion|who was|quien era/.test(text)) {
    return 'foundation';
  }

  // facts de guerra/nobel → context
  if (kind === 'fact') {
    if (/wwii|world war|nobel|prize|escape|collaboration/.test(text)) return 'context';
    return 'application';
  }

  if (kind === 'entity' || kind === 'note') return 'foundation';
  if (kind === 'concept') return 'mechanism';

  return 'foundation';
}

function buildUnitTitle(role: LearningRole, blocks: CanonicalBlock[]): string {
  if (role === 'foundation') return 'Construyendo las bases';
  if (role === 'problem') return 'Comprendiendo el problema';
  if (role === 'mechanism') return 'Entendiendo la explicación central';
  if (role === 'application') return 'Viendo cómo funciona';
  if (role === 'integration') return 'Conectando las ideas';
  if (role === 'context') return 'Impacto y contexto';
  return blocks[0]?.topicLabel || 'Unidad';
}

function buildUnitPurpose(role: LearningRole, blocks: CanonicalBlock[]): string {
  if (role === 'foundation') {
    return 'Establecer el contexto necesario para que lo que sigue tenga sentido.';
  }
  if (role === 'problem') {
    return 'Comprender la pregunta o limitación que motiva la búsqueda de una solución.';
  }
  if (role === 'mechanism') {
    return 'Comprender la explicación, modelo o mecanismo central del material.';
  }
  if (role === 'application') {
    return 'Ver cómo la explicación principal se aplica a evidencia o casos concretos.';
  }
  if (role === 'integration') {
    return 'Relacionar las ideas centrales para ampliar la comprensión del tema.';
  }
  if (role === 'context') {
    return 'Conectar el conocimiento con su impacto, consecuencias o legado.';
  }

  return 'Avanzar en el recorrido de aprendizaje.';
}

function shouldStartNewUnit(
  currentBlocks: CanonicalBlock[],
  nextBlock: CanonicalBlock,
  currentRole: LearningRole,
  nextRole: LearningRole,
): boolean {
  if (currentBlocks.length === 0) return false;

  // cambio de rol pedagógico = nueva unidad
  if (currentRole !== nextRole) return true;

  const prev = currentBlocks[currentBlocks.length - 1];
  const prevTopic = prev.topicId || prev.topicLabel;
  const nextTopic = nextBlock.topicId || nextBlock.topicLabel;

  // foundation/context/integration/application pueden agrupar varios blocks
  if (currentRole === 'foundation') return false;
  if (currentRole === 'context') return false;
  if (currentRole === 'integration') return false;
  if (currentRole === 'application') return false;

  // problem/mechanism sí se parten si cambia el topic
  return prevTopic !== nextTopic;
}

function buildRawUnits(blueprint: CanonicalBlueprint): LearningPathUnit[] {
  const sortedBlocks = [...blueprint.blocks].sort((a, b) => a.globalOrder - b.globalOrder);
  const units: LearningPathUnit[] = [];

  // REGLA: 1 topicId = 1 unit, salvo que tenga demasiados bloques
  // En ese caso, se divide en subunidades para evitar sesiones sobrecargadas
  const byTopic = new Map<string, CanonicalBlock[]>();
  const topicOrder: string[] = [];

  for (const block of sortedBlocks) {
    const key = block.topicId || block.topicLabel || '__notopic__';
    if (!byTopic.has(key)) {
      byTopic.set(key, []);
      topicOrder.push(key);
    }
    byTopic.get(key)!.push(block);
  }

  const bloomWeight: Record<string, number> = {
    create: 6, evaluate: 5, analyze: 4, apply: 3, understand: 2, remember: 1,
  };

  for (const topicKey of topicOrder) {
    const topicBlocks = byTopic.get(topicKey) || [];
    if (!topicBlocks.length) continue;

    // Dividir topics grandes en chunks de MAX_BLOCKS_PER_UNIT
    const chunks: CanonicalBlock[][] = [];
    if (topicBlocks.length <= MAX_BLOCKS_PER_UNIT) {
      chunks.push(topicBlocks);
    } else {
      // Dividir por la mitad si es mayor que el máximo
      // Intentar dividir en puntos de baja importancia para no cortar conceptos clave
      const mid = Math.ceil(topicBlocks.length / Math.ceil(topicBlocks.length / MAX_BLOCKS_PER_UNIT));
      for (let i = 0; i < topicBlocks.length; i += mid) {
        chunks.push(topicBlocks.slice(i, i + mid));
      }
    }

    chunks.forEach((chunk, chunkIdx) => {
      // Rol dominante = bloque con mayor importance × bloomWeight
      const dominantBlock = chunk.reduce((best, b) => {
        const scoreA = (best.importance || 50) * (bloomWeight[(best.bloomLevel || 'understand').toLowerCase()] || 2);
        const scoreB = (b.importance || 50) * (bloomWeight[(b.bloomLevel || 'understand').toLowerCase()] || 2);
        return scoreB > scoreA ? b : best;
      }, chunk[0]);

      const role = classifyBlockRole(dominantBlock);

      const topicIds = [...new Set(chunk.map(b => b.topicId).filter(Boolean) as string[])];
      const topicLabels = [...new Set(chunk.map(b => b.topicLabel).filter(Boolean))];
      const blockIds = chunk.map(b => b.id);
      const pages = [...new Set(chunk.flatMap(b => b.pages || []))].sort((a, b) => a - b);
      const concepts = chunk
        .filter(b => ['concept', 'definition', 'formula', 'entity'].includes((b.kind || '').toLowerCase()))
        .map(b => b.label)
        .filter(Boolean);

      const cogLoad = chunk.length
        + chunk.filter(b => (b.difficulty || '') === 'advanced').length * 2
        + chunk.filter(b => (b.kind || '') === 'formula').length * 1.5
        + chunk.filter(b => (b.importance || 0) >= 80).length * 0.5;

      const highImportanceCount = chunk.filter(b => (b.importance || 0) >= 70).length;

      // Si es un chunk de división, añadir índice al topicLabel
      // Usar el primer concepto/entidad del chunk si el topicLabel es genérico
      const GENERIC_LABEL = /^(contexto|context|general|introduccion|overview|misc|parte\s+\d+)/i;
      const baseLabel = topicLabels[0] || topicKey;
      const firstConcept = chunk.find(b =>
        ['concept', 'entity', 'definition'].includes((b.kind || '').toLowerCase())
      )?.label || '';

      const effectiveLabel = GENERIC_LABEL.test(baseLabel) && firstConcept
        ? firstConcept
        : baseLabel;

      const unitLabel = chunks.length > 1
        ? `${effectiveLabel} (parte ${chunkIdx + 1})`
        : effectiveLabel;

      units.push({
        id: `unit_${units.length}`,
        topicId: topicIds[0] || null,
        topicLabel: unitLabel,
        blockIds,
        pages,
        concepts,
        globalOrderStart: chunk[0].globalOrder,
        orderHint: chunk[0].globalOrder,
        cognitiveLoad: cogLoad,
        difficultyBreakdown: {
          basic: chunk.filter(b => b.difficulty === 'basic').length,
          intermediate: chunk.filter(b => b.difficulty === 'intermediate').length,
          advanced: chunk.filter(b => b.difficulty === 'advanced').length,
        },
        highImportanceCount,
        formulaCount: chunk.filter(b => (b.kind || '') === 'formula').length,
        bloomLevels: [...new Set(chunk.map(b => b.bloomLevel as any).filter(Boolean))],
        dependsOnTopicIds: [],
        role,
        topicLabels: [unitLabel],
      } as any);
    });
  }

  return units;
}

function buildBlockToUnitMap(units: LearningPathUnit[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const unit of units) {
    for (const blockId of unit.blockIds) map.set(blockId, unit.id);
  }
  return map;
}

function buildCandidateEdges(
  blueprint: CanonicalBlueprint,
  units: LearningPathUnit[],
): LearningPathEdge[] {
  const blockToUnit = buildBlockToUnitMap(units);
  const unitMap = new Map(units.map(u => [u.id, u]));
  const edgeSet = new Set<string>();
  const edges: LearningPathEdge[] = [];

  function pushEdge(fromUnitId: string, toUnitId: string, reason: string) {
    if (!fromUnitId || !toUnitId || fromUnitId === toUnitId) return;
    const key = `${fromUnitId}->${toUnitId}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ fromUnitId, toUnitId, reason });
  }

  for (const block of blueprint.blocks) {
    const currentUnitId = blockToUnit.get(block.id);
    if (!currentUnitId) continue;

    // dependsOn: target before current
    for (const depBlockId of block.dependsOn || []) {
      const depUnitId = blockToUnit.get(depBlockId);
      if (depUnitId && depUnitId !== currentUnitId) {
        pushEdge(depUnitId, currentUnitId, 'dependsOn');
      }
    }

    // relations
    for (const rel of block.relations || []) {
      if (!rel.targetId) continue;
      const targetUnitId = blockToUnit.get(rel.targetId);
      if (!targetUnitId || targetUnitId === currentUnitId) continue;

      if (['requires', 'extends', 'example_of'].includes(rel.type)) {
        pushEdge(targetUnitId, currentUnitId, rel.type);
      } else if (rel.type === 'causes') {
        pushEdge(currentUnitId, targetUnitId, rel.type);
      } else if (rel.type === 'explains') {
        pushEdge(currentUnitId, targetUnitId, rel.type);
      }
    }
  }

  // Normalización pedagógica del sentido de las edges
  const roleRank = ROLE_ORDER;
  const normalized: LearningPathEdge[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const from = unitMap.get(edge.fromUnitId);
    const to = unitMap.get(edge.toUnitId);
    if (!from || !to) continue;

    // Nunca self-edges
    if (from.id === to.id) continue;

    let a = from;
    let b = to;

    // Si la edge va "contra" la progresión pedagógica, invertirla
    if (roleRank[a.role] > roleRank[b.role]) {
      a = to;
      b = from;
    } else if (roleRank[a.role] === roleRank[b.role] && a.orderHint > b.orderHint) {
      a = to;
      b = from;
    }

    // No crear self-edges después del swap
    if (a.id === b.id) continue;

    const key = `${a.id}->${b.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push({
        fromUnitId: a.id,
        toUnitId: b.id,
        reason: edge.reason,
      });
    }
  }

  return normalized;
}

export function topologicalSortUnits(
  units: LearningPathUnit[],
  edges: LearningPathEdge[],
): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const unitMap = new Map(units.map(u => [u.id, u]));

  for (const u of units) {
    inDegree.set(u.id, 0);
    adj.set(u.id, []);
  }

  for (const edge of edges) {
    if (!adj.has(edge.fromUnitId) || !inDegree.has(edge.toUnitId)) continue;
    // Evitar self-edges
    if (edge.fromUnitId === edge.toUnitId) continue;
    adj.get(edge.fromUnitId)!.push(edge.toUnitId);
    inDegree.set(edge.toUnitId, (inDegree.get(edge.toUnitId) || 0) + 1);
  }

  // Ordenar SOLO por globalOrderStart (posición en el documento)
  // NUNCA por ROLE_ORDER — eso viola el orden del material
  const queue = units
    .filter(u => (inDegree.get(u.id) || 0) === 0)
    .sort((a, b) => ((a as any).globalOrderStart ?? (a as any).orderHint ?? 0) - ((b as any).globalOrderStart ?? (b as any).orderHint ?? 0));

  const ordered: string[] = [];

  while (queue.length > 0) {
    queue.sort((a, b) => ((a as any).globalOrderStart ?? (a as any).orderHint ?? 0) - ((b as any).globalOrderStart ?? (b as any).orderHint ?? 0));
    const current = queue.shift()!;
    ordered.push(current.id);

    for (const nextId of adj.get(current.id) || []) {
      const deg = (inDegree.get(nextId) || 0) - 1;
      inDegree.set(nextId, deg);
      if (deg === 0) {
        const next = unitMap.get(nextId);
        if (next) queue.push(next);
      }
    }
  }

  // Residuos por ciclos — ordenar por globalOrderStart
  const sortedSet = new Set(ordered);
  const residuals = units
    .filter(u => !sortedSet.has(u.id))
    .sort((a, b) => ((a as any).globalOrderStart ?? (a as any).orderHint ?? 0) - ((b as any).globalOrderStart ?? (b as any).orderHint ?? 0));
  for (const u of residuals) ordered.push(u.id);

  return ordered;
}

function assignOwnership(
  blueprint: CanonicalBlueprint,
  units: LearningPathUnit[],
  orderedUnitIds: string[],
): Record<string, string> {
  const conceptOwnerUnit: Record<string, string> = {};
  const unitMap = new Map(units.map(u => [u.id, u]));
  const blockLabelToUnit = new Map<string, string>();

  for (const unit of units) {
    for (const label of unit.concepts) {
      blockLabelToUnit.set(norm(label), unit.id);
    }
  }

  const orderedUnits = orderedUnitIds.map(id => unitMap.get(id)).filter(Boolean) as LearningPathUnit[];

  for (const concept of blueprint.concepts) {
    const kind = norm(concept.kind);
    if (!['concept', 'definition', 'formula'].includes(kind)) continue;

    let ownerId = blockLabelToUnit.get(norm(concept.name));

    if (!ownerId) {
      const byPages = orderedUnits.find(u => intersects(u.pages || [], concept.pages || []));
      if (byPages) ownerId = byPages.id;
    }

    if (!ownerId && orderedUnits.length > 0) {
      ownerId = orderedUnits[orderedUnits.length - 1].id;
    }

    if (ownerId) {
      conceptOwnerUnit[concept.id] = ownerId;
      const unit = unitMap.get(ownerId);
      if (unit) {
        if (!Array.isArray((unit as any).conceptIds)) (unit as any).conceptIds = [];
        if (!(unit as any).conceptIds.includes(concept.id)) {
          (unit as any).conceptIds.push(concept.id);
        }
      }
    }
  }

  return conceptOwnerUnit;
}

function enrichUnitsWithGraph(
  units: LearningPathUnit[],
  orderedUnitIds: string[],
  edges: LearningPathEdge[],
) {
  const prereqMap = new Map<string, string[]>();
  const unlockMap = new Map<string, string[]>();

  for (const u of units) {
    prereqMap.set(u.id, []);
    unlockMap.set(u.id, []);
  }

  for (const edge of edges) {
    prereqMap.get(edge.toUnitId)?.push(edge.fromUnitId);
    unlockMap.get(edge.fromUnitId)?.push(edge.toUnitId);
  }

  const depthMap = new Map<string, number>();
  for (const unitId of orderedUnitIds) {
    const prereqs = prereqMap.get(unitId) || [];
    const depth = prereqs.length
      ? Math.max(...prereqs.map(id => depthMap.get(id) || 0)) + 1
      : 0;
    depthMap.set(unitId, depth);
  }

  for (const u of units) {
    u.prerequisiteUnitIds = unique(prereqMap.get(u.id) || []);
    u.unlocksUnitIds = unique(unlockMap.get(u.id) || []);
    u.dependencyDepth = depthMap.get(u.id) || 0;
  }
}

export function buildLearningPath(rawBlueprint: any): LearningPath {
  const blueprint = toCanonicalBlueprint(rawBlueprint);

  const units = buildRawUnits(blueprint);
  const edges = buildCandidateEdges(blueprint, units);
  const orderedUnitIds = topologicalSortUnits(units, edges);

  enrichUnitsWithGraph(units, orderedUnitIds, edges);
  const conceptOwnerUnit = assignOwnership(blueprint, units, orderedUnitIds);

  const path: LearningPath = {
    units,
    orderedUnitIds,
    conceptOwnerUnit,
    edges,
  };

  const validation = validateLearningPath(path, blueprint);
  if (!validation.ok) {
    throw new Error(`LearningPath inválido: ${validation.errors.join(' | ')}`);
  }

  return path;
}
