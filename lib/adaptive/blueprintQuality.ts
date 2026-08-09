// ═══════════════════════════════════════════════════════════════
// BlueprintQuality — Evaluador universal de calidad
// No asume dominio, materia ni tipo de contenido.
// Evalúa estructura y completitud, no presencia de fórmulas.
// ═══════════════════════════════════════════════════════════════

export type BlueprintQualityStatus = 'complete' | 'degraded';

export interface BlueprintQualityMetrics {
  totalBlocks: number;
  byKind: Record<string, number>;
  fallbackBlocks: number;
  highImportanceBlocks: number;
  topicsWithZeroBlocks: number;
  totalTopics: number;
  avgBlocksPerTopic: number;
  pagesWithContent: number;
}

export interface BlueprintQualityResult {
  status: BlueprintQualityStatus;
  metrics: BlueprintQualityMetrics;
  reasons: string[];
}

function norm(s: string): string {
  return String(s || '').toLowerCase().trim();
}

export function enrichBlueprintHeuristics(blueprint: any): any {
  // No reclasifica bloques por dominio.
  // Solo corrige anomalías estructurales obvias.
  const blocks: any[] = blueprint?.blocks || [];

  for (const block of blocks) {
    // Si el label tiene más de 80 chars probablemente es un párrafo mal clasificado
    if (norm(block?.kind) === 'entity' && String(block?.label || '').length > 80) {
      block.kind = 'concept';
    }

    // Garantizar valores por defecto sin cambiar el contenido semántico
    if (!block.difficulty) block.difficulty = 'intermediate';
    if (typeof block.importance !== 'number') block.importance = 50;
    if (typeof block.examProbability !== 'number') block.examProbability = 50;
    if (typeof block.estimatedMinutes !== 'number') block.estimatedMinutes = 3;
    if (!Array.isArray(block.dependsOn)) block.dependsOn = [];
    if (!Array.isArray(block.relations)) block.relations = [];
    if (!Array.isArray(block.misconceptions)) block.misconceptions = [];
    if (!Array.isArray(block.examTypes)) block.examTypes = [];
  }

  return blueprint;
}

export function evaluateBlueprintQuality(blueprint: any): BlueprintQualityResult {
  const blocks: any[] = blueprint?.blocks || [];
  const topics: any[] = blueprint?.topics || blueprint?.topicsIndex || [];

  const totalBlocks = blocks.length;
  const fallbackBlocks = blocks.filter((b: any) => b?._fallback === true).length;
  const highImportanceBlocks = blocks.filter((b: any) => (b?.importance ?? 0) >= 75).length;

  // Contar por kind sin asumir qué kinds deben existir
  const byKind: Record<string, number> = {};
  for (const block of blocks) {
    const k = norm(block?.kind) || 'unknown';
    byKind[k] = (byKind[k] || 0) + 1;
  }

  // Topics con 0 bloques — siempre es un problema independiente del dominio
  const topicsWithZeroBlocks = topics.filter((t: any) => {
    const topicId = t?.id;
    return !blocks.some((b: any) => b?.topicId === topicId);
  }).length;

  const avgBlocksPerTopic = topics.length > 0
    ? Math.round((totalBlocks / topics.length) * 10) / 10
    : 0;

  const coveredPages = new Set<number>();
  for (const b of blocks) {
    (b?.pages || []).forEach((p: number) => coveredPages.add(p));
  }

  const metrics: BlueprintQualityMetrics = {
    totalBlocks,
    byKind,
    fallbackBlocks,
    highImportanceBlocks,
    topicsWithZeroBlocks,
    totalTopics: topics.length,
    avgBlocksPerTopic,
    pagesWithContent: coveredPages.size,
  };

  const reasons: string[] = [];

  // Sin bloques — análisis completamente vacío
  if (totalBlocks === 0) {
    reasons.push('El análisis no produjo ningún bloque de conocimiento');
  }

  // Muy pocos bloques para el número de topics
  if (totalBlocks > 0 && totalBlocks < 3 && topics.length >= 3) {
    reasons.push(`Solo ${totalBlocks} bloques para ${topics.length} topics detectados`);
  }

  // Topics sin ningún bloque
  if (topicsWithZeroBlocks > 0 && topics.length > 0) {
    const pct = Math.round((topicsWithZeroBlocks / topics.length) * 100);
    if (pct > 30) {
      reasons.push(`${topicsWithZeroBlocks} de ${topics.length} topics (${pct}%) no tienen bloques analizados`);
    }
  }

  // Fallbacks — significa que el análisis falló parcialmente
  if (fallbackBlocks > 0) {
    reasons.push(`${fallbackBlocks} bloque(s) son placeholders de fallback sin contenido real`);
  }

  // Sin bloques de alta importancia — análisis superficial
  if (totalBlocks >= 10 && highImportanceBlocks === 0) {
    reasons.push('Ningún bloque tiene importancia ≥75 — el análisis puede ser demasiado superficial');
  }

  const status: BlueprintQualityStatus = reasons.length === 0 ? 'complete' : 'degraded';

  return { status, metrics, reasons };
}
