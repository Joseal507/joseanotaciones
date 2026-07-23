// ═══════════════════════════════════════════════════════════════
// StudyAL — NarrativeWriter
//
// Convierte conceptos + relaciones + rol pedagógico
// en un párrafo natural como lo escribiría un profesor.
//
// REGLA: nunca enumera conceptos. Siempre cuenta una historia.
// ═══════════════════════════════════════════════════════════════

import type { LearningRole } from './learningPathTypes';
import { displayName } from './narrativeFormatter';

export interface NarrativeInput {
  role: LearningRole;
  topicLabel: string;
  concepts: string[];
  relations: { type: string; fromLabel: string; toLabel: string }[];
  bloomLevel?: string;
}

// Agrega artículo definido en español según el género gramatical
// heurístico — funciona bien para temas académicos
function addArticle(s: string): string {
  if (!s) return s;
  const lower = s.toLowerCase();

  // ya tiene artículo
  if (/^(el |la |los |las |un |una |del |de la |de los )/.test(lower)) return s;

  // TÍTULOS COMPUESTOS: si tiene "y" o empieza con mayúscula y tiene 3+ palabras
  // es probablemente un nombre propio o título — no agregar artículo
  const words = s.trim().split(' ');
  if (words.length >= 3 && /^[A-ZÁÉÍÓÚ]/.test(words[0])) return s;
  if (lower.includes(' y ') && words.length >= 3) return s;

  // masculinos comunes
  if (
    /^(modelo|sistema|problema|proceso|principio|método|concepto|ciclo|período|elemento|factor|fenómeno|mecanismo|impacto|análisis|papel|rol|trabajo|legado|recorrido|contexto|uso|efecto|tipo|nivel|campo)/.test(lower)
  ) return `el ${s}`;

  // femeninos comunes
  if (
    /^(interpretación|solución|teoría|ley|estructura|naturaleza|evidencia|idea|comprensión|física|química|biología|medicina|ciencia|mecánica|ecuación|fórmula|función|reacción|célula|membrana|energía|historia|revolución|explicación|visión|contribución|colaboración)/.test(lower)
  ) return `la ${s}`;

  // plurales
  if (/s$/.test(lower) && !/és$/.test(lower)) {
    if (/^(nivel|proceso|elemento|concepto|principio|factor|tipo)/.test(lower)) return `los ${s}`;
    return `las ${s}`;
  }

  // Para títulos de una sola palabra que no matchean, mejor sin artículo
  if (words.length === 1) return s;

  return s;
}

// Corregir "de el" → "del", "de la" ya está bien
function fixArticle(s: string): string {
  return s
    .replace(/de el/g, 'del')
    .replace(/De el/g, 'Del')
    .replace(/en el/g, 'en el')
    .replace(/de los/g, 'de los')
    .trim();
}

function clean(s: string): string {
  const d = displayName(s);
  return d || s;
}

function isValid(s: string): boolean {
  if (!s || s.trim().length === 0) return false;
  if (s.length > 80) return false;
  if (s.includes('...')) return false;
  if (s.split(' ').length > 10) return false;
  return true;
}

function pick(arr: string[], max: number): string[] {
  return arr.filter(isValid).map(clean).filter(Boolean).slice(0, max);
}

// ─── Plantillas narrativas por par de relación ─────────────────

const RELATION_TEMPLATES: Record<string, (a: string, b: string) => string> = {
  requires:     (a, b) => `Para comprender ${a} necesitas entender primero ${b}.`,
  extends:      (a, b) => `${a} amplía y profundiza las ideas de ${b}.`,
  explains:     (a, b) => `${a} explica por qué ocurre ${b}.`,
  causes:       (a, b) => `${a} lleva directamente a ${b}.`,
  contrasts:    (a, b) => `${a} contrasta con ${b}, lo cual es clave para distinguirlos.`,
  example_of:   (a, b) => `${a} es un ejemplo concreto de ${b}.`,
};

// ─── Intros narrativas por rol y bloom ────────────────────────

function narrativeIntro(
  role: LearningRole,
  bloom: string,
  topicDisplay: string,
): string {
  const t = topicDisplay;

  // Frases de apertura diseñadas para funcionar con cualquier tipo de material
  // t = clean(topicLabel) — definido al inicio de writeNarrative
  const intros: Partial<Record<LearningRole, string>> = {
    foundation: t
      ? `Antes de avanzar, explorarás ${t} para que cada idea que viene tenga una base sólida.`
      : `Antes de avanzar, explorarás el contexto y los conceptos necesarios para entender lo que sigue.`,

    problem: t
      ? `Descubrirás cuál es el problema o la pregunta central de ${t} y por qué fue necesario resolverlo.`
      : `Descubrirás el problema o la pregunta central que hace necesario avanzar hacia una solución.`,

    mechanism:
      bloom === 'apply' || bloom === 'analyze'
        ? (t
            ? `Comprenderás cómo funciona ${t} y lo aplicarás a situaciones concretas del material.`
            : `Comprenderás la explicación central y aprenderás a aplicarla en contextos concretos.`)
        : (t
            ? `Explorarás cómo funciona ${t} y por qué esa explicación da sentido al resto del recorrido.`
            : `Explorarás la explicación central y verás por qué da sentido a lo que sigue.`),

    application: t
      ? `Aplicarás lo aprendido sobre ${t} a la evidencia y los casos más importantes del material.`
      : `Aplicarás la explicación principal a la evidencia y los casos concretos del material.`,

    integration: t
      ? `Conectarás las ideas anteriores para entender cómo se relacionan con ${t} y qué revelan juntas.`
      : `Conectarás las ideas que fuiste construyendo y verás cómo se integran en una comprensión más completa.`,

    context: t
      ? `Evaluarás el alcance de ${t}: cómo influyó en el campo, qué dejó como legado y por qué sigue siendo relevante.`
      : `Evaluarás el impacto, el legado y la relevancia de todo lo aprendido más allá del contenido central.`,
  };

  return intros[role] || `En esta sesión avanzarás en ${t}.`;
}

