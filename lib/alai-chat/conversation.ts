import {
  boundedIds,
  CHAT_LIMITS,
  isRecord,
  type ChatConversationContext,
  type ChatIntent,
  type ResponseShape,
  type SourcePolicy,
  type PedagogicalAction,
  type RevelationRestriction,
  type PedagogicalState,
  type PedagogicalTransition,
} from './contracts'
import { detectChatIntent, normalizeIntentText } from './intent'

const policies = new Set<SourcePolicy>(['MATERIAL_ONLY', 'GENERAL_ONLY', 'MIXED'])
const shapes = new Set<ResponseShape>(['prose', 'concise_prose', 'deep_explanation', 'bullet_list', 'numbered_steps', 'comparison_table', 'timeline', 'equation_work', 'worked_solution', 'definition_set', 'graph', 'mixed'])
export function boundedHistory(value: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(value)) return []
  return value.slice(-CHAT_LIMITS.historyMessages).flatMap(raw => isRecord(raw) && typeof raw.content === 'string'
    ? [{ role: raw.role === 'assistant' ? 'assistant' as const : 'user' as const, content: raw.content.slice(0, CHAT_LIMITS.historyMessageChars) }]
    : [])
}

export function readConversationContext(value: unknown): ChatConversationContext | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.subject !== 'string'
    || !policies.has(value.sourcePolicy as SourcePolicy) || !shapes.has(value.operation as ResponseShape)) return null
  return {
    version: 1, subject: value.subject.slice(0, CHAT_LIMITS.subjectChars),
    operation: value.operation as ResponseShape, sourcePolicy: value.sourcePolicy as SourcePolicy,
    usedTargetIds: boundedIds(value.usedTargetIds), usedRelationIds: boundedIds(value.usedRelationIds, CHAT_LIMITS.relations),
    ...(Number.isInteger(value.requestedCount) && Number(value.requestedCount) > 0 && Number(value.requestedCount) <= 30 ? { requestedCount: Number(value.requestedCount) } : {}),
    ...(Number.isInteger(value.ordinal) && Number(value.ordinal) > 0 && Number(value.ordinal) <= 30 ? { ordinal: Number(value.ordinal) } : {}),
    ...(typeof value.activeProblem === 'string' && value.activeProblem.trim() ? { activeProblem: value.activeProblem.trim().slice(0, CHAT_LIMITS.subjectChars) } : {}),
    ...(typeof value.workingMemory === 'string' && value.workingMemory.trim() ? { workingMemory: value.workingMemory.trim().slice(0, 1000) } : {}),
    ...(typeof value.focusedEntity === 'string' && value.focusedEntity.trim() ? { focusedEntity: value.focusedEntity.trim().slice(0, 100) } : {}),
    ...(typeof value.lastReferent === 'string' && value.lastReferent.trim() ? { lastReferent: value.lastReferent.trim().slice(0, 300) } : {}),
    ...(typeof value.lastAssistantAction === 'string' && ['answered', 'generated_exercise', 'clarification', 'hint'].includes(value.lastAssistantAction) ? { lastAssistantAction: value.lastAssistantAction as any } : {}),
    ...(Array.isArray(value.practiceAsked) ? { practiceAsked: value.practiceAsked.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map(q => q.trim().slice(0, 160)).slice(-12) } : {}),
    ...(Array.isArray(value.practiceTargetIds) ? { practiceTargetIds: boundedIds(value.practiceTargetIds, 60) } : {}),
    ...(Array.isArray(value.practiceCurrentTargetIds) ? { practiceCurrentTargetIds: boundedIds(value.practiceCurrentTargetIds, 12) } : {}),
    ...(Number.isInteger(value.practiceAttempts) && Number(value.practiceAttempts) >= 0 && Number(value.practiceAttempts) <= 50 ? { practiceAttempts: Number(value.practiceAttempts) } : {}),
    ...(value.practiceRevealed === true ? { practiceRevealed: true } : {}),
    ...(typeof value.practiceQuestionRef === 'string' && value.practiceQuestionRef.trim() ? { practiceQuestionRef: value.practiceQuestionRef.trim().slice(0, 160) } : {}),
    ...(['start', 'correct', 'partial', 'incorrect', 'question'].includes(String(value.practiceLastVerdict)) ? { practiceLastVerdict: value.practiceLastVerdict as 'start' | 'correct' | 'partial' | 'incorrect' | 'question' } : {}),
    ...(isRecord(value.pedagogicalState) && value.pedagogicalState.version === 1 ? {
      pedagogicalState: {
        version: 1,
        targetObject: typeof value.pedagogicalState.targetObject === 'string' ? value.pedagogicalState.targetObject.slice(0, CHAT_LIMITS.subjectChars) : '',
        ...(typeof value.pedagogicalState.originTurnId === 'string' ? { originTurnId: value.pedagogicalState.originTurnId.slice(0, 100) } : {}),
        ...(typeof value.pedagogicalState.focusedEntity === 'string' ? { focusedEntity: value.pedagogicalState.focusedEntity.slice(0, 100) } : {}),
        ...(typeof value.pedagogicalState.lastReferent === 'string' ? { lastReferent: value.pedagogicalState.lastReferent.slice(0, 300) } : {}),
        pedagogicalAction: (['generated_exercise', 'solve_exercise', 'hint', 'clarification', 'explanation', 'answered'] as const).includes(value.pedagogicalState.pedagogicalAction as any)
          ? (value.pedagogicalState.pedagogicalAction as any)
          : 'answered',
        revelationRestriction: value.pedagogicalState.revelationRestriction === 'hidden' ? 'hidden' : 'revealed',
        ...(Number.isInteger(value.pedagogicalState.hintCount) ? { hintCount: Number(value.pedagogicalState.hintCount) } : {}),
      }
    } : {}),
  }
}

