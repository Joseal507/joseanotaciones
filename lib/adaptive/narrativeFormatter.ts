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
  let s = norm(raw);
  if (!s) return '';

  if (isGarbageLabel(s)) return '';

  const replacements: [RegExp, string][] = [
    [/^(.+?)'s Impact on Science$/i, 'Impacto científico de $1'],
    [/^(.+?)'s Impact on Technology$/i, 'Impacto tecnológico de $1'],
    [/^(.+?)'s Contribution to Science$/i, 'Contribución de $1 a la ciencia'],
    [/^(.+?)'s Contribution to Quantum Mechanics$/i, 'Contribución de $1 a la mecánica cuántica'],
    [/^(.+?)'s Atomic Model$/i, 'Modelo atómico de $1'],
    [/^(.+?)'s Role in World War II$/i, 'Papel de $1 en la Segunda Guerra Mundial'],
    [/^(.+?)'s Role in Quantum Mechanics$/i, 'Papel de $1 en la mecánica cuántica'],
    [/^(.+?)'s Biography$/i, 'Biografía de $1'],
    [/^(.+?)'s Early Life$/i, 'Vida temprana de $1'],
    [/^(.+?)'s Education$/i, 'Educación de $1'],
    [/^(.+?)'s Legacy in Physics$/i, 'Legado de $1 en la física'],
    [/^(.+?)'s Leadership in Science$/i, 'Liderazgo de $1 en la ciencia'],
    [/^(.+?)'s Leadership and Legacy$/i, 'Liderazgo y legado de $1'],
    [/^Limitations of (.+)$/i, 'Limitaciones de $1'],
    [/^Explanation of (.+)$/i, 'Explicación de $1'],
    [/^Energy Levels? Equation$/i, 'Ecuación de niveles de energía'],
    [/^Energy Levels? and Electron Transitions$/i, 'Niveles de energía y transiciones electrónicas'],
    [/^Electron Energy Levels$/i, 'Niveles de energía de los electrones'],
    [/^Hydrogen Spectrum( Explanation)?$/i, 'Espectro del hidrógeno'],
    [/^Copenhagen Interpretation$/i, 'Interpretación de Copenhague'],
    [/^Quantum Mechanics and Reality$/i, 'Mecánica cuántica y realidad'],
    [/^Philosophical Implications of Quantum Mechanics$/i, 'Implicaciones filosóficas de la mecánica cuántica'],
    [/^Collaboration and Debate$/i, 'Colaboración y debate'],
    [/^Collaboration and Scientific Environment$/i, 'Colaboración y entorno científico'],
    [/^Collaboration and Intellectual Environment$/i, 'Colaboración y entorno intelectual'],
    [/^Fostering Scientific Collaboration$/i, 'Colaboración científica'],
    [/^Scientific Collaboration$/i, 'Colaboración científica'],
    [/^Understanding Atomic Structure$/i, 'Comprensión de la estructura atómica'],
    [/^Impact of (.+)$/i, 'Impacto de $1'],
    [/^Nobel Prize( in Physics)?$/i, 'Premio Nobel de Física'],
    [/^World War II$/i, 'Segunda Guerra Mundial'],
    [/^World War II Contributions$/i, 'Aportes durante la Segunda Guerra Mundial'],
    [/^Nuclear Research$/i, 'Investigación nuclear'],
    [/^Reevaluating Traditional Concepts$/i, 'Reevaluación de conceptos tradicionales'],
    [/^Understanding the Universe$/i, 'Comprensión del universo'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(s)) {
      s = s.replace(pattern, replacement).trim();
      return smartTitleCase(s);
    }
  }

  // Fallback genérico palabra por palabra
  const wordMap: Record<string, string> = {
    'understanding': 'comprensión',
    'structure': 'estructura',
    'atomic': 'atómica',
    'model': 'modelo',
    'impact': 'impacto',
    'physics': 'física',
    'science': 'ciencia',
    'scientific': 'científica',
    'quantum': 'cuántica',
    'mechanics': 'mecánica',
    'interpretation': 'interpretación',
    'philosophical': 'filosóficas',
    'implications': 'implicaciones',
    'limitations': 'limitaciones',
    'explanation': 'explicación',
    'collaboration': 'colaboración',
    'debate': 'debate',
    'leadership': 'liderazgo',
    'legacy': 'legado',
    'technology': 'tecnología',
    'contribution': 'contribución',
    'foundations': 'fundamentos',
    'foundation': 'fundamento',
    'electron': 'electrón',
    'electrons': 'electrones',
    'energy': 'energía',
    'levels': 'niveles',
    'level': 'nivel',
    'transitions': 'transiciones',
    'transition': 'transición',
    'hydrogen': 'hidrógeno',
    'spectrum': 'espectro',
    'equation': 'ecuación',
    'reality': 'realidad',
    'environment': 'entorno',
    'institute': 'instituto',
    'nuclear': 'nuclear',
    'research': 'investigación',
    'discovery': 'descubrimiento',
    'discoveries': 'descubrimientos',
    'revolution': 'revolución',
    'education': 'educación',
    'biography': 'biografía',
    'development': 'desarrollo',
    'theory': 'teoría',
    'principle': 'principio',
    'principles': 'principios',
    'orbit': 'órbita',
    'orbits': 'órbitas',
    'role': 'rol',
    'work': 'trabajo',
    'early': 'temprana',
    'life': 'vida',
    'war': 'guerra',
    'world': 'mundial',
    'prize': 'premio',
    'nobel': 'Nobel',
    'fostering': 'impulso de',
    'reevaluating': 'reevaluación de',
    'traditional': 'tradicionales',
    'concepts': 'conceptos',
    'modern': 'moderna',
    'contemporary': 'contemporánea',
    'classical': 'clásica',
    'unification': 'unificación',
    'behavior': 'comportamiento',
    'determinism': 'determinismo',
    'knowledge': 'conocimiento',
    'particles': 'partículas',
    'subatomic': 'subatómicas',
    'stability': 'estabilidad',
    'escape': 'escape',
    'stance': 'postura',
    'view': 'visión',
    'true': 'verdadera',
    'greatness': 'grandeza',
    'lasting': 'duradero',
    'across': 'a través de',
    'interdisciplinary': 'interdisciplinario',
    'catalyze': 'catalizaron',
    'ideas': 'ideas',
    'technologies': 'tecnologías',
    'advances': 'avances',
    'of': 'de',
    'and': 'y',
    'in': 'en',
    'on': 'sobre',
    'with': 'con',
  };

  const translated = s
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (/^[A-Z][a-z]+$/.test(word) && !wordMap[lower]) return word;
      return wordMap[lower] || word;
    })
    .join(' ')
    .replace(/\bcopenhagen\b/gi, 'Copenhague')
    .replace(/\bcopenhague\b/gi, 'Copenhague');

  return smartTitleCase(translated);
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
