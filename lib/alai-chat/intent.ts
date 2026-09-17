import type { ChatIntent, ResponseShape, SourcePolicy } from './contracts'

export const normalizeIntentText = (text: string): string => text.normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

export function detectStrictMaterialOnly(message: string): boolean {
  const q = normalizeIntentText(message)
  if (/\b(?:no (?:uses?|utilices?|agregues?|incluyas?) (?:el )?(?:conocimiento general|informacion externa)|sin (?:usar )?(?:conocimiento general|informacion externa)|no general knowledge)\b/.test(q)) return true
  if (/\b(?:solo|unicamente|exclusivamente|solamente)\s+(?:usa|uses|utiliza|utilices|segun|desde|con|en el|en mi)?\s*(?:mi|el|tu)?\s*(?:material|pdf|documento)\b/.test(q)) return true
  if (/\b(?:usa|uses|utiliza|utilices|responde|respondeme)\s+(?:solo|unicamente|exclusivamente|solamente)\s+(?:segun|con|desde|usando)?\s*(?:mi|el|tu)?\s*(?:material|pdf|documento)\b/.test(q)) return true
  if (/\b(?:material only|only (?:my |the )?(?:material|pdf))\b/.test(q)) return true
  return false
}

export function detectSourcePolicy(message: string): SourcePolicy | undefined {
  const q = normalizeIntentText(message)
  if (detectStrictMaterialOnly(message)) return 'MATERIAL_ONLY'
  if (/\b(?:solo (?:usa |utiliza )?(?:conocimiento general|informacion externa)|(?:usa|utiliza) solo (?:conocimiento general|informacion externa)|sin (?:usar )?(?:mi |el )?material|ignora (?:mi |el )?material|general only|only general knowledge)\b/.test(q)) return 'GENERAL_ONLY'
  if (/\b(?:conocimiento general|informacion externa|contexto general|general knowledge)\b/.test(q)
    && /\b(?:usa|usar|agrega|anade|tambien|puedes|incluye|use|add|include)\b/.test(q)) return 'MIXED'
  if (/aunque no este en (?:el |mi )?material/.test(q)) return 'MIXED'
  return undefined
}

