/**
 * recoveryStrategyEngine.ts
 *
 * Decide la ESTRATEGIA PEDAGÓGICA de reexplicación.
 * NO genera contenido. Decide QUÉ hacer y POR QUÉ.
 *
 * Garantías:
 * - Sin hardcode de temas
 * - Generalizable a cualquier dominio
 * - Determinístico
 * - Integrable sobre el motor existente sin romper contratos
 */

import type { ContentSignal, ErrorType } from './pedagogicalFormatSelector'

// ─── Tipos públicos ───────────────────────────────────────────

export type RecoveryStrategy =
  | 'restate'           // Reexplicar con palabras diferentes
  | 'analogy'           // Usar una analogía del mismo dominio
  | 'counterexample'    // Mostrar qué NO es el concepto
  | 'decompose'         // Descomponer en partes más simples
  | 'worked_example'    // Resolver un ejemplo paso a paso
  | 'perspective_shift' // Cambiar el punto de vista
  | 'socratic'          // Preguntas guía para que el estudiante llegue solo
  | 'heuristic'         // Regla mnemotécnica o truco
  | 'contrast'          // Contrastar con lo correcto vs lo que creyó
  | 'ordering'          // Mostrar secuencia correcta paso a paso
  | 'find_the_error'    // Señalar el error específico cometido

export interface RecoveryStrategyDecision {
  primaryStrategy: RecoveryStrategy
  secondaryStrategy: RecoveryStrategy
  approach: string           // Instrucción concreta para el prompt
  tone: string               // Tono sugerido
  mustAvoid: string[]        // Qué NO hacer en esta reexplicación
  mustInclude: string[]      // Qué SÍ incluir
  estimatedLength: 'brief' | 'medium' | 'detailed'
}

// Instrucción genérica por TIPO de estrategia (independiente de contenido) — usada
// para poder ejecutar realmente secondaryStrategy en rondas alternas (ver
// buildReteachStrategyInstructions), no solo mencionarla en una etiqueta sin efecto.
// Auditoría adversarial (Codex, misión REAL-SESSION QUALITY, B3 CONFIRMADO
// P1): buildReteachStrategyInstructions solo alternaba entre 2 estrategias
// (primary/secondary) por PARIDAD de ronda — ronda 3 volvía a primary,
// ronda 5 volvía a primary otra vez ("5 paráfrasis del mismo club
// exclusivo"). Esta rotación amplía la progresión más allá de las 2
// declaradas por la matriz para rondas 3+, sin inventar una nueva taxonomía
// pedagógica — reutiliza el mismo catálogo cerrado de RecoveryStrategy ya
// existente, solo evita repetir la MISMA estrategia dos rondas seguidas.
const STRATEGY_ESCALATION_ORDER: RecoveryStrategy[] = [
  'restate', 'analogy', 'counterexample', 'decompose', 'worked_example',
  'contrast', 'socratic', 'heuristic', 'ordering', 'perspective_shift', 'find_the_error',
]

function buildStrategyRotation(decision: RecoveryStrategyDecision): RecoveryStrategy[] {
  const used = new Set<RecoveryStrategy>([decision.primaryStrategy, decision.secondaryStrategy])
  const extras = STRATEGY_ESCALATION_ORDER.filter(strategy => !used.has(strategy))
  return [decision.primaryStrategy, decision.secondaryStrategy, ...extras]
}

const GENERIC_STRATEGY_INSTRUCTION: Record<RecoveryStrategy, string> = {
  restate: 'Reexplica el concepto completo con palabras y estructura de frase distintas a la explicación original — no reordenes las mismas frases, cámbialas.',
  analogy: 'Usa una analogía del mundo cotidiano (ajena al material) que capture la misma relación central del concepto.',
  counterexample: 'Presenta un caso concreto donde el concepto NO aplica, para marcar su límite por contraste.',
  decompose: 'Descompón el concepto en sus partes o pasos más simples y explica cada uno por separado antes de unirlos.',
  worked_example: 'Resuelve un ejemplo completo paso a paso, con datos concretos, mostrando cada decisión intermedia.',
  perspective_shift: 'Cambia el punto de vista narrativo (p.ej. desde la consecuencia hacia la causa, o desde el resultado final hacia el proceso) para exponer la misma relación desde otro ángulo.',
  socratic: 'Guía con 2-3 preguntas progresivas que lleven al estudiante a reconstruir la respuesta correcta por sí mismo, sin dársela directamente.',
  heuristic: 'Da una regla práctica, patrón o mnemotecnia que ayude a recordar o aplicar el concepto correctamente.',
  contrast: 'Presenta lado a lado lo que el estudiante respondió y lo correcto, señalando exactamente dónde diverge el razonamiento.',
  ordering: 'Presenta la secuencia correcta paso a paso, numerada, señalando en qué paso ocurre típicamente la confusión.',
  find_the_error: 'Presenta un razonamiento con un error similar al cometido y pide identificarlo antes de dar la explicación directa.',
}

// ─── Matriz de decisión ───────────────────────────────────────
//
// Cada combinación error × contenido tiene una estrategia óptima.

