import type { LearningRole } from './learningPathTypes';

function norm(s: string) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function smartTitleCase(s: string) {
  const small = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'con', 'para', 'por']);
  return norm(s)
    .split(' ')
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (i > 0 && small.has(lw)) return lw;
      return w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
    })
    .join(' ');
}

function isGarbageLabel(s: string): boolean {
  const v = norm(s);
  if (!v) return true;
  if (v.length > 80) return true;
  if (v.includes('...')) return true;
  if (/^\d+\s/.test(v)) return true;
  if (v.split(' ').length > 10) return true;
  return false;
}

export function displayName(raw: string): string {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

export function displayPhrase(raw: string): string {
  const dn = displayName(raw);
  if (!dn) return '';
  return dn.charAt(0).toLowerCase() + dn.slice(1);
}

export function compactConceptList(rawConcepts: string[], max = 3): string[] {
  const clean = rawConcepts
    .map(displayName)
    .filter(Boolean);

  const unique = [...new Set(clean)];
  return unique.slice(0, max);
}

export function buildNarrativeSentence(
  role: LearningRole,
  concepts: string[],
): string {
  const c = compactConceptList(concepts, 3);
  const a = c[0] || '';
  const b = c[1] || '';
  const d = c[2] || '';

  if (role === 'foundation') {
    if (a && b) return `Construir el contexto necesario para entender ${a} y ${b}.`;
    if (a) return `Construir el contexto necesario para entender ${a}.`;
    return 'Construir el contexto necesario para entender lo que viene.';
  }

  if (role === 'problem') {
    if (a && b) return `Comprender el problema central del material a través de ${a} y ${b}.`;
    if (a) return `Comprender el problema central del material a través de ${a}.`;
    return 'Comprender la pregunta o limitación que hace necesario buscar una solución.';
  }

  if (role === 'mechanism') {
    if (a && b && d) return `Comprender ${a} y cómo se relaciona con ${b} y ${d}.`;
    if (a && b) return `Comprender ${a} y cómo se relaciona con ${b}.`;
    if (a) return `Comprender ${a}.`;
    return 'Comprender la explicación central del material.';
  }

  if (role === 'application') {
    if (a && b) return `Aplicar ${a} para explicar ${b}.`;
    if (a) return `Aplicar ${a} en ejemplos y evidencia del material.`;
    return 'Aplicar la explicación principal a la evidencia del material.';
  }

  if (role === 'integration') {
    if (a && b) return `Relacionar ${a} con ${b} para ampliar la comprensión del tema.`;
    if (a) return `Relacionar ${a} con el resto del recorrido de aprendizaje.`;
    return 'Conectar las ideas principales para ampliar la comprensión del tema.';
  }

  if (role === 'context') {
    if (a && b) return `Evaluar el impacto de ${a} y ${b} en el contexto más amplio del tema.`;
    if (a) return `Evaluar el impacto de ${a} en el contexto más amplio del tema.`;
    return 'Evaluar el impacto, contexto y consecuencias de lo aprendido.';
  }

  return 'Avanzar en el recorrido de aprendizaje.';
}

// Selección estable de variante — el mismo material siempre
// produce la misma variante, pero distintos materiales varían
export function pickVariant(seed: string, options: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return options[Math.abs(h) % options.length];
}

export const FOUNDATION_LEADS = [
  'Como empiezas desde cero,',
  'Antes de avanzar al núcleo del tema,',
  'Para que el resto del recorrido tenga sentido,',
  'El primer paso será construir la base:',
  'Empezaremos por lo esencial:',
];

export const PROBLEM_LEADS = [
  'Antes de ver la solución,',
  'Para entender la respuesta hay que conocer primero la pregunta:',
  'Todo avance comienza con un problema sin resolver.',
  'Descubrirás la limitación que lo cambió todo:',
];

export function roleBadge(role: LearningRole | 'orientation' | 'final_review'): string {
  if (role === 'orientation')   return 'Inicio';
  if (role === 'final_review')  return 'Dominio';
  if (role === 'foundation')    return 'Contexto';
  if (role === 'problem')       return 'El problema';
  if (role === 'mechanism')     return 'La solución';
  if (role === 'application')   return 'La evidencia';
  if (role === 'integration')   return 'Profundización';
  if (role === 'context')       return 'Legado';
  return 'Estudio';
}