const NUMBERS: Record<string, number> = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const TIMELINE_FORMAT = /\b(?:timeline|cronologia|linea (?:del |de )?tiempo|secuencia historica|(?:ordena|enumera) (?:las )?fechas)\b/
export function detectChatIntent(message: string): ChatIntent {
  const q = normalizeIntentText(message)
  let shape: ResponseShape = 'prose'
  if (/\b(?:en un parrafo|en un solo parrafo|en prosa|en texto|texto corrido|sin tabla)\b/.test(q)) shape = /\b(?:corto|breve|resumelo|brevemente|un solo parrafo)\b/.test(q) ? 'concise_prose' : 'prose'
  else if (/\b(?:tabla|table|compara|comparalo|comparala|compare|contrasta)\b/.test(q)) shape = 'comparison_table'
  else if (/\b(?:grafica|grafico|graficame|graficalo|graficala|graph|plot|chart)\b/.test(q)) shape = 'graph'
  else if (TIMELINE_FORMAT.test(q)) shape = 'timeline'
  else if (/\b(?:paso a paso|step by step|pasos numerados|cada paso)\b/.test(q)) shape = 'numbered_steps'
  else if (/\b(?:resuelve|resuelvel[ao]|resolver|soluciona|solve|calcula|calculal[ao]|calcular)\b/i.test(q) && (/[=+\-*/^]|\b(?:ecuacion|equation|problema|problem)\b/i.test(q) || /\b(?:resuelvel[ao]|calculal[ao])\b/i.test(q))) shape = 'worked_solution'
  else if (/\b(?:ponme|dame|haz|crea|inventa|genera)\s+(?:otr[ao]|un[ao])\s+(?:parecid[ao]|similar|mas dificil|mas facil|ejercicio|problema)\b/i.test(q) || /\b(?:otr[ao]|un[ao])\s+(?:parecid[ao]|similar|mas dificil|mas facil)\b/i.test(q)) shape = 'worked_solution'
  else if (/\b(?:ecuacion|formula|despeja|simplifica|factoriza|equation|formula|isolate|simplify|factor)\b/.test(q)) shape = 'equation_work'
  else if (/\b(?:define|definicion|definiciones|definition|definitions)\b/.test(q)) shape = 'definition_set'
  else if (/\b(?:mas corto|mas breve|resumelo|brevemente|shorter|concise)\b/.test(q)) shape = 'concise_prose'
  else if (/\b(?:mas profundo|mas profundidad|en profundidad|mas detalle|deeper)\b/.test(q)) shape = 'deep_explanation'
  else if (/\b(?:lista|enumera|list|bullets|vinetas)\b/.test(q)) shape = 'bullet_list'
  const countMatch = q.match(/\b(\d{1,2}|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:conceptos|ejercicios|concepts|exercises|componentes|ejemplos|razones|puntos|elementos|items|pasos|diferencias|causas|efectos|caracteristicas|examples|reasons|items|steps)\b/)
  const count = countMatch ? Number(countMatch[1]) || NUMBERS[countMatch[1]] : undefined
  const isProperNounOrdinal = /\b(?:el|la)\s+(?:primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta)\s+(?:guerra|revolucion|ley|ministro|orden mundial|generacion|republica|imperio|cruzada|concilio|potencia)\b/i.test(q)
  const ordinalMatch = !isProperNounOrdinal ? q.match(/\b(?:el|la) (primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta|\d{1,2})\b/) : null
  const ordinalMap: Record<string, number> = { primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5 }
  const ordinal = ordinalMatch ? Number(ordinalMatch[1]) || ordinalMap[ordinalMatch[1]] : undefined
  const explicitPolicy = detectSourcePolicy(message)
  const clean = q.replace(/[¿?¡!.,;:()]/g, ' ').replace(/\s+/g, ' ').trim()
  const cleanWords = clean.split(' ').filter(Boolean)

  // A format-only chronology or a reference to the current data keeps its topic.
  // "a base de los ..." is an anaphoric reference even with a misspelled noun;
  // anchor the entire suffix so an explicit new topic is not borrowed from history.
  const [timelineInstruction, timelineSuffix] = clean.split(TIMELINE_FORMAT)
  const timelineReference = timelineSuffix?.trim()
  const isTimelineTransformation = shape === 'timeline' && timelineReference !== undefined
    && /^(?:(?:ahora|hazme|haz|dame|crea|genera|prepara|quiero|un|una|la|en|por favor)\s+)*$/.test(timelineInstruction) && (
    timelineReference === ''
    || /^(?:a (?:base|partir) de|basad[ao] en) (?:los|las|estos|estas|esos|esas) \p{L}+$/u.test(timelineReference)
    || /^(?:con|usando|de|del|sobre) (?:(?:los|las|el|la|estos|estas|esos|esas|mi) )?(?:datos|informacion|contexto|material|fechas|tema)(?: (?:actual|anterior|anteriores))?$/.test(timelineReference)
  )

  const isSingleVariableOrEntity = /^(?:que|cual)\s+(?:es|significa|representa|seria)\s+(?:el|la|los|las)?\s*([a-z]|[a-z0-9_-]{1,3})$/i.test(clean)
    || /^(?:que|cual)\s+(?:es|significa|representa)\s+(?:el|la)?\s*(?:vertice|discriminante|pendiente|raices|soluciones|eje|signo|termino|coeficiente)\b/i.test(clean)
    || /^(?:solo\s+)?(?:dime|da|muestra|indica|calcula|halla|encuentra|cual\s+(?:era|es|vale)|cuanto\s+(?:era|es|valia|vale)|que\s+(?:es|era|vale))\s+(?:la|el|los|las|de\s+la|del|de)?\s*([a-z]|[a-z0-9_-]{1,3})$/i.test(clean)
    || /^(?:solo\s+)?(?:la\s+|el\s+)?([a-z]|[a-z0-9_-]{1,3})$/i.test(clean)

  const isHintOrAssistance = /\b(?:pista|pistas|hint|hints|clave|primer paso|siguiente paso|por donde empiezo|como empiezo|que hago primero|ayudame a empezar|no se como empezar)\b/i.test(clean)

  const isEllipticalQuery = /^(?:y|pero)\s+(?:la|el|los|las|si|entonces|ahora|despues|que sigue|cual|como|por que|de donde)\b/i.test(clean)
    || /^(?:y|pero)\s+(?:la\s+|el\s+)?([a-z]|[a-z0-9_-]{1,3}|vertice|discriminante|pendiente|raices|soluciones|eje|signo|termino|coeficiente)$/i.test(clean)

  const isCausalInquiry = (
    clean.startsWith('por que') || clean.startsWith('y por que') || clean.startsWith('pero por que')
    || /\b(?:de donde (?:sale|salio|vino|sacaste|obtuviste)|como (?:hiciste|obtuviste|sacaste|se llega|llegaste))\b/i.test(clean)
  ) && (
    cleanWords.length <= 3
    || /\b(?:ese|esa|eso|esto|aquel|aquella|aquello|aqui|ahi|alli|anterior)\b/i.test(clean)
    || /\b(?:paso|formula|ecuacion|valor|signo|numero|resultado|raiz|raices|vertice|menos|mas|negativ[ao]|positiv[ao]|cero|variable|termino|coeficiente)\b/i.test(clean)
    || /\b(?:hiciste|pusiste|dio|da|sale|salio|quedo|queda|sacaste|elegiste|tomaste|usaste)\b/i.test(clean)
  )

  const hasDeicticReference = /\b(?:eso|esa|ese|este|esta|estos|estas|aquel|aquella|aquello)\b/i.test(clean)
    && (
      /\b(?:no lo entendi|no entendi|no me quedo claro|explica(?:cion|ciones)?|aclara|grafica|resuelve|formula|paso|valor|resultado|parte|punto|ecuacion|signo|termino|respuesta|texto|parrafo|definicion|ejemplo)\b/i.test(clean)
      || cleanWords.length <= 4
    )

  const isVariationRequest = /\b(?:otr[ao]s?|parecid[ao]s?|similar(?:es)?|mas dificil(?:es)?|mas facil(?:es)?|mas complej[ao]s?|otra vez|de nuevo|repitelo|otra forma|otra manera|otro metodo|compruebal[ao])\b/i.test(clean)

  const hasEncliticVerb = /\b(?:grafical[ao]|resuelvel[ao]|despejal[ao]|simplifical[ao]|compruebal[ao]|conviertel[ao]|pasal[ao]|hazl[ao]|explical[ao]|explicamel[ao]|muestral[ao]|ponl[ao]|damel[ao]|cambial[ao]|organizal[ao]|continua|continue|sigue)\b/i.test(clean)

  const isExplicitFollowupPhrase = /\b(?:falta uno|falta una|corrige eso|de donde sale|cuentame mas|relacionalo|relaciona eso|ahora en tabla|ponlo en tabla|en tabla|ahora comparalo|ahora dime el vertice|ahora dime las intersecciones|cual de las dos)\b/.test(q)

  const isPolicyModifier = Boolean(explicitPolicy && /^(?:ahora |tambien )?(?:solo |no )?(?:usa|uses|utiliza|agrega|anade|incluye|puedes|sin|segun|aunque)\b/.test(q)
    && cleanWords.length <= 36 && !/[:;]|\b(?:explica|describe|define|resuelve|dame|habla|dime)\b/.test(q))

  const isNewStandaloneTask = (
    /\b(?:resuelve|resolver|calcula|calcular)\b/i.test(clean)
    && /[0-9a-zA-Z]+\s*=\s*[0-9a-zA-Z]+/i.test(clean)
    && !/\b(?:de nuevo|otra vez|parecido|similar)\b/i.test(clean)
  ) || (
    /\b(?:corrige|corregir|analiza|analizar|traduce|traducir|revisa|revisar|clasifica|clasificar)\b/i.test(clean)
    && (/[«"'][^«"']{5,}[»"']/.test(message) || /:\s*.{10,}/.test(message))
  )

  const followup = !isNewStandaloneTask && (
    isSingleVariableOrEntity
    || isHintOrAssistance
    || isEllipticalQuery
    || isCausalInquiry
    || hasDeicticReference
    || isVariationRequest
    || hasEncliticVerb
    || Boolean(ordinal)
    || isExplicitFollowupPhrase
    || isPolicyModifier
    || isTimelineTransformation
  )
  return {
    shape, followup, explicitPolicy,
    ...(count && count <= 30 ? { requestedCount: count } : {}),
    ...(ordinal ? { ordinal } : {}),
    materialInspection: /\b(?:aparece|esta|hay|existe|dice|encuentra)\b/.test(q) && /\b(?:material|pdf|documento)\b/.test(q),
  }
}