const STRATEGY_MATRIX: Record<ErrorType, Record<ContentSignal, RecoveryStrategyDecision>> = {
  vocabulary: {
    definition: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'counterexample',
      approach: 'Introduce el término con una analogía del mundo cotidiano. Luego muestra un caso donde NO aplica para fijar el límite del concepto.',
      tone: 'amigable y directo',
      mustAvoid: ['repetir la definición textual', 'usar más tecnicismos sin explicar'],
      mustInclude: ['analogía concreta', 'ejemplo de uso correcto', 'ejemplo de uso incorrecto'],
      estimatedLength: 'medium',
    },
    formula: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Descompón la fórmula variable por variable. Explica qué mide cada una antes de mostrar el conjunto.',
      tone: 'sistemático y claro',
      mustAvoid: ['presentar la fórmula completa sin contexto', 'asumir que sabe las unidades'],
      mustInclude: ['significado de cada variable', 'unidades', 'un valor numérico de ejemplo'],
      estimatedLength: 'detailed',
    },
    enumeration: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'analogy',
      approach: 'Crea un acrónimo, regla mnemotécnica o patrón que agrupe los elementos de la lista.',
      tone: 'práctico y memorable',
      mustAvoid: ['listar sin estructura', 'dar demasiados elementos a la vez'],
      mustInclude: ['regla o patrón para recordar', 'máximo 3-4 elementos por grupo'],
      estimatedLength: 'brief',
    },
    causal: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'restate',
      approach: 'Usa una cadena causal del mundo cotidiano antes de aplicarla al concepto del material.',
      tone: 'intuitivo y progresivo',
      mustAvoid: ['saltar directo al término técnico', 'asumir que entiende la causa base'],
      mustInclude: ['analogía causal cotidiana', 'transferencia explícita al concepto del material'],
      estimatedLength: 'medium',
    },
    comparison: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'counterexample',
      approach: 'Pon A y B en una tabla mental. Muestra explícitamente en qué se parecen y en qué se diferencian.',
      tone: 'estructurado y visual',
      mustAvoid: ['mezclar características de ambos sin distinguir', 'definir solo uno'],
      mustInclude: ['característica clave de A', 'característica clave de B', 'cuándo usar cada uno'],
      estimatedLength: 'medium',
    },
    classification: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'heuristic',
      approach: 'Explica el criterio de clasificación antes de las categorías. Luego aplica el criterio a ejemplos.',
      tone: 'lógico y ordenado',
      mustAvoid: ['dar las categorías sin el criterio que las define'],
      mustInclude: ['criterio de clasificación explícito', 'un ejemplo por categoría'],
      estimatedLength: 'medium',
    },
    narrative: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'analogy',
      approach: 'Narra la secuencia como una historia con causa y consecuencia, no como una lista de fechas.',
      tone: 'narrativo y conectado',
      mustAvoid: ['listar eventos sin lógica', 'dar fechas sin contexto'],
      mustInclude: ['por qué ocurrió', 'qué cambió como resultado'],
      estimatedLength: 'medium',
    },
    argumentation: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'socratic',
      approach: 'Separa la tesis de la evidencia. Luego pregunta: ¿qué evidencia daría soporte a esta tesis?',
      tone: 'crítico y reflexivo',
      mustAvoid: ['presentar el argumento completo de nuevo', 'dar la respuesta directamente'],
      mustInclude: ['tesis clara', 'pregunta guía para la evidencia'],
      estimatedLength: 'medium',
    },
    case: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'analogy',
      approach: 'Resuelve el caso paso a paso en voz alta, explicando el razonamiento en cada decisión.',
      tone: 'transparente y detallado',
      mustAvoid: ['dar solo la conclusión', 'saltar pasos del razonamiento'],
      mustInclude: ['cada paso del razonamiento explícito', 'por qué se descarta cada alternativa'],
      estimatedLength: 'detailed',
    },
    exception: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'contrast',
      approach: 'Muestra primero la regla general. Luego el caso que la viola. Luego por qué viola la regla.',
      tone: 'sistemático',
      mustAvoid: ['solo nombrar la excepción sin explicar por qué existe'],
      mustInclude: ['la regla general', 'el caso que la viola', 'la razón de la excepción'],
      estimatedLength: 'medium',
    },
    relation: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'contrast',
      approach: 'Usa una analogía de relación conocida (engranajes, domino, etc.) para mapear la relación del material.',
      tone: 'visual y concreto',
      mustAvoid: ['decir "están relacionados" sin explicar cómo'],
      mustInclude: ['mecanismo de la relación', 'qué pasa si uno cambia'],
      estimatedLength: 'medium',
    },
    procedure: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Desglosa el procedimiento en micro-pasos. Explica el propósito de cada uno antes de ejecutarlo.',
      tone: 'metódico y claro',
      mustAvoid: ['dar el procedimiento completo de una vez'],
      mustInclude: ['propósito de cada paso', 'señal de que el paso salió bien'],
      estimatedLength: 'detailed',
    },
  },

  relation: {
    definition: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra explícitamente cómo el concepto A lleva al concepto B. Usa una flecha o secuencia lógica.',
      tone: 'lógico y progresivo',
      mustAvoid: ['presentar los conceptos de forma aislada'],
      mustInclude: ['el mecanismo de conexión', 'qué pasaría si faltara uno de los dos'],
      estimatedLength: 'medium',
    },
    causal: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'analogy',
      approach: 'Descompón la cadena: qué ocurre primero, qué activa, qué produce. Una causa a la vez.',
      tone: 'sistemático',
      mustAvoid: ['presentar la cadena completa sin descomponer'],
      mustInclude: ['cada eslabón de la cadena por separado', 'por qué cada uno activa el siguiente'],
      estimatedLength: 'detailed',
    },
    formula: {
      primaryStrategy: 'perspective_shift',
      secondaryStrategy: 'decompose',
      approach: 'Interpreta la fórmula verbalmente: "esta ecuación dice que cuando X crece, Y hace Z porque..."',
      tone: 'interpretativo',
      mustAvoid: ['mostrar la fórmula sin interpretación verbal'],
      mustInclude: ['lectura verbal de la fórmula', 'relación entre variables en palabras'],
      estimatedLength: 'medium',
    },
    comparison: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'analogy',
      approach: 'Pon las diferencias en paralelo explícito. Usa "mientras A hace X, B hace Y".',
      tone: 'estructurado',
      mustAvoid: ['hablar de A y B por separado sin comparar'],
      mustInclude: ['al menos 2 puntos de contraste específicos'],
      estimatedLength: 'medium',
    },
    classification: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'heuristic',
      approach: 'Explica el criterio que determina a qué categoría pertenece algo. Luego aplica a 2 ejemplos.',
      tone: 'lógico',
      mustAvoid: ['listar categorías sin el criterio discriminante'],
      mustInclude: ['pregunta discriminante', 'ejemplo de cada categoría'],
      estimatedLength: 'medium',
    },
    narrative: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'worked_example',
      approach: 'Narra la secuencia con énfasis en "por qué uno lleva al otro", no solo cuándo ocurrió.',
      tone: 'narrativo',
      mustAvoid: ['cronología sin lógica causal'],
      mustInclude: ['el hilo conductor', 'la consecuencia de cada evento'],
      estimatedLength: 'medium',
    },
    argumentation: {
      primaryStrategy: 'socratic',
      secondaryStrategy: 'contrast',
      approach: 'Guía con preguntas: "¿qué evidencia apoya esto?", "¿qué la refutaría?"',
      tone: 'socrático',
      mustAvoid: ['dar la respuesta directamente'],
      mustInclude: ['pregunta guía', 'pista parcial'],
      estimatedLength: 'brief',
    },
    case: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Resuelve el caso mostrando cómo cada pieza de información activa el siguiente paso.',
      tone: 'analítico',
      mustAvoid: ['saltar a la conclusión'],
      mustInclude: ['razonamiento visible paso a paso'],
      estimatedLength: 'detailed',
    },
    exception: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'counterexample',
      approach: 'Contrasta el caso normal con el caso excepción. Explica exactamente qué activa la excepción.',
      tone: 'preciso',
      mustAvoid: ['solo mencionar que existe la excepción'],
      mustInclude: ['condición que activa la excepción', 'consecuencia de ignorarla'],
      estimatedLength: 'medium',
    },
    relation: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'worked_example',
      approach: 'Usa una analogía mecánica para la relación. Luego aplica la misma lógica al material.',
      tone: 'concreto',
      mustAvoid: ['describir la relación de forma abstracta'],
      mustInclude: ['analogía concreta', 'aplicación directa al material'],
      estimatedLength: 'medium',
    },
    procedure: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Descompón cada paso y muestra qué relación tiene con el anterior y el siguiente.',
      tone: 'secuencial',
      mustAvoid: ['describir los pasos sin mostrar la relación entre ellos'],
      mustInclude: ['por qué el paso N prepara el paso N+1'],
      estimatedLength: 'detailed',
    },
    enumeration: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'analogy',
      approach: 'Agrupa los elementos por similitud antes de presentarlos. Máximo 3-4 por grupo.',
      tone: 'organizado',
      mustAvoid: ['presentar todos los elementos de una vez'],
      mustInclude: ['principio de agrupación', 'regla para recordar'],
      estimatedLength: 'medium',
    },
  },

  application: {
    definition: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'socratic',
      approach: 'Muestra cómo se usa el concepto en un caso concreto. Luego pregunta al estudiante qué haría en un caso similar.',
      tone: 'práctico',
      mustAvoid: ['quedarse en la teoría', 'dar un ejemplo sin explicar el razonamiento'],
      mustInclude: ['caso concreto resuelto', 'pregunta de transferencia'],
      estimatedLength: 'medium',
    },
    formula: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Resuelve un problema con valores distintos al original. Muestra cada paso del cálculo.',
      tone: 'metódico',
      mustAvoid: ['mostrar solo el resultado', 'usar los mismos valores del problema original'],
      mustInclude: ['sustitución de valores', 'cada operación explícita', 'verificación del resultado'],
      estimatedLength: 'detailed',
    },
    procedure: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Ejecuta el procedimiento con un caso nuevo, comentando cada decisión.',
      tone: 'transparente',
      mustAvoid: ['asumir que recuerda el procedimiento'],
      mustInclude: ['ejecución completa', 'criterio de cada decisión'],
      estimatedLength: 'detailed',
    },
    causal: {
      primaryStrategy: 'perspective_shift',
      secondaryStrategy: 'worked_example',
      approach: 'Cambia las condiciones del problema y pregunta qué cambia en el resultado.',
      tone: 'exploratorio',
      mustAvoid: ['repetir el mismo ejemplo con los mismos valores'],
      mustInclude: ['variación de la causa', 'nuevo efecto esperado'],
      estimatedLength: 'medium',
    },
    comparison: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'contrast',
      approach: 'Presenta un caso nuevo y pregunta cuál de las dos opciones aplica y por qué.',
      tone: 'decisional',
      mustAvoid: ['comparar de forma abstracta'],
      mustInclude: ['caso concreto de decisión', 'criterio de la elección'],
      estimatedLength: 'medium',
    },
    classification: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'counterexample',
      approach: 'Presenta 3 casos nuevos y clasifícalos, explicando el razonamiento en cada uno.',
      tone: 'práctico',
      mustAvoid: ['clasificar sin explicar el criterio'],
      mustInclude: ['criterio aplicado', 'un caso límite o ambiguo'],
      estimatedLength: 'detailed',
    },
    narrative: {
      primaryStrategy: 'perspective_shift',
      secondaryStrategy: 'analogy',
      approach: 'Aplica el patrón histórico a un contexto análogo actual o conocido por el estudiante.',
      tone: 'analógico',
      mustAvoid: ['repetir los mismos eventos históricos'],
      mustInclude: ['patrón general extraído', 'aplicación análoga'],
      estimatedLength: 'medium',
    },
    argumentation: {
      primaryStrategy: 'socratic',
      secondaryStrategy: 'worked_example',
      approach: 'Presenta un argumento nuevo y guía al estudiante para evaluarlo con los criterios aprendidos.',
      tone: 'crítico',
      mustAvoid: ['evaluar el argumento por el estudiante'],
      mustInclude: ['criterios de evaluación', 'pregunta de aplicación'],
      estimatedLength: 'medium',
    },
    case: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'perspective_shift',
      approach: 'Resuelve un caso diferente al original, explicando cómo los mismos principios guían la solución.',
      tone: 'analítico',
      mustAvoid: ['usar el mismo caso con distintos nombres'],
      mustInclude: ['principio general aplicado', 'razonamiento visible'],
      estimatedLength: 'detailed',
    },
    exception: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'worked_example',
      approach: 'Presenta un caso donde la regla general fallaría y muestra cómo detectar que aplica la excepción.',
      tone: 'preciso',
      mustAvoid: ['solo explicar la excepción teóricamente'],
      mustInclude: ['señal de que aplica la excepción', 'consecuencia de no aplicarla'],
      estimatedLength: 'medium',
    },
    relation: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'perspective_shift',
      approach: 'Muestra cómo la relación entre A y B produce un resultado observable en un caso nuevo.',
      tone: 'aplicado',
      mustAvoid: ['describir la relación sin mostrar sus efectos'],
      mustInclude: ['manifestación concreta de la relación', 'predicción basada en ella'],
      estimatedLength: 'medium',
    },
    enumeration: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'heuristic',
      approach: 'Presenta un problema que requiere usar los elementos de la lista para resolverlo.',
      tone: 'práctico',
      mustAvoid: ['pedir que liste los elementos sin usarlos'],
      mustInclude: ['problema que requiere usar la lista', 'criterio de selección del elemento correcto'],
      estimatedLength: 'medium',
    },
  },

  procedure: {
    procedure: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Descompón el procedimiento en micro-pasos. Para cada uno: qué se hace, por qué, cómo saber si salió bien.',
      tone: 'metódico y sistemático',
      mustAvoid: ['presentar el procedimiento completo de una vez', 'asumir pasos implícitos'],
      mustInclude: ['propósito de cada paso', 'verificación de cada paso', 'un ejemplo completo resuelto'],
      estimatedLength: 'detailed',
    },
    formula: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Resuelve el procedimiento matemático con valores distintos, mostrando cada operación.',
      tone: 'sistemático',
      mustAvoid: ['saltar pasos algebraicos', 'usar los mismos valores'],
      mustInclude: ['cada operación explícita', 'verificación del resultado'],
      estimatedLength: 'detailed',
    },
    causal: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Descompón la cadena causal como un procedimiento: si haces A, entonces ocurre B, entonces ocurre C.',
      tone: 'secuencial',
      mustAvoid: ['presentar la cadena sin el orden lógico'],
      mustInclude: ['condición de cada eslabón', 'consecuencia de saltarse uno'],
      estimatedLength: 'medium',
    },
    definition: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'heuristic',
      approach: 'Muestra el procedimiento de cómo aplicar el concepto: "cuando ves X, haces Y porque Z".',
      tone: 'procedimental',
      mustAvoid: ['quedarse en la definición abstracta'],
      mustInclude: ['regla de aplicación', 'ejemplo de ejecución'],
      estimatedLength: 'medium',
    },
    comparison: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra cuándo usar el procedimiento A vs el procedimiento B con casos concretos.',
      tone: 'decisional',
      mustAvoid: ['describir los procedimientos sin mostrar cuándo usar cada uno'],
      mustInclude: ['criterio de decisión', 'un caso para cada procedimiento'],
      estimatedLength: 'detailed',
    },
    classification: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra el procedimiento de clasificación: qué preguntas hacerse para determinar la categoría.',
      tone: 'algorítmico',
      mustAvoid: ['clasificar sin mostrar el árbol de decisión'],
      mustInclude: ['preguntas discriminantes en orden', 'ejemplo de clasificación completa'],
      estimatedLength: 'detailed',
    },
    narrative: {
      primaryStrategy: 'ordering',
      secondaryStrategy: 'restate',
      approach: 'Presenta la secuencia como un procedimiento temporal: primero ocurrió X porque Y, luego Z porque W.',
      tone: 'cronológico y causal',
      mustAvoid: ['solo listar eventos sin la lógica de secuencia'],
      mustInclude: ['razón de cada transición entre eventos'],
      estimatedLength: 'medium',
    },
    argumentation: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'socratic',
      approach: 'Descompón la estructura del argumento: tesis → premisa → evidencia → conclusión.',
      tone: 'analítico',
      mustAvoid: ['presentar el argumento completo sin estructura'],
      mustInclude: ['cada componente del argumento etiquetado', 'pregunta de verificación'],
      estimatedLength: 'medium',
    },
    case: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Resuelve un caso diferente siguiendo el mismo procedimiento, comentando cada decisión.',
      tone: 'transparente',
      mustAvoid: ['dar la solución sin el proceso'],
      mustInclude: ['proceso completo', 'criterio de cada decisión'],
      estimatedLength: 'detailed',
    },
    exception: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'counterexample',
      approach: 'Muestra un caso donde el procedimiento estándar falla y por qué aplica el procedimiento especial.',
      tone: 'preciso',
      mustAvoid: ['explicar la excepción sin el contraste con la regla'],
      mustInclude: ['el procedimiento estándar que falla', 'la señal que indica la excepción'],
      estimatedLength: 'medium',
    },
    relation: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra cómo la relación entre A y B se traduce en pasos concretos de acción.',
      tone: 'aplicado',
      mustAvoid: ['describir la relación abstractamente'],
      mustInclude: ['los pasos concretos que derivan de la relación'],
      estimatedLength: 'medium',
    },
    enumeration: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'heuristic',
      approach: 'Muestra cómo cada elemento de la lista tiene un rol en el procedimiento.',
      tone: 'funcional',
      mustAvoid: ['listar elementos sin mostrar para qué sirven en el proceso'],
      mustInclude: ['rol de cada elemento', 'ejemplo de uso'],
      estimatedLength: 'medium',
    },
  },

  causal: {
    causal: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'analogy',
      approach: 'Separa causa de efecto completamente. Explica el mecanismo que conecta uno con otro.',
      tone: 'mecánico y claro',
      mustAvoid: ['presentar causa y efecto juntos sin el mecanismo'],
      mustInclude: ['mecanismo explícito de la causalidad', 'analogía cotidiana'],
      estimatedLength: 'medium',
    },
    definition: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'analogy',
      approach: 'Reexplica la definición enfocándote en la dirección causal: qué produce qué.',
      tone: 'direccional',
      mustAvoid: ['dar la definición sin el componente causal'],
      mustInclude: ['la flecha causal explícita: A → B'],
      estimatedLength: 'brief',
    },
    formula: {
      primaryStrategy: 'perspective_shift',
      secondaryStrategy: 'worked_example',
      approach: 'Lee la fórmula como una relación causal: "cuando X aumenta, Y cambia así porque..."',
      tone: 'interpretativo',
      mustAvoid: ['presentar la fórmula como un algoritmo sin interpretación'],
      mustInclude: ['lectura causal de la fórmula', 'qué variable "causa" y cuál "es causada"'],
      estimatedLength: 'medium',
    },
    comparison: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'worked_example',
      approach: 'Contrasta las causas de A y B: misma causa → diferente efecto, o diferente causa → mismo efecto.',
      tone: 'comparativo',
      mustAvoid: ['describir A y B sin conectar sus cadenas causales'],
      mustInclude: ['cadena causal de A', 'cadena causal de B', 'punto de divergencia'],
      estimatedLength: 'medium',
    },
    classification: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra que la categoría determina el tipo de causa o efecto. Categoría → cadena causal.',
      tone: 'sistemático',
      mustAvoid: ['clasificar sin mostrar las implicaciones causales'],
      mustInclude: ['implicación causal de cada categoría'],
      estimatedLength: 'medium',
    },
    narrative: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'analogy',
      approach: 'Narra como una cadena causal: qué causó el primer evento, qué causó el segundo, etc.',
      tone: 'narrativo causal',
      mustAvoid: ['cronología sin causalidad'],
      mustInclude: ['la causa de cada evento histórico narrado'],
      estimatedLength: 'medium',
    },
    argumentation: {
      primaryStrategy: 'socratic',
      secondaryStrategy: 'contrast',
      approach: 'Pregunta: ¿qué evidencia causaría que este argumento fallara?',
      tone: 'crítico',
      mustAvoid: ['solo presentar el argumento sin cuestionarlo'],
      mustInclude: ['condición de falsabilidad del argumento'],
      estimatedLength: 'medium',
    },
    case: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Traza la cadena causal del caso completo: qué llevó a qué en cada paso.',
      tone: 'analítico',
      mustAvoid: ['presentar el caso sin la secuencia causal'],
      mustInclude: ['la cadena causal completa del caso'],
      estimatedLength: 'detailed',
    },
    exception: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'contrast',
      approach: 'Muestra una situación donde la causa habitual NO produce el efecto habitual. ¿Por qué?',
      tone: 'analítico',
      mustAvoid: ['solo mencionar que hay excepciones causales'],
      mustInclude: ['condición que rompe la causalidad habitual', 'mecanismo alternativo'],
      estimatedLength: 'medium',
    },
    relation: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'decompose',
      approach: 'Usa una analogía donde la relación tiene dirección causal obvia para mapear la relación del material.',
      tone: 'analógico',
      mustAvoid: ['describir la relación sin dirección causal'],
      mustInclude: ['qué es causa y qué es efecto en la relación'],
      estimatedLength: 'medium',
    },
    procedure: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra la cadena causal de cada paso: hacer A causa que ocurra B, que permite hacer C.',
      tone: 'secuencial causal',
      mustAvoid: ['describir los pasos sin el nexo causal entre ellos'],
      mustInclude: ['por qué cada paso activa el siguiente'],
      estimatedLength: 'detailed',
    },
    enumeration: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'heuristic',
      approach: 'Muestra qué causa la existencia de cada elemento de la lista.',
      tone: 'explicativo',
      mustAvoid: ['listar sin mostrar por qué existe cada elemento'],
      mustInclude: ['la causa o razón de cada elemento'],
      estimatedLength: 'medium',
    },
  },

  classification: {
    classification: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Enseña el árbol de decisión de clasificación: pregunta discriminante → categoría.',
      tone: 'algorítmico',
      mustAvoid: ['dar las categorías sin el criterio discriminante'],
      mustInclude: ['pregunta discriminante', 'árbol de decisión simple'],
      estimatedLength: 'medium',
    },
    definition: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'counterexample',
      approach: 'Define cada categoría por lo que la distingue de las otras, no solo por sí misma.',
      tone: 'diferencial',
      mustAvoid: ['definir cada categoría de forma aislada'],
      mustInclude: ['criterio diferencial entre categorías'],
      estimatedLength: 'medium',
    },
    formula: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra cómo el valor de una variable determina la categoría. Formula → condición → categoría.',
      tone: 'cuantitativo',
      mustAvoid: ['dar la fórmula sin mostrar cómo determina la categoría'],
      mustInclude: ['umbral o condición de cada categoría', 'ejemplo numérico'],
      estimatedLength: 'detailed',
    },
    causal: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'contrast',
      approach: 'Muestra que distintas causas producen categorías distintas.',
      tone: 'causal diferencial',
      mustAvoid: ['clasificar sin conectar con las causas'],
      mustInclude: ['causa de cada categoría', 'caso de cada una'],
      estimatedLength: 'medium',
    },
    comparison: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'heuristic',
      approach: 'Compara las categorías directamente en una tabla mental: qué tiene A que no tiene B.',
      tone: 'comparativo',
      mustAvoid: ['describir las categorías sin compararlas'],
      mustInclude: ['al menos 2 diferencias clave', 'heurística para distinguirlas'],
      estimatedLength: 'medium',
    },
    narrative: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'analogy',
      approach: 'Clasifica los eventos o personajes históricos y explica el criterio de clasificación.',
      tone: 'estructurado',
      mustAvoid: ['narrar sin clasificar'],
      mustInclude: ['categorías usadas', 'criterio de clasificación'],
      estimatedLength: 'medium',
    },
    argumentation: {
      primaryStrategy: 'decompose',
      secondaryStrategy: 'contrast',
      approach: 'Clasifica los argumentos por tipo: de autoridad, evidencia, analogía, etc.',
      tone: 'analítico',
      mustAvoid: ['presentar argumentos sin clasificarlos'],
      mustInclude: ['tipo de argumento', 'criterio de cada tipo'],
      estimatedLength: 'medium',
    },
    case: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Clasifica el caso paso a paso: aplica el criterio → determina la categoría → consecuencia.',
      tone: 'procedimental',
      mustAvoid: ['dar la clasificación sin el proceso'],
      mustInclude: ['proceso de clasificación completo'],
      estimatedLength: 'detailed',
    },
    exception: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'contrast',
      approach: 'Muestra un caso que parece pertenecer a una categoría pero no lo hace. ¿Por qué?',
      tone: 'preciso',
      mustAvoid: ['ignorar los casos límite'],
      mustInclude: ['el caso límite', 'por qué no cabe en la categoría intuitiva'],
      estimatedLength: 'medium',
    },
    relation: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'decompose',
      approach: 'Muestra cómo las categorías se relacionan entre sí: ¿son excluyentes? ¿jerárquicas? ¿solapadas?',
      tone: 'estructural',
      mustAvoid: ['presentar categorías como si fueran completamente independientes'],
      mustInclude: ['tipo de relación entre categorías'],
      estimatedLength: 'medium',
    },
    procedure: {
      primaryStrategy: 'worked_example',
      secondaryStrategy: 'decompose',
      approach: 'Muestra el procedimiento de clasificación como un algoritmo de decisión.',
      tone: 'algorítmico',
      mustAvoid: ['clasificar sin el procedimiento explícito'],
      mustInclude: ['árbol de decisión o lista de preguntas'],
      estimatedLength: 'detailed',
    },
    enumeration: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'decompose',
      approach: 'Agrupa los elementos de la lista por categorías y da una regla para cada grupo.',
      tone: 'organizado',
      mustAvoid: ['listar sin clasificar'],
      mustInclude: ['regla de cada grupo', 'heurística global'],
      estimatedLength: 'medium',
    },
  },

  memory: {
    definition: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'analogy',
      approach: 'Crea una regla mnemotécnica, acrónimo o gancho visual para anclar el concepto.',
      tone: 'memorable',
      mustAvoid: ['repetir la definición textual', 'dar más información sin ancla mnemotécnica'],
      mustInclude: ['gancho mnemotécnico concreto', 'conexión con algo ya conocido'],
      estimatedLength: 'brief',
    },
    formula: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'worked_example',
      approach: 'Da un truco para recordar la fórmula: patrón, historia, o regla de los nombres de las variables.',
      tone: 'práctico',
      mustAvoid: ['solo repetir la fórmula'],
      mustInclude: ['truco de memoria', 'ejemplo rápido de uso'],
      estimatedLength: 'brief',
    },
    procedure: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'decompose',
      approach: 'Da un acrónimo o lista numerada corta para los pasos. Máximo 5 pasos.',
      tone: 'conciso y memorable',
      mustAvoid: ['dar todos los detalles de nuevo'],
      mustInclude: ['acrónimo o mnemotécnico', 'versión ultra-condensada del procedimiento'],
      estimatedLength: 'brief',
    },
    causal: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'heuristic',
      approach: 'Ancla la cadena causal a una analogía cotidiana memorable.',
      tone: 'analógico y memorable',
      mustAvoid: ['explicar la cadena completa de nuevo'],
      mustInclude: ['analogía pegadiza', 'la flecha causal en 1 frase'],
      estimatedLength: 'brief',
    },
    comparison: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'heuristic',
      approach: 'Da una frase diferenciadora: "A es X, B es Y. La clave: A tiene P, B tiene Q."',
      tone: 'conciso y diferencial',
      mustAvoid: ['repetir todas las características'],
      mustInclude: ['la diferencia clave en 1-2 frases', 'heurística para no confundirlos'],
      estimatedLength: 'brief',
    },
    classification: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'analogy',
      approach: 'Da una regla simple para clasificar: "si ves X, es categoría A; si ves Y, es categoría B".',
      tone: 'directo y memorable',
      mustAvoid: ['explicar todos los criterios de nuevo'],
      mustInclude: ['regla de clasificación rápida', 'señal visual para cada categoría'],
      estimatedLength: 'brief',
    },
    narrative: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'heuristic',
      approach: 'Narra la secuencia como una historia corta y memorable. Nombres propios + acción clave.',
      tone: 'narrativo y conciso',
      mustAvoid: ['dar todas las fechas y detalles'],
      mustInclude: ['el hilo narrativo en 3-4 frases', 'el punto más memorable'],
      estimatedLength: 'brief',
    },
    argumentation: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'heuristic',
      approach: 'Resume el argumento en 1 frase de tesis + 1 frase de evidencia clave.',
      tone: 'conciso',
      mustAvoid: ['repetir el argumento completo'],
      mustInclude: ['tesis en 1 frase', 'evidencia más poderosa en 1 frase'],
      estimatedLength: 'brief',
    },
    case: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'analogy',
      approach: 'Resume el caso con el principio que ilustra en 1-2 frases memorables.',
      tone: 'conciso',
      mustAvoid: ['describir todos los detalles del caso'],
      mustInclude: ['el principio que ilustra', 'la conclusión clave'],
      estimatedLength: 'brief',
    },
    exception: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'counterexample',
      approach: 'Da una regla de alerta: "cuando veas X, recuerda la excepción: Y".',
      tone: 'alertante y memorable',
      mustAvoid: ['explicar la excepción desde cero'],
      mustInclude: ['señal de alerta', 'la excepción en 1 frase'],
      estimatedLength: 'brief',
    },
    relation: {
      primaryStrategy: 'analogy',
      secondaryStrategy: 'heuristic',
      approach: 'Ancla la relación a una imagen o analogía: "A y B son como X e Y en el mundo cotidiano".',
      tone: 'analógico',
      mustAvoid: ['explicar la relación de forma abstracta'],
      mustInclude: ['analogía visual o cotidiana', 'la relación en 1 frase'],
      estimatedLength: 'brief',
    },
    enumeration: {
      primaryStrategy: 'heuristic',
      secondaryStrategy: 'restate',
      approach: 'Da un acrónimo, rima o patrón para recordar los elementos de la lista.',
      tone: 'mnemotécnico',
      mustAvoid: ['listar todos los elementos de nuevo'],
      mustInclude: ['acrónimo o regla de memoria', 'los 3 elementos más importantes'],
      estimatedLength: 'brief',
    },
  },

  false_confidence: {
    definition: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'contrast',
      approach: 'Muestra directamente por qué la respuesta que dio era incorrecta. Sin rodeos. Luego la correcta.',
      tone: 'directo y claro',
      mustAvoid: ['ser vago sobre por qué estuvo mal', 'suavizar el error'],
      mustInclude: ['explicación explícita del error', 'por qué la respuesta correcta lo es'],
      estimatedLength: 'medium',
    },
    formula: {
      primaryStrategy: 'find_the_error',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra el error de cálculo o de fórmula que cometió. Señala exactamente dónde.',
      tone: 'preciso y correctivo',
      mustAvoid: ['solo dar la respuesta correcta sin señalar el error'],
      mustInclude: ['el error específico', 'por qué es un error', 'la corrección'],
      estimatedLength: 'medium',
    },
    procedure: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'worked_example',
      approach: 'Compara el procedimiento incorrecto que siguió con el correcto, paso a paso.',
      tone: 'comparativo y correctivo',
      mustAvoid: ['explicar el procedimiento correcto sin mostrar dónde falló el suyo'],
      mustInclude: ['paso donde divergió', 'por qué ese paso estaba mal', 'el paso correcto'],
      estimatedLength: 'detailed',
    },
    causal: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'analogy',
      approach: 'Muestra un contraejemplo que refuta la causalidad que creyó correcta.',
      tone: 'refutador',
      mustAvoid: ['solo afirmar que estaba mal sin demostración'],
      mustInclude: ['el contraejemplo específico', 'por qué refuta la causalidad incorrecta'],
      estimatedLength: 'medium',
    },
    comparison: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'counterexample',
      approach: 'Muestra exactamente en qué se equivocó al comparar. ¿Invirtió características? ¿Confundió uno con el otro?',
      tone: 'correctivo y específico',
      mustAvoid: ['repetir la comparación desde cero'],
      mustInclude: ['el error específico de comparación', 'la distinción correcta'],
      estimatedLength: 'medium',
    },
    classification: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'decompose',
      approach: 'Muestra por qué el elemento no pertenece a la categoría que eligió. Criterio discriminante.',
      tone: 'preciso',
      mustAvoid: ['solo decir que la categoría estaba mal sin el criterio'],
      mustInclude: ['el criterio que viola', 'la categoría correcta y por qué'],
      estimatedLength: 'medium',
    },
    narrative: {
      primaryStrategy: 'restate',
      secondaryStrategy: 'contrast',
      approach: 'Corrige la secuencia: "el error fue creer que X ocurrió antes que Y. Lo correcto es..."',
      tone: 'correctivo y claro',
      mustAvoid: ['narrar sin señalar el error de secuencia'],
      mustInclude: ['el error de secuencia específico', 'la secuencia correcta'],
      estimatedLength: 'brief',
    },
    argumentation: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'socratic',
      approach: 'Muestra por qué el argumento que eligió es débil o incorrecto frente al correcto.',
      tone: 'crítico',
      mustAvoid: ['solo afirmar que el argumento era incorrecto'],
      mustInclude: ['debilidad del argumento elegido', 'fortaleza del correcto'],
      estimatedLength: 'medium',
    },
    case: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'worked_example',
      approach: 'Muestra dónde falló el razonamiento en el caso. Paso a paso si es necesario.',
      tone: 'analítico y correctivo',
      mustAvoid: ['dar la solución sin señalar el error de razonamiento'],
      mustInclude: ['el paso del razonamiento donde falló', 'el razonamiento correcto'],
      estimatedLength: 'detailed',
    },
    exception: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'contrast',
      approach: 'Muestra que el caso que presentó no es una excepción, o que la excepción no aplica como creyó.',
      tone: 'preciso y correctivo',
      mustAvoid: ['solo afirmar que estaba equivocado'],
      mustInclude: ['por qué no aplica la excepción en ese caso', 'cuándo sí aplicaría'],
      estimatedLength: 'medium',
    },
    relation: {
      primaryStrategy: 'counterexample',
      secondaryStrategy: 'contrast',
      approach: 'Muestra un caso donde la relación que creyó es claramente falsa.',
      tone: 'refutador directo',
      mustAvoid: ['ser ambiguo sobre cuál relación era incorrecta'],
      mustInclude: ['el contraejemplo claro', 'la relación correcta'],
      estimatedLength: 'medium',
    },
    enumeration: {
      primaryStrategy: 'contrast',
      secondaryStrategy: 'heuristic',
      approach: 'Señala exactamente qué elemento añadió de más, olvidó o confundió en la lista.',
      tone: 'preciso',
      mustAvoid: ['repetir toda la lista sin señalar el error específico'],
      mustInclude: ['el error específico en la lista', 'la lista correcta'],
      estimatedLength: 'brief',
    },
  },
}

