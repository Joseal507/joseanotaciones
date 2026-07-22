// ═══════════════════════════════════════════════════════════════
// StudyAL — Capa de Presentación
//
// Transforma nombres internos del blueprint en lenguaje natural.
// Genera objetivos narrativos desde conceptos y relaciones reales.
//
// REGLA: Nunca menciona el material específico hardcodeado.
//        Trabaja solo con los datos del blueprint.
// ═══════════════════════════════════════════════════════════════

export type LearningRole =
  | 'foundation'
  | 'problem'
  | 'mechanism'
  | 'application'
  | 'integration'
  | 'context';

// ─── Normalizar nombre interno del blueprint ──────────────────
// "Bohr's Impact on Science" → "El impacto científico de Bohr"
// "Energy Level Equation"    → "Ecuación de niveles de energía"
// Esta función NO sabe de Bohr — opera sobre patrones del inglés

function capitalize(s: string) {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// Un nombre de concepto válido NO debe:
// - terminar en "..." (texto truncado)
// - tener más de 80 caracteres (es un summary, no un label)
// - empezar con minúscula seguida de muchas palabras (párrafo)
// - contener patrones de PDF bruto
function isCleanConceptName(s: string): boolean {
  if (!s || s.trim().length === 0) return false;
  if (s.includes('...')) return false;
  if (s.trim().length > 80) return false;
  if (/^\d+\s/.test(s.trim())) return false; // empieza con número
  // Si tiene más de 8 palabras, es un párrafo no un nombre
  if (s.trim().split(/\s+/).length > 8) return false;
  return true;
}

export function filterCleanConcepts(concepts: string[]): string[] {
  return concepts.filter(isCleanConceptName);
}

function removeTrailingPossessive(s: string) {
  // "Bohr's" → "Bohr", "Newton's" → "Newton"
  return s.replace(/['']s\b/g, '');
}

function camelToWords(s: string) {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function displayName(raw: string): string {
  if (!raw || raw.trim().length === 0) return raw;

  let s = raw.trim();

  // Si ya está en español (contiene tildes o palabras comunes), devolver tal cual
  const hasSpanish = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(s) ||
    /\b(del?|los?|las?|una?|para|con|que|por|como|este|esta|su|sus)\b/i.test(s);
  if (hasSpanish) return s;

  // camelCase → palabras
  s = camelToWords(s);

  // Remover apóstrofe posesivo de nombres propios
  // "Bohr's" → "de Bohr", "Newton's" → "de Newton"
  s = s.replace(/(\b[A-Z][a-z]+)['']s\b/g, 'de $1');

  // Patrones comunes de inglés académico → español
  const patterns: [RegExp, string][] = [
    [/\bExplanation\b/gi, 'Explicación'],
    [/\bEquation\b/gi, 'Ecuación'],
    [/\bInterpretation\b/gi, 'Interpretación'],
    [/\bContribution\b/gi, 'Contribución'],
    [/\bImplications?\b/gi, 'Implicaciones'],
    [/\bFoundations?\b/gi, 'Fundamentos'],
    [/\bLimitations?\b/gi, 'Limitaciones'],
    [/\bUnderstanding\b/gi, 'Comprensión'],
    [/\bImpact\b/gi, 'Impacto'],
    [/\bLegacy\b/gi, 'Legado'],
    [/\bLeadership\b/gi, 'Liderazgo'],
    [/\bCollaboration\b/gi, 'Colaboración'],
    [/\bDebate\b/gi, 'Debate'],
    [/\bReality\b/gi, 'Realidad'],
    [/\bMechanics\b/gi, 'Mecánica'],
    [/\bQuantum\b/gi, 'Cuántica'],
    [/\bAtomic\b/gi, 'Atómica'],
    [/\bModel\b/gi, 'Modelo'],
    [/\bSpectrum\b/gi, 'Espectro'],
    [/\bHydrogen\b/gi, 'del Hidrógeno'],
    [/\bElectron\b/gi, 'Electrónico'],
    [/\bEnergy\b/gi, 'Energía'],
    [/\bLevels?\b/gi, 'Niveles'],
    [/\bTransitions?\b/gi, 'Transiciones'],
    [/\bStructure\b/gi, 'Estructura'],
    [/\bPhilosophical\b/gi, 'Filosófico'],
    [/\bScience\b/gi, 'Ciencia'],
    [/\bScientific\b/gi, 'Científica'],
    [/\bInstitute\b/gi, 'Instituto'],
    [/\bTechnology\b/gi, 'Tecnología'],
    [/\bWorld War\b/gi, 'Segunda Guerra Mundial'],
    [/\bNobel Prize?\b/gi, 'Premio Nobel'],
    [/\bBiography\b/gi, 'Biografía'],
    [/\bEducation\b/gi, 'Educación'],
    [/\bEarly Life\b/gi, 'Vida Temprana'],
    [/\bWork\b/gi, 'Trabajo'],
    [/\bRole\b/gi, 'Rol'],
    [/\bVision\b/gi, 'Visión'],
    [/\bEnvironment\b/gi, 'Entorno'],
    [/\bDevelopment\b/gi, 'Desarrollo'],
    [/\bDiscovery\b/gi, 'Descubrimiento'],
    [/\bResearch\b/gi, 'Investigación'],
    [/\bTheory\b/gi, 'Teoría'],
    [/\bPrinciple\b/gi, 'Principio'],
    [/\bProcess\b/gi, 'Proceso'],
    [/\bSystem\b/gi, 'Sistema'],
    [/\bin\b/gi, 'en'],
    [/\bof\b/gi, 'de'],
    [/\band\b/gi, 'y'],
    [/\bthe\b/gi, ''],
    [/\bby\b/gi, 'por'],
  ];

  for (const [pattern, replacement] of patterns) {
    s = s.replace(pattern, replacement);
  }

  // Limpiar espacios dobles y puntuación rara
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/^de\s+/i, '');
  s = capitalize(s);

  return s;
}

// ─── Generar objetivo narrativo desde conceptos y relaciones ──

interface ConceptInfo {
  name: string;
  kind?: string;
  importance?: number;
}

interface RelationInfo {
  type: string;    // requires, explains, causes, contrasts, extends, example_of
  targetLabel: string;
}

export function buildNarrativeObjective(
  role: LearningRole,
  concepts: string[],
  relations: RelationInfo[],
): string {
  // Convertir nombres a presentación limpia
  const displayConcepts = concepts
    .filter(Boolean)
    .filter(isCleanConceptName)   // solo nombres limpios, no párrafos del PDF
    .map(displayName)
    .filter(c => c.length > 2)
    .slice(0, 3);

  // Usar relaciones para construir narrativa más específica
  const requiresRels = relations.filter(r => r.type === 'requires');
  const explainsRels = relations.filter(r => r.type === 'explains');
  const causesRels = relations.filter(r => r.type === 'causes');
  const contrastsRels = relations.filter(r => r.type === 'contrasts');
  const extendsRels = relations.filter(r => r.type === 'extends');

  const c0 = displayConcepts[0] || '';
  const c1 = displayConcepts[1] || '';
  const c2 = displayConcepts[2] || '';

  if (role === 'foundation') {
    if (displayConcepts.length >= 2) {
      return `Familiarizarte con ${c0}${c1 ? ` y ${c1}` : ''}, estableciendo las bases necesarias para entender lo que viene.`;
    }
    return `Reconocer el contexto y las ideas iniciales necesarias para avanzar en el material.`;
  }

  if (role === 'problem') {
    if (contrastsRels.length > 0) {
      const target = displayName(contrastsRels[0].targetLabel);
      return `Explicar la limitación o pregunta central del material${c0 ? `, empezando por ${c0}` : ''}, y entender por qué contrasta con ${target}.`;
    }
    if (displayConcepts.length >= 2) {
      return `Comprender el problema central: ${c0}${c1 ? ` y sus implicaciones en ${c1}` : ''}.`;
    }
    return `Identificar la pregunta o limitación que hace necesario buscar una solución.`;
  }

  if (role === 'mechanism') {
    if (explainsRels.length > 0) {
      const target = displayName(explainsRels[0].targetLabel);
      return `Comprender ${c0}${c1 ? ` y ${c1}` : ''}, y cómo estos conceptos explican ${target}.`;
    }
    if (extendsRels.length > 0) {
      const target = displayName(extendsRels[0].targetLabel);
      return `Comprender ${c0}${c1 ? ` junto con ${c1}` : ''}, construyendo sobre lo anterior para explicar ${target}.`;
    }
    if (displayConcepts.length >= 2) {
      return `Comprender ${c0} y cómo se relaciona con ${c1}${c2 ? ` y ${c2}` : ''}.`;
    }
    return `Comprender el mecanismo o modelo central del material.`;
  }

  if (role === 'application') {
    if (requiresRels.length > 0) {
      const prereq = displayName(requiresRels[0].targetLabel);
      return `Aplicar los conceptos de ${c0 || 'este capítulo'} para explicar casos concretos, usando ${prereq} como base.`;
    }
    if (displayConcepts.length >= 2) {
      return `Aplicar ${c0} para resolver y explicar ${c1}${c2 ? ` y ${c2}` : ''}.`;
    }
    return `Aplicar la explicación principal a casos y evidencia concreta del material.`;
  }

  if (role === 'integration') {
    if (causesRels.length > 0) {
      const effect = displayName(causesRels[0].targetLabel);
      return `Relacionar ${c0 || 'las ideas previas'} con sus consecuencias, incluyendo ${effect}.`;
    }
    if (extendsRels.length > 0) {
      const extended = displayName(extendsRels[0].targetLabel);
      return `Comprender cómo ${c0 || 'estas ideas'} extienden y amplían ${extended}, conectando el recorrido completo.`;
    }
    if (displayConcepts.length >= 2) {
      return `Relacionar ${c0} con ${c1}${c2 ? ` y ${c2}` : ''} para construir una comprensión más profunda.`;
    }
    return `Conectar las ideas principales y ampliar la comprensión del tema.`;
  }

  if (role === 'context') {
    if (displayConcepts.length >= 2) {
      return `Evaluar el impacto y las consecuencias de ${c0}${c1 ? ` y ${c1}` : ''} en el contexto más amplio del tema.`;
    }
    return `Comprender el impacto, el legado y las consecuencias de lo aprendido.`;
  }

  return `Avanzar en el recorrido de aprendizaje.`;
}

// ─── Etiqueta corta del rol para el UI ───────────────────────

export function roleBadge(role: LearningRole | 'orientation' | 'final_review'): string {
  if (role === 'orientation') return 'Inicio';
  if (role === 'final_review') return 'Final';
  if (role === 'foundation')   return 'Fundamentos';
  if (role === 'problem')      return 'El problema';
  if (role === 'mechanism')    return 'La solución';
  if (role === 'application')  return 'La evidencia';
  if (role === 'integration')  return 'Conexión';
  if (role === 'context')      return 'Impacto';
  return 'Estudio';
}
