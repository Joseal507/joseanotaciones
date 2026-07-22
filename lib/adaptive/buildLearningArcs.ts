import type { LearningPath, LearningPathUnit, LearningRole } from './learningPathTypes';
import { displayName, compactConceptList } from './narrativeFormatter';
import { writeShortObjective } from './narrativeWriter';
import type { LearningArc } from './learningArcTypes';

function roleTitle(role: LearningRole): string {
  if (role === 'foundation') return 'Construyendo las bases';
  if (role === 'problem') return 'Comprendiendo el problema';
  if (role === 'mechanism') return 'Entendiendo la explicación central';
  if (role === 'application') return 'Viendo cómo funciona';
  if (role === 'integration') return 'Conectando las ideas';
  return 'Impacto y contexto';
}

function rolePurpose(role: LearningRole): string {
  if (role === 'foundation') return 'Construir el contexto necesario para entender lo que viene.';
  if (role === 'problem') return 'Comprender la pregunta o limitación que hace necesario lo siguiente.';
  if (role === 'mechanism') return 'Entender la idea, modelo o explicación central del material.';
  if (role === 'application') return 'Ver cómo esa explicación funciona frente a la evidencia o los casos concretos.';
  if (role === 'integration') return 'Relacionar las ideas principales y ampliar la comprensión del tema.';
  return 'Evaluar el impacto, el contexto y las consecuencias de lo aprendido.';
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// Generar título desde los topic labels reales de las units
function titleFromUnits(role: LearningRole, units: LearningPathUnit[]): string {
  const GENERIC = /^(contexto|context|general|introduccion|overview|misc)/i;

  // Recolectar todos los topic labels no genéricos
  const usable = units
    .flatMap(u => u.topicLabels || [])
    .filter(t => t && !GENERIC.test(t));

  // Priorizar el topic del unit con mayor carga
  const dominant = units.reduce((a, b) => a.cognitiveLoad >= b.cognitiveLoad ? a : b);
  const dominantLabel = (dominant.topicLabels || []).find(t => !GENERIC.test(t));

  const raw = dominantLabel || usable[0] || '';

  if (raw && raw.length > 2) {
    // Si el topic label ya está en español, usarlo directo
    const hasSpanish = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(raw) ||
      /(del?|los?|las?|una?|para|con|que|por)/i.test(raw);
    return hasSpanish ? raw : displayName(raw);
  }

  return roleTitle(role);
}

// Generar objetivo narrativo usando NarrativeWriter
function objectiveFromUnits(role: LearningRole, units: LearningPathUnit[]): string {
  const rawConcepts = units.flatMap(u => u.concepts || []).filter(Boolean);
  const concepts = compactConceptList(rawConcepts, 4);

  // Tomar el topic label del unit dominante
  const dominant = units.reduce((a, b) => a.cognitiveLoad >= b.cognitiveLoad ? a : b);
  const topicLabel = (dominant.topicLabels || []).find(t =>
    !/^(contexto|context|general|introduccion|overview)/i.test(t)
  ) || dominant.topicLabels?.[0] || '';

  // bloomLevels no está en LearningPathUnit — fallback a understand
  const bloomLevel = 'understand';

  return writeShortObjective({ role, topicLabel, concepts, relations: [], bloomLevel });
}

export function buildLearningArcs(path: LearningPath): LearningArc[] {
  const unitMap = new Map(path.units.map(u => [u.id, u]));
  const orderedUnits = path.orderedUnitIds
    .map(id => unitMap.get(id))
    .filter(Boolean) as LearningPathUnit[];

  const arcs: LearningArc[] = [];
  let current: LearningPathUnit[] = [];

  function flush() {
    if (!current.length) return;

    const role = current[0].role;
    const unitIds = current.map(u => u.id);

    arcs.push({
      id: `arc_${arcs.length}`,
      order: arcs.length,
      title: titleFromUnits(role, current),
      purpose: objectiveFromUnits(role, current),
      role,
      unitIds,
      prerequisiteArcIds: [],
      unlocksArcIds: [],
      totalLoad: current.reduce((s, u) => s + u.cognitiveLoad, 0),
    });

    current = [];
  }

  for (const unit of orderedUnits) {
    if (current.length === 0) {
      current.push(unit);
      continue;
    }

    const prev = current[current.length - 1];

    // Regla: un arco agrupa unidades del mismo rol contiguas
    if (prev.role === unit.role) {
      current.push(unit);
      continue;
    }

    flush();
    current.push(unit);
  }

  flush();

  // validar ownership exacto de unidades
  const owner = new Map<string, string>();
  for (const arc of arcs) {
    if (!arc.unitIds.length) {
      throw new Error(`LearningArc vacío: ${arc.id}`);
    }
    for (const unitId of arc.unitIds) {
      if (owner.has(unitId)) {
        throw new Error(`Unit ${unitId} pertenece a múltiples arcos`);
      }
      owner.set(unitId, arc.id);
    }
  }

  // edges entre arcos desde prereqs de unidades
  for (const arc of arcs) {
    const prereqArcIds: string[] = [];
    for (const unitId of arc.unitIds) {
      const unit = unitMap.get(unitId);
      if (!unit) continue;

      for (const prereqUnitId of unit.prerequisiteUnitIds) {
        const ownerArcId = owner.get(prereqUnitId);
        if (ownerArcId && ownerArcId !== arc.id) {
          prereqArcIds.push(ownerArcId);
        }
      }
    }
    arc.prerequisiteArcIds = unique(prereqArcIds);
  }

  for (const arc of arcs) {
    arc.unlocksArcIds = unique(
      arcs
        .filter(other => other.prerequisiteArcIds.includes(arc.id))
        .map(other => other.id)
    );
  }

  return arcs;
}