// ─── Función auxiliar para búsqueda tolerante ────────────────
export function findStrategy(
  errorType: ErrorType,
  contentSignal: ContentSignal,
): RecoveryStrategyDecision {
  return (
    STRATEGY_MATRIX[errorType]?.[contentSignal] ||
    STRATEGY_MATRIX[errorType]?.['definition'] ||
    STRATEGY_MATRIX['memory']?.['definition'] || {
      primaryStrategy: 'restate',
      secondaryStrategy: 'analogy',
      approach: 'Reexplica el concepto desde otro ángulo con un ejemplo concreto.',
      tone: 'claro y directo',
      mustAvoid: ['repetir el texto original'],
      mustInclude: ['ejemplo concreto', 'perspectiva diferente'],
      estimatedLength: 'medium',
    }
  )
}

// ─── API pública ──────────────────────────────────────────────

/**
 * Decide la estrategia pedagógica de recovery.
 *
 * Determinístico. Sin side effects. Sin IA.
 */
export function decideRecoveryStrategy(params: {
  errorType: ErrorType
  contentSignal: ContentSignal
}): RecoveryStrategyDecision {
  return findStrategy(params.errorType, params.contentSignal)
}

/**
 * Construye las instrucciones para el prompt de reteach.
 *
 * Este texto va directo al prompt del LLM, integrado sobre el
 * sistema existente sin cambiar el contrato del reteach.
 */
