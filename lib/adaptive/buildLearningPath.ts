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

function toCanonicalBlueprint(raw: any): CanonicalBlueprint {
  return {
    version: raw?.version || 1,
    createdAt: raw?.createdAt || Date.now(),
    topics: raw?.topics?.length ? raw.topics : (raw?.topicsIndex || []),
    blocks: raw?.blocks?.length ? raw.blocks : (raw?.globalOrderedAnalysis || []),
    concepts: raw?.concepts?.length ? raw.concepts : (raw?.uniqueConceptsIndex || []),
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

  let currentBlocks: CanonicalBlock[] = [];
  let currentRole: LearningRole | null = null;
  let unitCounter = 0;

  function flush() {
    if (!currentBlocks.length || !currentRole) return;

    const topicIds = unique(currentBlocks.map(b => b.topicId).filter(Boolean) as string[]);
    const topicLabels = unique(currentBlocks.map(b => b.topicLabel).filter(Boolean));
    const blockIds = currentBlocks.map(b => b.id);
    const pages = unique(currentBlocks.flatMap(b => b.pages || [])).sort((a, b) => a - b);
    const concepts = currentBlocks
      .filter(b => ['concept', 'definition', 'formula', 'entity'].includes(String(b.kind || '').toLowerCase()))
      .map(b => b.label);

    const importance =
      currentBlocks.reduce((sum, b) => sum + (b.importance || 50), 0) / currentBlocks.length;

    const difficulty =
      currentBlocks.reduce((sum, b) => {
        if (b.difficulty === 'advanced') return sum + 3;
        if (b.difficulty === 'intermediate') return sum + 2;
        return sum + 1;
      }, 0) / currentBlocks.length;

    const cognitiveLoad =
      currentBlocks.length
      + currentBlocks.filter(b => b.difficulty === 'advanced').length * 2
      + currentBlocks.filter(b => b.kind === 'formula').length * 1.5
      + currentBlocks.filter(b => b.importance >= 80).length * 0.75;

    units.push({
      id: `unit_${unitCounter++}`,
      title: buildUnitTitle(currentRole, currentBlocks),
      purpose: buildUnitPurpose(currentRole, currentBlocks),
      topicIds,
      conceptIds: [],
      blockIds,
      prerequisiteUnitIds: [],
      unlocksUnitIds: [],
      orderHint: currentBlocks[0].globalOrder,
      dependencyDepth: 0,
      cognitiveLoad,
      importance,
      difficulty,
      role: currentRole,
      topicLabels,
      concepts,
      pages,
    });

    currentBlocks = [];
    currentRole = null;
  }

  for (const block of sortedBlocks) {
    const nextRole = classifyBlockRole(block);
    if (currentBlocks.length === 0) {
      currentBlocks.push(block);
      currentRole = nextRole;
      continue;
    }

    if (shouldStartNewUnit(currentBlocks, block, currentRole!, nextRole)) {
      flush();
      currentBlocks.push(block);
      currentRole = nextRole;
    } else {
      currentBlocks.push(block);
    }
  }

  flush();
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

function topologicalSortUnits(
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
    adj.get(edge.fromUnitId)!.push(edge.toUnitId);
    inDegree.set(edge.toUnitId, (inDegree.get(edge.toUnitId) || 0) + 1);
  }

  const queue = units
    .filter(u => (inDegree.get(u.id) || 0) === 0)
    .sort((a, b) => {
      const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (r !== 0) return r;
      return a.orderHint - b.orderHint;
    });

  const ordered: string[] = [];

  while (queue.length > 0) {
    queue.sort((a, b) => {
      const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (r !== 0) return r;
      return a.orderHint - b.orderHint;
    });

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

  // Si hay residuos por ciclos raros, agregar en orden estable
  for (const u of units) {
    if (!ordered.includes(u.id)) ordered.push(u.id);
  }

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
      const byPages = orderedUnits.find(u => intersects(u.pages, concept.pages || []));
      if (byPages) ownerId = byPages.id;
    }

    if (!ownerId && orderedUnits.length > 0) {
      ownerId = orderedUnits[orderedUnits.length - 1].id;
    }

    if (ownerId) {
      conceptOwnerUnit[concept.id] = ownerId;
      const unit = unitMap.get(ownerId);
      if (unit && !unit.conceptIds.includes(concept.id)) {
        unit.conceptIds.push(concept.id);
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