// ─── Párrafo de relaciones ────────────────────────────────────

function relationsParagraph(
  relations: NarrativeInput['relations'],
): string {
  const sentences: string[] = [];

  for (const rel of relations.slice(0, 3)) {
    const from = clean(rel.fromLabel);
    const to = clean(rel.toLabel);
    if (!isValid(rel.fromLabel) || !isValid(rel.toLabel)) continue;
    const template = RELATION_TEMPLATES[rel.type];
    if (template) sentences.push(template(from, to));
  }

  return sentences.join(' ');
}

// ─── Cierre narrativo por rol ─────────────────────────────────

function narrativeClose(
  role: LearningRole,
  concepts: string[],
): string {
  const cc = pick(concepts, 2);
  const a = cc[0] || '';
  const b = cc[1] || '';

  if (role === 'foundation') {
    return a ? `Al terminar reconocerás ${a}${b ? ` y ${b}` : ''} como puntos de partida del recorrido.` : '';
  }
  if (role === 'problem') {
    return a ? `Al terminar podrás explicar ${a}${b ? ` y su relación con ${b}` : ''}.` : '';
  }
  if (role === 'mechanism') {
    return a ? `Al terminar podrás explicar ${a}${b ? ` y aplicarlo en ${b}` : ''}.` : '';
  }
  if (role === 'application') {
    return a ? `Al terminar usarás ${a}${b ? ` para explicar ${b}` : ''}.` : '';
  }
  if (role === 'integration') {
    return a ? `Al terminar podrás relacionar ${a} con el panorama completo del tema.` : '';
  }
  if (role === 'context') {
    return a ? `Al terminar evaluarás el impacto de ${a}${b ? ` y ${b}` : ''} más allá del material.` : '';
  }
  return '';
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────

export function writeNarrative(input: NarrativeInput): string {
  const {
    role,
    topicLabel,
    concepts,
    relations,
    bloomLevel = 'understand',
  } = input;

  const topicDisplay = clean(topicLabel) || 'este tema';

  const intro = narrativeIntro(role, bloomLevel, topicDisplay);
  const relParagraph = relationsParagraph(relations);
  const close = narrativeClose(role, concepts);

  const parts = [intro, relParagraph, close].filter(Boolean);

  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

// ─── Introducción narrativa para la tarjeta de sesión ─────────
// No es un objetivo, es una puerta de entrada al tema.
// Usa topicLabel + concepts + relations para escribir
// como si lo hubiera redactado un profesor.

export function writeShortObjective(input: NarrativeInput): string {
  const { role, topicLabel, bloomLevel = 'understand' } = input;
  const rawTopic = clean(topicLabel) || '';
  const topic = addArticle(rawTopic);

  if (role === 'foundation') {
    return rawTopic
      ? fixArticle(`Explorarás el origen y el contexto de ${topic} para que cada idea que viene después tenga una base sólida desde el principio.`)
      : 'Explorarás el contexto necesario para que el resto del recorrido tenga sentido.';
  }

  if (role === 'problem') {
    return rawTopic
      ? fixArticle(`Descubrirás cuál era el gran problema sin resolver dentro de ${topic} y por qué esa limitación hizo necesario avanzar hacia una solución.`)
      : 'Descubrirás la pregunta central que motivó la búsqueda de una nueva explicación.';
  }

  if (role === 'mechanism') {
    if (bloomLevel === 'apply' || bloomLevel === 'analyze') {
      return rawTopic
        ? fixArticle(`Aprenderás cómo funciona ${topic} y lo aplicarás para explicar situaciones y fenómenos concretos del material.`)
        : 'Aprenderás a aplicar la explicación central del material en situaciones concretas.';
    }
    return rawTopic
      ? fixArticle(`Verás cómo ${topic} resolvió el problema de la sesión anterior y por qué esa explicación da sentido a todo lo que viene después.`)
      : 'Verás cómo funciona la explicación central y cómo resolvió el problema anterior.';
  }

  if (role === 'application') {
    return rawTopic
      ? fixArticle(`Pondrás a prueba lo aprendido sobre ${topic} contra la evidencia más importante del material y comprobarás cómo la teoría funciona en la práctica.`)
      : 'Pondrás a prueba la explicación principal contra la evidencia concreta del material.';
  }

  if (role === 'integration') {
    // Fix: "la X e Y" → "la X y la Y" para mejor fluidez en español
    const topicFixed = topic.replace(
      /^(la|el|los|las)\s+(.+?)\s+e\s+(.+)$/i,
      (_, art, a, b) => `${art} ${a} y la ${b}`
    );
    return rawTopic
      ? fixArticle(`Conectarás las ideas anteriores para entender cómo convergieron en ${topicFixed} y cómo ese cambio transformó la comprensión del tema.`)
      : 'Conectarás las ideas anteriores para revelar una comprensión más profunda del tema.';
  }

  if (role === 'context') {
    return rawTopic
      ? fixArticle(`Analizarás el alcance de ${topic} más allá del contenido central: cómo transformó el campo, qué dejó como legado y por qué sigue siendo relevante hoy.`)
      : 'Analizarás el impacto, el legado y la relevancia actual de todo lo aprendido.';
  }

  return rawTopic
    ? fixArticle(`Avanzarás en el recorrido con ${topic}.`)
    : 'Avanzarás en el recorrido de aprendizaje.';
}