export function buildReteachStrategyInstructions(params: {
  errorType: ErrorType
  contentSignal: ContentSignal
  studentAnswerSummary: string
  correctAnswerSummary: string
  consecutiveFailures: number
}): string {
  const decision = findStrategy(params.errorType, params.contentSignal)
  const { studentAnswerSummary, correctAnswerSummary, consecutiveFailures } = params

  // Rotación por ronda (B3, corrige P3.2): antes solo alternaba entre 2
  // estrategias por paridad — round 3/5/7... volvían a repetir primary. La
  // rotación completa (ver buildStrategyRotation) progresa genuinamente:
  // ronda 1=primary, ronda 2=secondary, ronda 3+=siguiente estrategia del
  // catálogo aún no usada por esta matriz — nunca repite la misma dos
  // rondas seguidas mientras queden estrategias sin usar en el catálogo.
  const rotation = buildStrategyRotation(decision)
  const roundIndex = Math.min(Math.max(consecutiveFailures, 0), rotation.length - 1)
  const leadingStrategy = rotation[roundIndex]
  const useSecondary = roundIndex > 0
  const approach = roundIndex === 0
    ? decision.approach
    : `${GENERIC_STRATEGY_INSTRUCTION[leadingStrategy]} (cambio de representación respecto al intento anterior — evita repetir la explicación ya dada).`

  const lengthMap = {
    brief: '3-4 frases. Ve al punto.',
    medium: '5-8 frases. Explica con claridad.',
    detailed: '8-12 frases. No omitas ningún paso.',
  }

  const frustrationNote = consecutiveFailures >= 2
    ? '\n⚠️ El estudiante ha fallado varias veces. Sé especialmente claro y empático. Empieza validando que el tema es difícil, luego explica.'
    : ''

  return `
═══════════════════════════════════════════════════════════════
ESTRATEGIA PEDAGÓGICA DE RECUPERACIÓN
═══════════════════════════════════════════════════════════════
${frustrationNote}

ERROR DETECTADO: ${params.errorType}
SEÑAL DE CONTENIDO: ${params.contentSignal}

LO QUE RESPONDIÓ EL ESTUDIANTE:
"${studentAnswerSummary}"

LO CORRECTO ERA:
"${correctAnswerSummary}"

ESTRATEGIA PRIMARIA: ${decision.primaryStrategy}
ESTRATEGIA SECUNDARIA: ${decision.secondaryStrategy}
ESTRATEGIA A EJECUTAR EN ESTA RONDA: ${leadingStrategy}${useSecondary ? ' (secundaria — cambio de representación respecto a la ronda anterior)' : ''}

INSTRUCCIÓN PEDAGÓGICA:
${approach}

TONO: ${decision.tone}

EXTENSIÓN OBJETIVO: ${lengthMap[decision.estimatedLength]}

OBLIGATORIO INCLUIR:
${decision.mustInclude.map(item => `- ${item}`).join('\n')}

PROHIBIDO:
${decision.mustAvoid.map(item => `- ${item}`).join('\n')}

ESTRUCTURA SUGERIDA:
1. Valida el error (sin juzgar): "El punto donde quedó la confusión fue..."
2. ${leadingStrategy === 'analogy' ? 'Introduce la analogía' : leadingStrategy === 'counterexample' ? 'Presenta el contraejemplo' : leadingStrategy === 'worked_example' ? 'Resuelve el ejemplo' : leadingStrategy === 'decompose' ? 'Descompón el concepto' : leadingStrategy === 'contrast' ? 'Contrasta lo correcto vs lo incorrecto' : leadingStrategy === 'heuristic' ? 'Da el truco o regla mnemotécnica' : leadingStrategy === 'socratic' ? 'Haz las preguntas guía' : leadingStrategy === 'ordering' ? 'Presenta la secuencia paso a paso' : leadingStrategy === 'find_the_error' ? 'Presenta el razonamiento con el error a identificar' : leadingStrategy === 'perspective_shift' ? 'Cambia el punto de vista narrativo' : 'Reexplica desde el nuevo ángulo'}
3. Aplica al caso concreto del material
4. Cierra con la idea más importante para recordar (1 frase)

PROHIBIDO EN ESTA REEXPLICACIÓN:
- Copiar párrafos del texto original
- Usar frases como "como dijimos antes" (esto es la primera vez que lo ves bien)
- Hacer preguntas retóricas sin respuesta
- Prometer que "ahora sí quedará claro" (no puedes garantizarlo)
`
}

