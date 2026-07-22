import type { CanonicalBlueprint, LearningPath } from './learningPathTypes';

export interface LearningPathValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateLearningPath(
  path: LearningPath,
  blueprint: CanonicalBlueprint,
): LearningPathValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const unitMap = new Map(path.units.map(u => [u.id, u]));

  // 1. No unidades vacías
  for (const unit of path.units) {
    if (!unit.blockIds.length) {
      errors.push(`Unidad vacía: ${unit.id}`);
    }
  }

  // 2. Todos los conceptos requeridos tienen owner
  const requiredConcepts = blueprint.concepts.filter(c =>
    ['concept', 'definition', 'formula'].includes(String(c.kind || '').toLowerCase())
  );

  for (const concept of requiredConcepts) {
    if (!path.conceptOwnerUnit[concept.id]) {
      errors.push(`Concepto sin unidad propietaria: ${concept.name} (${concept.id})`);
    }
  }

  // 3. Ningún concepto tiene dos propietarios
  const ownerCounts = new Map<string, number>();
  for (const [conceptId] of Object.entries(path.conceptOwnerUnit)) {
    ownerCounts.set(conceptId, (ownerCounts.get(conceptId) || 0) + 1);
  }
  for (const [conceptId, count] of ownerCounts.entries()) {
    if (count > 1) {
      errors.push(`Concepto con múltiples propietarios: ${conceptId}`);
    }
  }

  // 4. No ciclos
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const unit of path.units) {
    inDegree.set(unit.id, 0);
    adj.set(unit.id, []);
  }

  for (const edge of path.edges) {
    if (!inDegree.has(edge.fromUnitId) || !inDegree.has(edge.toUnitId)) {
      errors.push(`Edge apunta a unidad inexistente: ${edge.fromUnitId} -> ${edge.toUnitId}`);
      continue;
    }
    adj.get(edge.fromUnitId)!.push(edge.toUnitId);
    inDegree.set(edge.toUnitId, (inDegree.get(edge.toUnitId) || 0) + 1);
  }

  const queue = [...path.units.filter(u => (inDegree.get(u.id) || 0) === 0).map(u => u.id)];
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const next of adj.get(current) || []) {
      const deg = (inDegree.get(next) || 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (visited !== path.units.length) {
    errors.push('El learning path contiene un ciclo');
  }

  // 5. Todos los prerequisitos aparecen antes
  const orderIndex = new Map<string, number>();
  path.orderedUnitIds.forEach((id, i) => orderIndex.set(id, i));

  for (const unit of path.units) {
    for (const prereqId of unit.prerequisiteUnitIds) {
      const a = orderIndex.get(prereqId);
      const b = orderIndex.get(unit.id);
      if (a == null || b == null) {
        errors.push(`Orden inválido: ${prereqId} o ${unit.id} no están en orderedUnitIds`);
        continue;
      }
      if (a >= b) {
        errors.push(`Prerequisito fuera de orden: ${prereqId} debería ir antes que ${unit.id}`);
      }
    }
  }

  // 6. orderedUnitIds estable y completo
  if (path.orderedUnitIds.length !== path.units.length) {
    errors.push('orderedUnitIds no cubre exactamente todas las unidades');
  }

  const orderedSet = new Set(path.orderedUnitIds);
  if (orderedSet.size !== path.orderedUnitIds.length) {
    errors.push('orderedUnitIds contiene duplicados');
  }

  for (const unit of path.units) {
    if (!orderedSet.has(unit.id)) {
      errors.push(`Unidad ausente de orderedUnitIds: ${unit.id}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