/** Legacy history contributes user intent only. Never mine old assistant prose/IDs for authority. */
export function contextFromLegacyHistory(history: unknown): ChatConversationContext | null {
  let context: ChatConversationContext | null = null
  for (const message of boundedHistory(history)) {
    if (message.role === 'user') context = resolveConversation(message.content, context).context
  }
  return context
}

const nonInheritedShapes = new Set<ResponseShape>([
  'graph', 'comparison_table', 'timeline', 'definition_set',
  'worked_solution', 'numbered_steps', 'equation_work',
])

export function normalizeEquationString(eq: string): string {
  if (!eq) return ''
  return eq
    .replace(/[*_`]/g, '')
    .replace(/\\(?:text|mathrm|mathbf)\{([^}]+)\}/g, '$1')
    .replace(/\\(?:cdot|times)/g, '*')
    .replace(/\^\{?2\}?/g, '²')
    .replace(/\^\{?3\}?/g, '³')
    .replace(/\s+/g, ' ')
    .replace(/^[¿?¡!.,;:()]+|[¿?¡!.,;:()]+$/g, '')
    .trim()
}

export function extractAllEquations(text: string): string[] {
  if (!text) return []
  const clean = text
    .replace(/\$\$|\\\[|\\\]|\\\(|\\\)/g, ' ')
    .replace(/[*_`]/g, ' ')
    .replace(/\^\{?2\}?/g, '²')
    .replace(/\^\{?3\}?/g, '³')
    .replace(/\b(?:resuelve|resolver|grafica|graficar|calcula|calcular|despeja|simplifica|factoriza|evalua|halla|hallar|encuentra|dada|la ecuacion|la funcion)\s+/gi, ' ')

  const matches = clean.matchAll(/(?:[a-zA-Z0-9²³()^/*+-]+\s*){1,8}=\s*-?\s*[0-9a-zA-Z()^/*+-]+(?:\s*[+/*-]\s*[0-9a-zA-Z()^/*+-]+)*/gi)
  const results: string[] = []
  for (const m of matches) {
    let raw = normalizeEquationString(m[0])
    raw = raw.replace(/^(?:resuelve|resolver|grafica|graficar|calcula|calcular|despeja|simplifica|factoriza|evalua|dada|la|el|en|para)\s+/gi, '').trim()
    if (!raw.includes('=')) continue
    // Exclude simple variable assignments like "a = 1", "b = -6", "x = 2", "la b = 5"
    if (/^(?:la |el )?[a-zA-Z]\s*=\s*-?\d+(?:[.,]\d+)?$/i.test(raw)) continue
    if (raw.length < 3 || raw.length > CHAT_LIMITS.subjectChars) continue
    if (!/[x²³yza-zA-Z]/.test(raw)) continue
    if (!results.includes(raw)) {
      results.push(raw)
    }
  }
  return results
}

export function extractActiveProblem(text: string, preferDifferentFrom?: string): string | null {
  if (!text) return null
  const equations = extractAllEquations(text)
  if (preferDifferentFrom) {
    const normPrefer = normalizeEquationString(preferDifferentFrom).replace(/\s/g, '').toLowerCase()
    const different = equations.filter(eq => normalizeEquationString(eq).replace(/\s/g, '').toLowerCase() !== normPrefer)
    if (different.length > 0) {
      return different[different.length - 1]
    }
  }
  if (equations.length > 0) {
    return equations[0]
  }

  const stripped = text.replace(/\$\$|\\\[|\\\]|\\\(|\\\)/g, ' ')
  const clean = stripped.replace(/^(?:resuelve|resolver|grafica|graficar|calcula|calcular|despeja|simplifica|factoriza|evalua|dada la ecuacion|la funcion|la ecuacion)\s+/i, '')
  const m = clean.match(/(?:[a-zA-Z0-9²³()^/*+-]+\s*){1,6}=\s*-?\s*[0-9a-zA-Z()^/*+-]+(?:\s*[+/*-]\s*[0-9a-zA-Z()^/*+-]+)*/i)
  if (m) {
    const eq = normalizeEquationString(m[0])
    if (eq.includes('=') && eq.length >= 3 && !/^(?:la |el )?[abcxyz]\s*=\s*-?\d+$/i.test(eq) && eq.length <= CHAT_LIMITS.subjectChars) {
      return eq
    }
  }
  return null
}

export function hasExplicitNewProblem(message: string): boolean {
  const clean = normalizeIntentText(message).replace(/[¿?¡!.,;:()]/g, ' ').replace(/\s+/g, ' ').trim()

  // Exclude explicit verification/continuation of an active problem
  if (/\b(?:comprueba|comprobar|verifica|verificar|sustituye|sustituir)\b/i.test(clean)
    && /\b(?:en la anterior|en esa|en este|de la anterior|esa solucion|esa raiz)\b/i.test(clean)) {
    return false
  }

  // 1. Explicit action verbs introducing a fresh problem with an equation/reaction
  if (/\b(?:resuelve|resolver|grafica|graficar|balancea|balancear|calcula|calcular|simplifica|simplificar|factoriza|factorizar|despeja|despejar)\b/i.test(clean)
    && (/[0-9a-zA-Z.+\-*/^()²³_]+\s*=\s*-?[0-9a-zA-Z.+\-*/^()²³_]+/i.test(clean) || /->|→/.test(clean))) {
    if (!/\b(?:esa|ese|eso|anterior|misma|mismo)\s+(?:ecuacion|problema|funcion)\b/i.test(clean)
      && !/\b(?:grafical[ao]|resuelvel[ao]|despejal[ao]|simplifical[ao]|compruebal[ao])\b/i.test(clean)) {
      return true
    }
  }

  // 2. Standalone equation present in the query (e.g. "3x² + 15x + 12 = 0", "y = x² - 4")
  const extracted = extractActiveProblem(message)
  if (extracted && extracted.includes('=') && extracted.length >= 5) {
    if (/[x²³yza-zA-Z].*[=].*[0-9a-zA-Z]/.test(extracted)
      && !/^(?:la |el )?[abcxyz]\s*=\s*-?\d+$/i.test(extracted.trim())) {
      if (!/\b(?:en esa|en la anterior|de la anterior|esa ecuacion)\b/i.test(clean)) {
        return true
      }
    }
  }

  // 3. Self-contained text processing tasks providing their own inline corpus
  if (/\b(?:corrige|corregir|analiza|analizar|traduce|traducir|revisa|revisar|clasifica|clasificar)\b/i.test(clean)
    && (/[«"'][^«"']{5,}[»"']/.test(message) || /:\s*.{10,}/.test(message))) {
    return true
  }

  return false
}

export function isContextualContinuation(message: string, previous: ChatConversationContext | null): boolean {
  if (!previous) return false
  const q = normalizeIntentText(message)
  const clean = q.replace(/[¿?¡!.,;:()]/g, ' ').replace(/\s+/g, ' ').trim()
  const cleanWords = clean.split(' ').filter(Boolean)

  const hasMathVariable = /\b[bcxz]\b/i.test(clean)
    || /\b(?:la\s+a|el\s+a|variable\s+a|coeficiente\s+a|termino\s+a|valor\s+de\s+a|vale\s+a|a\s+vale|a\s*=|a\s+es|a\s+ahi)\b/i.test(clean)
    || /\b(?:la\s+y|el\s+y|variable\s+y|eje\s+y|valor\s+de\s+y|vale\s+y|y\s*=|y\s+es|y\s+ahi)\b/i.test(clean)
    || /\b[abcxyz]\s*=\s*-?\d+/i.test(clean)
    || /\b[abcxyz]\s*,\s*[abcxyz]\b/i.test(clean)

  const hasMathEntity = /\b(?:coeficiente|termino|vertice|raiz|raices|discriminante|formula|paso|signo|resultado|solucion|parabola|corte|interseccion|eje|negativo|negativa|positivo|positiva|cero|mas|menos)\b/i.test(clean)

  // 1. Explicit deictics or anaphora:
  const hasDeicticTarget = /\b(?:no lo entendi|no entendi|no me quedo claro|explica(?:cion|ciones)?|aclara|grafica|resuelve|formula|paso|valor|resultado|parte|punto|ecuacion|signo|termino|respuesta|texto|parrafo|definicion|ejemplo|donde salio|de donde vino|por que hiciste|por que pusiste)\b/i.test(clean)
  if (/\b(?:eso|esa|ese|este|esta|estos|estas|aquel|aquella|aquello|anterior|ultimo|mismo|misma)\b/i.test(clean)
    && (hasDeicticTarget || cleanWords.length <= 4 || hasMathVariable || hasMathEntity)) {
    return true
  }
  if (/\b(?:ahi|alli|aqui)\b/i.test(clean)
    && (cleanWords.length <= 8 || hasDeicticTarget || hasMathVariable || hasMathEntity)) {
    return true
  }

  // 2. Questions about variables, terms, coefficients, signs, or mathematical entities:
  // e.g. "cuál era la b ahí?", "cuál es el valor de b?", "cuánto vale a?", "por qué es negativa?", "qué representa c?", "dime el vértice"
  if (/\b(?:que|quien|cual|cuanto|como|donde|por que|dime|muestra|comprueba|comprobar)\b/i.test(clean)
    && (hasMathVariable || hasMathEntity)) {
    return true
  }

  // 3. Elliptical questions: "y la c?", "y el vértice?", "pero por qué?", "cuál de las dos?"
  if (/^(?:y|pero)\s+(?:la\s+|el\s+)?(?:[bcxz]|a\b|y\b|vertice|discriminante|signo|formula|paso|raiz|raices|solucion|resultado)\b/i.test(clean)
    || /^(?:y|pero)\s+(?:por que|como|entonces|ahora|si|de donde|que sigue)\b/i.test(clean)
    || /\b(?:cual de las dos|cual de los dos)\b/i.test(clean)) {
    return true
  }

  // 4. Standalone variable reference: e.g. "b", "la b", "el vértice"
  if (/^(?:la |el )?(?:[bcxz]|a|y|vertice|discriminante|corte|raices?)$/i.test(clean)) {
    return true
  }

  // 5. Action verbs with enclitic pronouns:
  if (/\b(?:grafical[ao]|resuelvel[ao]|despejal[ao]|simplifical[ao]|compruebal[ao]|conviertel[ao]|pasal[ao]|hazl[ao]|explical[ao]|explicamel[ao]|muestral[ao]|ponl[ao]|damel[ao]|cambial[ao]|organizal[ao]|continua|continue|sigue)\b/i.test(clean)) {
    return true
  }

  // 6. Pedagogical variation:
  if (/\b(?:otr[ao]s?|parecid[ao]s?|similar(?:es)?|mas dificil(?:es)?|mas facil(?:es)?|mas complej[ao]s?|otra vez|de nuevo|repitelo|otra forma|otra manera|otro metodo)\b/i.test(clean)) {
    return true
  }

  // 7. Hint, advice, or beginning steps on active problem:
  if (/\b(?:pista|hint|primer paso|como empiezo|por donde empiezo|no se como empezar|me quede trabad[ao]|estoy trabad[ao])\b/i.test(clean)) {
    return true
  }

  return false
}

export function extractRequestedVariable(cleanUser: string): string | null {
  // If user asks about multiple variables or general coefficients, e.g. "a, b y c" or "coeficientes", don't extract a single variable
  if (/\b(?:a\s*,\s*b|a\s+y\s+b|a\s*,\s*b\s*,\s*c|coeficientes)\b/i.test(cleanUser)) return null

  const words = cleanUser.replace(/[¿?¡!.,;:()]/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
  const filtered = words.filter(w => !['y', 'pero', 'solo', 'solamente', 'ahora'].includes(w.toLowerCase()))
  const filteredStr = filtered.join(' ')

  const m1 = filteredStr.match(/\b(?:la|el|variable|coeficiente|termino|valor de)\s+([a-zA-Z])\b/i)
  if (m1) return m1[1].toLowerCase()

  const m2 = filteredStr.match(/\b(?:vale|valia|era|es|dime)\s+(?:la|el)?\s*([a-zA-Z])\b/i)
  if (m2) return m2[1].toLowerCase()

  if (filtered.length === 1 && /^[a-zA-Z]$/i.test(filtered[0])) return filtered[0].toLowerCase()

  const m3 = filteredStr.match(/\b([a-zA-Z])(?:\s+(?:ahi|alli|aqui|en esa|en la anterior))?$/i)
  if (m3 && filteredStr.length <= 30) return m3[1].toLowerCase()

  return null
}

export function extractVariableValue(varName: string, answer: string): string | null {
  const m1 = answer.match(new RegExp(`\\b${varName}\\s*=\\s*(-?\\d+(?:[.,]\\d+)?(?:\\/[\\d]+)?)`, 'i'))
  if (m1) return `${varName} = ${m1[1]}`

  const m2 = answer.match(new RegExp(`(?:\\b${varName}\\s*(?:es|vale|equivale a|igual a)|valor de\\s+${varName}\\s*es)\\s*(-?\\d+(?:[.,]\\d+)?)`, 'i'))
  if (m2) return `${varName} = ${m2[1]}`

  return null
}

export function extractNamedConcept(answer: string): { entity: string; referent: string } | null {
  const hist = answer.match(/(?:la|el)\s+(causa principal|detonante|consecuencia principal)\s+(?:fue|es)\s+([^.,\n]+)/i)
  if (hist) return { entity: hist[1].toLowerCase(), referent: `${hist[1]}: ${hist[2].trim()}` }

  const chem = answer.match(/(?:el|la)\s+(reactivo limitante|producto principal|catalizador)\s+(?:es|fue)\s+([^.,\n]+)/i)
  if (chem) return { entity: chem[1].toLowerCase(), referent: `${chem[1]}: ${chem[2].trim()}` }

  const lang = answer.match(/(?:el|la)\s+(error|fallo|correcci[oó]n)\s+(?:est[aá] en|es|consiste en)\s+([^.\n]+)/i)
  if (lang) {
    const raw = lang[2].trim()
    const quoted = raw.match(/[«"'].+?[»"']/)
    const target = quoted ? quoted[0] : raw.split(/ porque | ya que | debido a /i)[0].trim()
    return { entity: lang[1].toLowerCase(), referent: `${lang[1]}: ${target}` }
  }

  const math = answer.match(/(?:el|la)\s+(v[eé]rtice|discriminante|pendiente)\s+(?:es|est[aá] en)\s+([^.,\n]+)/i)
  if (math) return { entity: math[1].toLowerCase(), referent: `${math[1]}: ${math[2].trim()}` }

  return null
}

export function applyPedagogicalTransition(params: {
  userMessage: string
  assistantAnswer: string
  previousContext?: ChatConversationContext | null
  explicitTransition?: PedagogicalTransition | null
  currentTurnId?: string
}): {
  contextUpdates: Partial<ChatConversationContext>
  pedagogicalState: PedagogicalState
} {
  const { userMessage, assistantAnswer, previousContext, explicitTransition, currentTurnId } = params
  const q = normalizeIntentText(userMessage)
  const clean = q.replace(/[¿?¡!.,;:()]/g, ' ').replace(/\s+/g, ' ').trim()

  const prevPed = previousContext?.pedagogicalState
  const prevAction = prevPed?.pedagogicalAction || (previousContext?.lastAssistantAction as PedagogicalAction) || 'answered'
  const prevRestriction = prevPed?.revelationRestriction || 'revealed'
  const prevTarget = prevPed?.targetObject || previousContext?.activeProblem || ''
  const prevHints = prevPed?.hintCount || 0

  // 1. Explicit new problem typed by user
  if (hasExplicitNewProblem(userMessage)) {
    const newEq = extractActiveProblem(userMessage) || userMessage.slice(0, 200).trim()
    const pedState: PedagogicalState = {
      version: 1,
      targetObject: newEq,
      originTurnId: currentTurnId,
      focusedEntity: newEq,
      lastReferent: newEq,
      pedagogicalAction: 'solve_exercise',
      revelationRestriction: 'revealed',
      hintCount: 0,
    }
    return {
      pedagogicalState: pedState,
      contextUpdates: {
        activeProblem: newEq,
        focusedEntity: newEq,
        lastReferent: newEq,
        lastAssistantAction: 'answered',
      },
    }
  }

  // 2. User asked for exercise / problem / variation
  const isVariationOrExercise = /\b(?:hazme|ponme|dame|genera|propon|plantea|crea|inventa|quiero|busco)\b.*\b(?:otr[ao]|un[ao]|ejercicio|problema|ecuacion|parecid[ao]|similar|mas dificil|mas facil|algo)\b/i.test(clean)
    || /\b(?:otro parecido|otra parecida|uno parecido|una parecida|algo parecido|mas dificil|mas facil|mas complej[ao])\b/i.test(clean)
    || /\b(?:sin resolver(?:la|lo)?|no la resuelvas|no lo resuelvas|para resolver(?:la|lo)? yo)\b/i.test(clean)
    || explicitTransition?.action === 'generated_exercise'

  if (isVariationOrExercise) {
    const generatedEq = explicitTransition?.targetObject || extractActiveProblem(assistantAnswer, prevTarget)
    if (generatedEq) {
      const pedState: PedagogicalState = {
        version: 1,
        targetObject: generatedEq,
        originTurnId: currentTurnId,
        focusedEntity: generatedEq,
        lastReferent: generatedEq,
        pedagogicalAction: 'generated_exercise',
        revelationRestriction: 'hidden',
        hintCount: 0,
      }
      return {
        pedagogicalState: pedState,
        contextUpdates: {
          activeProblem: generatedEq,
          focusedEntity: generatedEq,
          lastReferent: generatedEq,
          lastAssistantAction: 'generated_exercise',
        },
      }
    }
  }

  // 3. Hint requested
  const isExplicitHint = /\b(?:pista|hint|ayuda|como empiezo|por donde empiezo|primer paso)\b/i.test(clean)
    || explicitTransition?.action === 'hint'
  const isAnotherHint = (prevAction === 'hint' || prevRestriction === 'hidden')
    && /^(?:y\s+)?(?:otra|otra mas|siguiente|dame otra|otra pista)\b/i.test(clean)

  if (isExplicitHint || isAnotherHint) {
    const target = prevTarget || previousContext?.activeProblem || ''
    const pedState: PedagogicalState = {
      version: 1,
      targetObject: target,
      originTurnId: prevPed?.originTurnId,
      focusedEntity: target,
      lastReferent: target,
      pedagogicalAction: 'hint',
      revelationRestriction: 'hidden',
      hintCount: prevHints + 1,
    }
    return {
      pedagogicalState: pedState,
      contextUpdates: {
        activeProblem: target,
        focusedEntity: target,
        lastReferent: target,
        lastAssistantAction: 'hint',
      },
    }
  }

  // 4. Explicit solve requested
  const isExplicitSolve = /\b(?:resuelvel[ao]|ahora si resuelvel[ao]|muestrame la solucion|dame la solucion|como se resuelve|resuelve esa|resuelve este|resuelvelo)\b/i.test(clean)
    || explicitTransition?.action === 'solve_exercise'

  if (isExplicitSolve) {
    const target = prevTarget || previousContext?.activeProblem || ''
    const pedState: PedagogicalState = {
      version: 1,
      targetObject: target,
      originTurnId: prevPed?.originTurnId,
      focusedEntity: target,
      lastReferent: target,
      pedagogicalAction: 'solve_exercise',
      revelationRestriction: 'revealed',
      hintCount: prevHints,
    }
    return {
      pedagogicalState: pedState,
      contextUpdates: {
        activeProblem: target,
        focusedEntity: target,
        lastReferent: target,
        lastAssistantAction: 'answered',
      },
    }
  }

  // 5. Specific variable clarification (a, b, c, x, y, z)
  const requestedVar = extractRequestedVariable(userMessage)
  if (requestedVar) {
    const val = extractVariableValue(requestedVar, assistantAnswer)
    const target = prevTarget || previousContext?.activeProblem || ''
    const referent = val || previousContext?.lastReferent || requestedVar
    const pedState: PedagogicalState = {
      version: 1,
      targetObject: target,
      originTurnId: prevPed?.originTurnId,
      focusedEntity: requestedVar,
      lastReferent: referent,
      pedagogicalAction: 'clarification',
      revelationRestriction: prevRestriction,
      hintCount: prevHints,
    }
    return {
      pedagogicalState: pedState,
      contextUpdates: {
        activeProblem: target,
        focusedEntity: requestedVar,
        lastReferent: referent,
        lastAssistantAction: 'clarification',
      },
    }
  }

  // 6. Causal clarification on previous referent
  const isCausalOnPrevious = /\b(?:por que|de donde|como)\b/i.test(clean)
    && /\b(?:esa|ese|eso|positivo|positiva|negativo|negativa|sale|salio)\b/i.test(clean)
  if (isCausalOnPrevious && previousContext?.lastReferent) {
    const target = prevTarget || previousContext?.activeProblem || ''
    const entity = previousContext.focusedEntity || previousContext.lastReferent || target
    const referent = previousContext.lastReferent || target
    const pedState: PedagogicalState = {
      version: 1,
      targetObject: target,
      originTurnId: prevPed?.originTurnId,
      focusedEntity: entity,
      lastReferent: referent,
      pedagogicalAction: 'clarification',
      revelationRestriction: prevRestriction,
      hintCount: prevHints,
    }
    return {
      pedagogicalState: pedState,
      contextUpdates: {
        activeProblem: target,
        focusedEntity: entity,
        lastReferent: referent,
        lastAssistantAction: 'clarification',
      },
    }
  }

  // 7. Named concept in assistant answer
  const named = extractNamedConcept(assistantAnswer)
  if (named) {
    const target = prevTarget || previousContext?.activeProblem || ''
    const pedState: PedagogicalState = {
      version: 1,
      targetObject: target,
      originTurnId: prevPed?.originTurnId,
      focusedEntity: named.entity,
      lastReferent: named.referent,
      pedagogicalAction: 'clarification',
      revelationRestriction: prevRestriction,
      hintCount: prevHints,
    }
    return {
      pedagogicalState: pedState,
      contextUpdates: {
        activeProblem: target,
        focusedEntity: named.entity,
        lastReferent: named.referent,
        lastAssistantAction: 'clarification',
      },
    }
  }

  // 8. Default answered
  const target = prevTarget || previousContext?.activeProblem || ''
  const pedState: PedagogicalState = {
    version: 1,
    targetObject: target,
    originTurnId: prevPed?.originTurnId,
    focusedEntity: previousContext?.focusedEntity,
    lastReferent: previousContext?.lastReferent,
    pedagogicalAction: 'answered',
    revelationRestriction: prevRestriction,
    hintCount: prevHints,
  }
  return {
    pedagogicalState: pedState,
    contextUpdates: {
      activeProblem: target || undefined,
      focusedEntity: previousContext?.focusedEntity,
      lastReferent: previousContext?.lastReferent,
      lastAssistantAction: 'answered',
    },
  }
}

export function extractSemanticFocusFromTurn(params: {
  userMessage: string
  assistantAnswer: string
  previousContext?: ChatConversationContext | null
  explicitTransition?: PedagogicalTransition | null
  currentTurnId?: string
}): {
  activeProblem?: string
  focusedEntity?: string
  lastReferent?: string
  lastAssistantAction?: 'answered' | 'generated_exercise' | 'clarification' | 'hint'
  pedagogicalState?: PedagogicalState
} {
  const { contextUpdates, pedagogicalState } = applyPedagogicalTransition(params)
  return {
    activeProblem: contextUpdates.activeProblem,
    focusedEntity: contextUpdates.focusedEntity,
    lastReferent: contextUpdates.lastReferent,
    lastAssistantAction: contextUpdates.lastAssistantAction,
    pedagogicalState,
  }
}

export function resolveConversation(message: string, previous: ChatConversationContext | null): {
  intent: ChatIntent; context: ChatConversationContext; retrievalQuery: string
} {
  const isNewProblem = hasExplicitNewProblem(message)
  const intent = detectChatIntent(message)
  const isContinuation = !isNewProblem && (intent.followup || isContextualContinuation(message, previous))
  const inherits = isContinuation && Boolean(previous)
  const extractedNewEq = isNewProblem ? extractActiveProblem(message) : null
  const sourcePolicy = intent.explicitPolicy
    || (inherits ? previous?.sourcePolicy : undefined)
    || 'MIXED'
  const subject = inherits ? previous!.subject : message.slice(0, CHAT_LIMITS.subjectChars)
  const operation = intent.shape === 'prose' && inherits && !nonInheritedShapes.has(previous!.operation)
    ? previous!.operation
    : intent.shape

  let activeProblem: string | undefined = inherits ? (previous?.pedagogicalState?.targetObject || previous?.activeProblem) : undefined
  if (!activeProblem || isNewProblem) {
    const extractedEq = extractedNewEq || extractActiveProblem(message)
    if (extractedEq) {
      activeProblem = extractedEq
    } else if (!inherits) {
      activeProblem = message.slice(0, 200).trim()
    }
  }

  const workingMemory = inherits ? previous?.workingMemory : undefined

  let focusedEntity: string | undefined = inherits ? (previous?.pedagogicalState?.focusedEntity || previous?.focusedEntity) : undefined
  let lastReferent: string | undefined = inherits ? (previous?.pedagogicalState?.lastReferent || previous?.lastReferent) : undefined
  let lastAssistantAction = inherits ? (previous?.pedagogicalState?.pedagogicalAction as any || previous?.lastAssistantAction) : undefined
  let pedagogicalState = inherits ? previous?.pedagogicalState : undefined

  if (inherits) {
    const requestedVar = extractRequestedVariable(message)
    if (requestedVar) {
      focusedEntity = requestedVar
      const knownVal = previous?.workingMemory ? extractVariableValue(requestedVar, previous.workingMemory) : null
      if (knownVal) {
        lastReferent = knownVal
      }
    } else {
      const hasDeictic = /\b(?:eso|esa|ese|este|esta|aquel|aquella|el valor|este valor|ese valor|ese coeficiente|esa variable)\b/i.test(message)
      if (hasDeictic && lastReferent) {
        focusedEntity = focusedEntity || lastReferent
      }
    }
    if (pedagogicalState) {
      pedagogicalState = {
        ...pedagogicalState,
        ...(focusedEntity ? { focusedEntity } : {}),
        ...(lastReferent ? { lastReferent } : {}),
      }
    }
  }

  const context: ChatConversationContext = {
    version: 1, subject, operation, sourcePolicy,
    usedTargetIds: inherits && sourcePolicy !== 'GENERAL_ONLY' ? previous!.usedTargetIds : [],
    usedRelationIds: inherits && sourcePolicy !== 'GENERAL_ONLY' ? previous!.usedRelationIds : [],
    ...(intent.requestedCount || (inherits && previous?.requestedCount) ? { requestedCount: intent.requestedCount || previous!.requestedCount } : {}),
    ...(intent.ordinal ? { ordinal: intent.ordinal } : {}),
    ...(activeProblem ? { activeProblem } : {}),
    ...(workingMemory ? { workingMemory } : {}),
    ...(focusedEntity ? { focusedEntity } : {}),
    ...(lastReferent ? { lastReferent } : {}),
    ...(lastAssistantAction ? { lastAssistantAction } : {}),
    ...(pedagogicalState ? { pedagogicalState } : {}),
  }
  // A new comparison target remains in the query alongside the inherited subject.
  const queryBase = (inherits && activeProblem && !subject.includes(activeProblem))
    ? `${subject}\n${activeProblem}`
    : subject
  const retrievalQuery = (inherits ? `${queryBase}\n${message.slice(0, CHAT_LIMITS.subjectChars)}` : message).slice(0, CHAT_LIMITS.queryChars)
  return { intent: { ...intent, followup: isContinuation, shape: operation }, context, retrievalQuery }
}