// Auditoría adversarial (Codex, Reteach #3.2): el contrato JSON del prompt
// vivo (session-reteach/route.ts) fijaba "máximo 3 oraciones" para
// `explanation` SIN IMPORTAR qué estrategia se hubiera decidido — una
// estrategia 'detailed' (worked_example, decompose: "8-12 frases, no omitas
// ningún paso") quedaba contradicha por su propio contrato de salida,
// haciendo improbable un ejemplo resuelto o una descomposición completa.
// Mismo cálculo de estrategia líder (findStrategy + alternancia por ronda)
// que buildReteachStrategyInstructions, expuesto por separado para que el
// caller pueda declarar un límite de extensión consistente con la
// instrucción pedagógica real en vez de un número fijo.
const EXPLANATION_LENGTH_HINT: Record<RecoveryStrategyDecision['estimatedLength'], string> = {
  brief: 'máximo 3-4 oraciones',
  medium: '5-8 oraciones',
  detailed: '8-12 oraciones — no omitas ningún paso si la estrategia es un ejemplo resuelto o una descomposición',
}
export function estimatedExplanationLength(
  errorType: ErrorType,
  contentSignal: ContentSignal,
): string {
  // decision.estimatedLength no varía entre estrategia primaria/secundaria
  // (es una propiedad de la entrada de la matriz por errorType+contentSignal,
  // no de la estrategia elegida en esta ronda) — igual que
  // buildReteachStrategyInstructions, que lo usa directamente sin
  // condicionar por useSecondary.
  const decision = findStrategy(errorType, contentSignal)
  return EXPLANATION_LENGTH_HINT[decision.estimatedLength]
}
