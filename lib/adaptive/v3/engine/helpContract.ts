export type AssistanceLevel = 'independent' | 'minimal_hint' | 'guided' | 'assisted' | 'revealed'
export type HelpKind = 'hint' | 'simplify' | 'similar_example' | 'material_reminder' | 'discard_option' | 'break_into_steps' | 'dont_know_start'

export interface HelpUsage {
  kind: HelpKind
  level: number
  assistanceLevel: AssistanceLevel
  text: string
  eliminatedOptionIndex?: number
}

const ORDER: AssistanceLevel[] = ['independent', 'minimal_hint', 'guided', 'assisted', 'revealed']
const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

export function nextAssistanceLevel(current: AssistanceLevel, requested: AssistanceLevel): AssistanceLevel {
  return ORDER[Math.max(ORDER.indexOf(current), ORDER.indexOf(requested))]
}

function levelFor(level: number): AssistanceLevel {
  return level <= 1 ? 'minimal_hint' : level === 2 ? 'guided' : level === 3 ? 'assisted' : 'revealed'
}

function safeReminder(value: string, answers: string[]): string {
  let result = value
  for (const answer of answers.filter(answer => answer.length >= 3)) {
    result = result.replace(new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'la idea clave')
  }
  return result
}

export function buildProgressiveHelp(
  interaction: any,
  context: { microName?: string; materialReminder?: string; keyIdea?: string },
  kind: HelpKind,
  level: number,
): HelpUsage {
  const data = interaction?.data || {}
  const type = clean(interaction?.interactionType || interaction?.type)
  const options = Array.isArray(data.options) ? data.options.map(clean) : []
  const correctIndex = Number.isInteger(data.correctIndex) ? data.correctIndex : -1
  const answers = [data.correctAnswer, ...(Array.isArray(data.correctAnswers) ? data.correctAnswers : []), correctIndex >= 0 ? options[correctIndex] : ''].map(clean).filter(Boolean)
  const micro = clean(context.microName) || 'este concepto'
  const reminder = safeReminder(clean(context.materialReminder || context.keyIdea), answers)
  const assistanceLevel = levelFor(level)
  let text = ''
  let eliminatedOptionIndex: number | undefined

  if (kind === 'discard_option' && options.length > 2 && correctIndex >= 0) {
    eliminatedOptionIndex = options.map((_: string, index: number) => index).reverse().find((index: number) => index !== correctIndex)
    text = `Puedes descartar la opción ${String.fromCharCode(65 + (eliminatedOptionIndex ?? 0))}: no mantiene la relación que pide la pregunta.`
  } else if (kind === 'break_into_steps') {
    text = `Paso 1: identifica qué dato y qué relación de ${micro} necesitas. Paso 2: aplica una sola transformación. Paso 3: comprueba que el resultado responda exactamente a la pregunta.`
  } else if (kind === 'material_reminder') {
    text = reminder ? `Vuelve a esta parte del material: ${reminder}` : `Busca en el material la relación que define ${micro}; compárala con cada alternativa.`
  } else if (kind === 'similar_example') {
    text = `Ejemplo paralelo: imagina dos casos de ${micro} que solo cambian en una condición. Primero decide qué relación se conserva; luego aplica ese mismo criterio aquí.`
  } else if (kind === 'simplify') {
    text = `En simple: la pregunta no pide recitar ${micro}; pide reconocer qué elementos se relacionan y en qué dirección.`
  } else if (kind === 'dont_know_start') {
    text = type.includes('numeric') || type.includes('step')
      ? `Empieza anotando los datos conocidos y la incógnita. Después elige la relación de ${micro} que conecta ambos.`
      : `Empieza subrayando la diferencia decisiva entre las opciones. Busca cuál conserva la relación central de ${micro}.`
  } else if (level >= 4) {
    text = answers[0] ? `La respuesta es ${answers[0]}. Es correcta porque coincide con la relación descrita en ${micro}.` : `La solución se obtiene aplicando directamente la relación central de ${micro}.`
  } else {
    text = reminder
      ? `Orienta tu decisión con esta relación: ${reminder}`
      : `Fíjate en la relación entre los elementos de ${micro}, no solo en palabras que suenan familiares.`
  }

  return { kind, level, assistanceLevel, text, eliminatedOptionIndex }
}
