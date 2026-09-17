export const QUIZ_HELP_LIMIT = 3
export const QUIZ_HELP_EXHAUSTED_MESSAGE = 'Ya usaste tus 3 ayudas en este quiz.'

export type QuizHelpAction = 'hint' | 'eliminate_two' | 'discard_incorrect' | 'review_evidence'
  | 'reveal_letter' | 'discard_connection' | 'key_concept'

export interface QuizHelpQuestion {
  id: string
  type: string
  options?: string[]
  correctAnswer?: unknown
  correctAnswers?: number[]
  answer?: string
  pairs?: Array<{ left: string; right: string }>
  acceptedAnswers?: string[]
  sourcePage?: number
  question?: string
  explanation?: string
}

export interface QuizHelpEffect {
  action: QuizHelpAction
  message: string
  hiddenOptionIndexes?: number[]
}

function trueFalseHint(question: QuizHelpQuestion): string {
  return question.sourcePage
    ? `Revisa la evidencia de la página ${question.sourcePage} y contrasta cada afirmación sin asumir su valor de verdad.`
    : 'Revisa la evidencia de origen y contrasta cada afirmación sin asumir su valor de verdad.'
}

function normalized(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function protectedAnswers(question: QuizHelpQuestion): string[] {
  if (question.type === 'multiple_choice' && typeof question.correctAnswer === 'number') {
    return [question.options?.[question.correctAnswer] || '']
  }
  if (question.type === 'multi_select') return (question.correctAnswers || []).map(index => question.options?.[index] || '')
  if (question.type === 'fill_blank') return [question.answer || '']
  if (question.type === 'short_answer') return question.acceptedAnswers || []
  return []
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function completeEvidenceSentence(question: QuizHelpQuestion): string | null {
  const evidence = String(question.explanation || '').trim()
  if (!evidence) return null
  const candidates = evidence.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean)
  const questionText = normalized(question.question)
  const answers = protectedAnswers(question).map(answer => answer.trim()).filter(Boolean)

  for (const original of candidates) {
    if (normalized(original) === questionText || normalized(original).split(' ').length < 6) continue
    let sentence = original
    for (const answer of answers) {
      sentence = sentence.replace(new RegExp(escapeRegExp(answer), 'giu'), 'la figura relevante')
    }
    const normalizedSentence = normalized(sentence)
    if (answers.some(answer => normalizedSentence.includes(normalized(answer)))) continue
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
  }
  return null
}

function evidenceBasedHint(question: QuizHelpQuestion, evidence: string): string {
  if (question.type === 'multiple_choice') {
    const descriptive = evidence.match(/^la figura relevante\s+(?:fue\s+)?(?:conocid[oa]|descrit[oa]|destacad[oa])\s+por\s+(.+?)[.]?$/i)
    if (descriptive?.[1]) return `Piensa en la figura que el texto caracteriza por ${descriptive[1].replace(/[.]$/, '')}.`
    return `Fíjate en esta evidencia y distingue qué opción encaja con ella: ${evidence}`
  }
  if (question.type === 'multi_select') return `Busca las afirmaciones que comparten este criterio respaldado por el material: ${evidence}`
  if (question.type === 'true_false') return `Contrasta la afirmación con esta evidencia, sin decidir por palabras aisladas: ${evidence}`
  if (question.type === 'fill_blank') return `Usa este contexto para identificar la categoría del concepto que falta: ${evidence}`
  if (question.type === 'short_answer') return `Enfoca tu respuesta en el concepto central de esta evidencia: ${evidence}`
  return evidence
}

function groundedCue(question: QuizHelpQuestion): string {
  // Matching hints stay categorical: quoting its evidence can disclose an exact pair.
  const evidence = question.type === 'matching' ? null : completeEvidenceSentence(question)
  if (evidence) return evidenceBasedHint(question, evidence)
  const page = question.sourcePage ? ` en la página ${question.sourcePage}` : ''
  if (question.type === 'multiple_choice') return `Compara qué alternativa encaja con la idea central documentada${page}, no solo con palabras parecidas.`
  if (question.type === 'multi_select') return `Busca el criterio común que comparten las afirmaciones respaldadas${page}; no selecciones por asociación superficial.`
  if (question.type === 'true_false') return trueFalseHint(question)
  if (question.type === 'fill_blank') return `Identifica qué concepto completa coherentemente la relación expresada${page}.`
  if (question.type === 'matching') return `Distingue qué atributo o hecho específico pertenece a cada concepto${page}.`
  return `Enfoca tu respuesta en la categoría conceptual respaldada${page}, no en un ejemplo aislado.`
}

export function availableQuizHelpActions(question: QuizHelpQuestion): QuizHelpAction[] {
  const actions: QuizHelpAction[] = ['hint']
  if (question.type === 'multiple_choice' && question.options?.length === 4) {
    const incorrect = question.options.map((_, index) => index).filter(index => index !== question.correctAnswer)
    if (incorrect.length >= 2) actions.push('eliminate_two')
  } else if (question.type === 'multi_select') {
    const correct = new Set(question.correctAnswers || [])
    if ((question.options || []).some((_, index) => !correct.has(index))) actions.push('discard_incorrect')
  } else if (question.type === 'true_false') actions.push('review_evidence')
  else if (question.type === 'fill_blank' && String(question.answer || '').replace(/\s/g, '').length > 1) actions.push('reveal_letter')
  else if (question.type === 'matching' && (question.pairs?.length || 0) >= 2) actions.push('discard_connection')
  else if (question.type === 'short_answer') actions.push('key_concept')
  return actions
}

export function createQuizHelpEffect(question: QuizHelpQuestion, action: QuizHelpAction): QuizHelpEffect | null {
  if (!availableQuizHelpActions(question).includes(action)) return null
  if (action === 'hint') {
    return { action, message: groundedCue(question) }
  }
  if (action === 'eliminate_two') {
    const hiddenOptionIndexes = question.options!.map((_, index) => index)
      .filter(index => index !== question.correctAnswer).slice(0, 2)
    return { action, hiddenOptionIndexes, message: 'Quité dos opciones que no pueden ser correctas. Ahora compara las dos restantes.' }
  }
  if (action === 'discard_incorrect') {
    const correct = new Set(question.correctAnswers || [])
    const index = question.options!.findIndex((_, optionIndex) => !correct.has(optionIndex))
    return index < 0 ? null : { action, hiddenOptionIndexes: [index], message: 'Marqué una opción que no pertenece al grupo correcto.' }
  }
  if (action === 'review_evidence') return { action, message: trueFalseHint(question) }
  if (action === 'reveal_letter') {
    const answer = String(question.answer || '')
    const visibleIndex = [...answer].findIndex(character => character.trim().length > 0)
    if (visibleIndex < 0) return null
    const masked = [...answer].map((character, index) => index === visibleIndex || !character.trim() ? character : '•').join('')
    return { action, message: `Te revelé una letra: ${masked}. Úsala junto con el contexto de la oración.` }
  }
  if (action === 'discard_connection') {
    const pairs = question.pairs || []
    return { action, message: `Esta conexión no puede corresponder según el material: “${pairs[0].left}” con “${pairs[1].right}”.` }
  }
  if (action === 'key_concept') {
    return { action, message: question.sourcePage
      ? `Concepto clave: identifica la idea central respaldada en la página ${question.sourcePage}.`
      : 'Concepto clave: identifica la idea central respaldada por la evidencia.' }
  }
  return null
}

export function consumeQuizHelp(helpsUsed: number, effect: QuizHelpEffect | null): {
  helpsUsed: number; helpsRemaining: number; consumed: boolean; message?: string
} {
  if (!effect) return { helpsUsed, helpsRemaining: Math.max(0, QUIZ_HELP_LIMIT - helpsUsed), consumed: false }
  if (helpsUsed >= QUIZ_HELP_LIMIT) return {
    helpsUsed, helpsRemaining: 0, consumed: false, message: QUIZ_HELP_EXHAUSTED_MESSAGE,
  }
  const next = helpsUsed + 1
  return { helpsUsed: next, helpsRemaining: QUIZ_HELP_LIMIT - next, consumed: true }
}
