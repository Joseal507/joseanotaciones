import type { ResolvedSourceMaterial } from '../../lib/materialBrain/types'

// ============================================================
// Fixtures sintéticos para el harness de Material Brain — Fase 1.
//
// No son reproducciones byte-exactas de los documentos reales que
// motivaron la auditoría original (esos logs vinieron de uso real
// de producción, no de archivos del repo — se verificó que no
// existen en scripts/tests/fixtures/). Son fixtures representativos
// del mismo perfil: Falcons = narrativo corto y poco denso; Ácidos/
// Bases = técnico, denso, con fórmulas/procesos/conocimiento
// repetido entre páginas — construidos para ejercitar exactamente
// los mecanismos que el encargo pide validar (identity/merge,
// coverage por material+página, fórmulas, procesos, conflicto).
// ============================================================

export const FALCONS_MATERIAL: ResolvedSourceMaterial = {
  materialId: 'mat_falcons',
  nombre: 'Historia de los Atlanta Falcons',
  kind: 'pdf',
  knownPages: [1, 2],
  text: `[Pagina 1]
Los Atlanta Falcons son un equipo de fútbol americano fundado en 1965 como la decimoquinta franquicia de la NFL. Desde su primer partido, el equipo adoptó al halcón como símbolo de velocidad y resiliencia, dos cualidades que la afición de Atlanta terminaría abrazando como parte de su identidad.

Durante sus primeras dos décadas, los Falcons tuvieron temporadas irregulares, pero construyeron una base de aficionados leales que veían en el equipo un reflejo de la propia ciudad de Atlanta: una ciudad que se reconstruyó después de ser devastada durante la Guerra Civil y que convirtió esa reconstrucción en parte de su orgullo cultural. Esa conexión entre la historia de la ciudad y la pasión por el equipo es, para muchos aficionados, el verdadero corazón de lo que significa ser fanático de los Falcons.

El Mercedes-Benz Stadium, inaugurado en 2017, se convirtió en la nueva casa del equipo y en un símbolo de la ambición de Atlanta por tener infraestructura deportiva de clase mundial, con un techo retráctil inspirado en el diseño de un halcón en pleno vuelo.

[Pagina 2]
El momento más doloroso en la historia reciente del equipo llegó en el Super Bowl LI, disputado en febrero de 2017, cuando los Falcons llegaron a tener una ventaja de 28 a 3 sobre los New England Patriots antes de sufrir la mayor remontada en la historia de los Super Bowls, cayendo finalmente 34 a 28 en tiempo extra.

Lejos de destruir a la afición, esa derrota terminó reforzando la identidad de resiliencia del equipo: los aficionados de los Falcons adoptaron la frase "28-3" como recordatorio de que el orgullo por el equipo no depende solamente de ganar campeonatos, sino de la pasión sostenida a través de las decepciones.

Hoy, la cultura de la afición de los Falcons combina ese sentido de resiliencia con un fuerte orgullo cultural por Atlanta como ciudad, y el impacto del equipo se extiende más allá del deporte hacia la identidad misma de la comunidad que representa.`,
}

export const ACIDS_BASES_MATERIAL: ResolvedSourceMaterial = {
  materialId: 'mat_acidos_bases',
  nombre: 'Ácidos y Bases',
  kind: 'pdf',
  knownPages: [1, 2, 3, 4, 5],
  text: `[Pagina 1]
**Teoría de Arrhenius**
Según la teoría de Arrhenius, un ácido es una sustancia que al disolverse en agua libera iones hidrógeno (H+), aumentando la concentración de H+ en la solución. Una base de Arrhenius, en cambio, es una sustancia que al disolverse en agua libera iones hidróxido (OH-), aumentando la concentración de OH- en la solución.

Esta definición tiene una limitación importante: solo aplica a reacciones que ocurren en disolución acuosa, por lo que no puede explicar el comportamiento ácido-base de sustancias en ausencia de agua.

[Pagina 2]
**Teoría de Brønsted-Lowry**
La teoría de Brønsted-Lowry generaliza la definición anterior: un ácido de Brønsted-Lowry es cualquier sustancia capaz de donar un protón (H+) a otra sustancia, mientras que una base de Brønsted-Lowry es cualquier sustancia capaz de aceptar ese protón. A diferencia de la definición de Arrhenius, esta teoría no requiere que la reacción ocurra en agua.

Por ejemplo, en la reacción entre amoníaco (NH3) y agua, el agua actúa como ácido de Brønsted-Lowry porque dona un protón al amoníaco, y el amoníaco actúa como base de Brønsted-Lowry porque acepta ese protón.

[Pagina 3]
**Autoionización del agua**
El agua pura sufre un proceso de autoionización en el que una pequeña fracción de moléculas de H2O reacciona entre sí: una molécula dona un protón y otra lo acepta, produciendo un ion hidronio (H3O+) y un ion hidróxido (OH-). Este equilibrio de autoionización del H2O se describe mediante la constante del producto iónico del agua, Kw.

A 25°C, el valor de Kw es 1.0 × 10^-14, y esto significa que en agua pura la concentración de H+ es igual a la concentración de OH-, ambas iguales a 1.0 × 10^-7 M.

[Pagina 4]
**pH y pOH**
El pH de una solución se define como el logaritmo negativo en base 10 de la concentración de iones H+: pH = -log[H+]. De manera análoga, el pOH se define como pOH = -log[OH-]. Dado que Kw = [H+][OH-] = 1.0 × 10^-14, se cumple siempre que pH + pOH = 14 a 25°C.

Procedimiento para calcular el pH de una solución de concentración conocida:
Paso 1: Determinar la concentración molar de H+ en la solución.
Paso 2: Aplicar la fórmula pH = -log[H+].
Paso 3: Verificar que el resultado sea coherente con el rango de pH de 0 a 14.
Paso 4: Si se conoce el pOH en lugar del pH, usar pH = 14 - pOH.

[Pagina 5]
**Ácidos fuertes, bases fuertes y las constantes Ka/Kb**
Un ácido fuerte es aquel que se disocia completamente en agua, como el ácido clorhídrico (HCl). Una base fuerte es aquella que se disocia completamente en agua, como el hidróxido de sodio (NaOH). Para ácidos y bases débiles, que solo se disocian parcialmente, se usan las constantes de equilibrio Ka (constante de disociación ácida) y Kb (constante de disociación básica) para describir cuánto se disocia la sustancia.

Cabe recordar que, según la teoría de Brønsted-Lowry, un ácido dona protones y una base los acepta — esta misma idea de donar y aceptar protones es la que permite explicar por qué los ácidos y bases débiles no se disocian por completo: el equilibrio entre la forma disociada y la no disociada depende de qué tan fuerte sea la tendencia de la sustancia a donar o aceptar ese protón.`,
}

// ------------------------------------------------------------
// CASE C — multi-material: concepto compartido + exclusivos +
// páginas coincidentes (page 2 de A != page 2 de B).
// ------------------------------------------------------------
export const MULTI_MATERIAL_A: ResolvedSourceMaterial = {
  materialId: 'mat_multi_a',
  nombre: 'Fundamentos de electricidad — Curso A',
  kind: 'pdf',
  knownPages: [1, 2],
  text: `[Pagina 1]
La ley de Ohm establece que la corriente eléctrica que circula por un conductor es directamente proporcional a la diferencia de potencial aplicada, según la fórmula V = I × R, donde V es el voltaje en voltios, I es la corriente en amperios y R es la resistencia en ohmios.

[Pagina 2]
Un circuito en serie es aquel en el que los componentes están conectados uno tras otro, de modo que la misma corriente circula por todos ellos. La resistencia total de un circuito en serie es la suma de las resistencias individuales.`,
}

export const MULTI_MATERIAL_B: ResolvedSourceMaterial = {
  materialId: 'mat_multi_b',
  nombre: 'Fundamentos de electricidad — Curso B',
  kind: 'pdf',
  knownPages: [1, 2],
  text: `[Pagina 1]
Según la ley de Ohm, el voltaje entre los extremos de un conductor es igual al producto de la corriente que lo atraviesa por su resistencia (V = I·R). Esta relación es una de las más fundamentales en el análisis de circuitos eléctricos.

[Pagina 2]
Un circuito en paralelo es aquel en el que los componentes comparten los mismos dos nodos, de modo que el voltaje es el mismo en cada rama, pero la corriente total se reparte entre ellas según la resistencia de cada rama.`,
}

// ------------------------------------------------------------
// CASE D — conflicto: mismo sujeto (punto de ebullición del agua)
// pero calificadores DISTINTOS y NO equivalentes (nivel del mar vs.
// altitud). El merge conservador no debe fusionarlos.
// ------------------------------------------------------------
export const CONFLICT_MATERIAL_A: ResolvedSourceMaterial = {
  materialId: 'mat_conflict_a',
  nombre: 'Geografía física — Nivel del mar',
  kind: 'pdf',
  knownPages: [1],
  text: `[Pagina 1]
A nivel del mar, el agua pura hierve a 100°C debido a que la presión atmosférica en ese punto es de 1 atmósfera, la presión de referencia estándar para la que se define el punto de ebullición del agua.`,
}

export const CONFLICT_MATERIAL_B: ResolvedSourceMaterial = {
  materialId: 'mat_conflict_b',
  nombre: 'Geografía física — Gran altitud',
  kind: 'pdf',
  knownPages: [1],
  text: `[Pagina 1]
A 2000 metros de altitud sobre el nivel del mar, la presión atmosférica es menor que a nivel del mar, por lo que el agua hierve a aproximadamente 93°C en lugar de 100°C.`,
}

// ------------------------------------------------------------
// CASE E — fórmulas
// ------------------------------------------------------------
export const FORMULA_MATERIAL: ResolvedSourceMaterial = {
  materialId: 'mat_formula',
  nombre: 'Segunda ley de Newton',
  kind: 'pdf',
  knownPages: [1],
  text: `[Pagina 1]
La segunda ley de Newton establece que la fuerza neta aplicada sobre un objeto es igual al producto de su masa por la aceleración que experimenta: F = m·a, donde F es la fuerza en newtons, m es la masa en kilogramos y a es la aceleración en metros por segundo al cuadrado.

Por ejemplo, un objeto de 2 kg que experimenta una aceleración de 3 m/s² recibe una fuerza neta de 6 newtons, aplicando directamente la fórmula F = m·a.`,
}

// ------------------------------------------------------------
// CASE F — proceso (los pasos deben permanecer agrupados en UNA
// sola unidad 'process', nunca fragmentados en unidades separadas).
// ------------------------------------------------------------
export const PROCESS_MATERIAL: ResolvedSourceMaterial = {
  materialId: 'mat_process',
  nombre: 'Preparación de una solución diluida',
  kind: 'pdf',
  knownPages: [1],
  text: `[Pagina 1]
Procedimiento para preparar una solución diluida a partir de una solución madre concentrada:
Paso 1: Calcular el volumen de solución madre necesario usando la fórmula de dilución C1V1 = C2V2.
Paso 2: Medir ese volumen de solución madre con una pipeta calibrada.
Paso 3: Transferir el volumen medido a un matraz aforado limpio.
Paso 4: Agregar agua destilada hasta alcanzar el volumen final marcado en el matraz.
Paso 5: Mezclar la solución invirtiendo el matraz varias veces para homogeneizarla.`,
}

// ------------------------------------------------------------
// CASE I — Colisión de identidad con calificadores en conflicto
// Dos materiales presentan el mismo término canónico exacto ("Resonancia")
// en dos disciplinas diferentes (física mecánica vs. química orgánica),
// de modo que el LLM genera el mismo canonicalSubject ("Resonancia"),
// pero con calificadores disjuntos ("física mecánica" vs "química orgánica").
// ------------------------------------------------------------
export const RESONANCE_PHYSICS_MATERIAL: ResolvedSourceMaterial = {
  materialId: 'mat_resonance_physics',
  nombre: 'Física Clásica — Oscilaciones y Resonancia',
  kind: 'pdf',
  knownPages: [1],
  text: `[Pagina 1]
**Resonancia**
En física mecánica y acústica, la resonancia es el fenómeno físico que se produce cuando un sistema oscilatorio es excitado por una fuerza periódica externa cuya frecuencia coincide con una de las frecuencias naturales de oscilación del sistema. En condiciones de resonancia mecánica, la amplitud de oscilación del sistema alcanza su valor máximo posible.

Un ejemplo clásico de resonancia mecánica es la vibración destructiva de puentes o estructuras cuando el viento o el paso sincronizado de tropas excita su frecuencia natural de oscilación.`,
}

export const RESONANCE_CHEMISTRY_MATERIAL: ResolvedSourceMaterial = {
  materialId: 'mat_resonance_chemistry',
  nombre: 'Química Orgánica — Estructuras y Resonancia',
  kind: 'pdf',
  knownPages: [1],
  text: `[Pagina 1]
**Resonancia**
En química orgánica y estructural, la resonancia es el modelo teórico que describe la deslocalización de electrones pi o electrones no enlazantes en moléculas que no pueden representarse adecuadamente mediante una única estructura de Lewis. En la resonancia química, la molécula real es un híbrido de resonancia entre varias estructuras contribuyentes.

Un ejemplo clásico de resonancia química es la molécula de benceno (C6H6), donde los seis enlaces carbono-carbono tienen longitudes intermedias idénticas debido a la deslocalización electrónica del anillo aromático.`,
}

// ------------------------------------------------------------
// Multi-material agresivo (4 materiales simultáneos)
// ------------------------------------------------------------
export const MULTI_EXPANDED_1_MECHANICS: ResolvedSourceMaterial = {
  materialId: 'mat_phys_mechanics',
  nombre: 'Física I — Mecánica Clásica',
  kind: 'pdf',
  knownPages: [1, 2],
  text: `[Pagina 1]
**Ley de Ohm**
La ley de Ohm establece que el voltaje entre los extremos de un conductor es directamente proporcional a la intensidad de corriente que circula por él, según la fórmula V = I·R, donde V es la diferencia de potencial, I es la corriente y R es la resistencia.

[Pagina 2]
El principio de conservación de la energía en mecánica establece que, en un sistema aislado donde solo actúan fuerzas conservativas, la energía mecánica total (cinética más potencial) permanece constante: no se crea ni se destruye, solo se transforma de una forma a otra.`,
}

export const MULTI_EXPANDED_2_THERMO: ResolvedSourceMaterial = {
  materialId: 'mat_phys_thermo',
  nombre: 'Física II — Termodinámica',
  kind: 'pdf',
  knownPages: [1, 2],
  text: `[Pagina 1]
**Ley de Ohm**
Según la ley de Ohm, la caída de tensión en un conductor óhmico es igual al producto de la corriente por la resistencia eléctrica del elemento (V = I·R). Esta relación fundamental vincula voltaje, corriente y resistencia.

[Pagina 2]
La primera ley de la termodinámica es una expresión del principio de conservación de la energía: la energía total de un sistema aislado permanece constante, aunque puede transformarse entre calor, trabajo y energía interna.`,
}

export const MULTI_EXPANDED_3_ELECTRO: ResolvedSourceMaterial = {
  materialId: 'mat_phys_electro',
  nombre: 'Física III — Electromagnetismo',
  kind: 'pdf',
  knownPages: [1, 2],
  text: `[Pagina 1]
La ley de Coulomb cuantifica la fuerza electrostática entre dos cargas puntuales como directamente proporcional al producto de sus magnitudes e inversamente proporcional al cuadrado de la distancia que las separa: F = k·|q1·q2|/r^2.

[Pagina 2]
La ley de inducción electromagnética de Faraday establece que la fuerza electromotriz inducida en un circuito cerrado es igual a la tasa de variación temporal negativa del flujo magnético a través del circuito.`,
}

export const MULTI_EXPANDED_4_OPTICS: ResolvedSourceMaterial = {
  materialId: 'mat_phys_optics',
  nombre: 'Física IV — Óptica y Ondas',
  kind: 'pdf',
  knownPages: [1, 2],
  text: `[Pagina 1]
La ley de Snell de la refracción relaciona los ángulos de incidencia y refracción con los índices de refracción de los dos medios: n1·sin(theta1) = n2·sin(theta2).

[Pagina 2]
El fenómeno de reflexión interna total ocurre cuando un rayo de luz viaja de un medio con mayor índice de refracción hacia otro de menor índice y el ángulo de incidencia supera el ángulo crítico.`,
}

// ------------------------------------------------------------
// Generador sintético a gran escala (40-60 páginas) para Task D
// ------------------------------------------------------------
import type { PageChunk } from '../../lib/materialBrain/types'
import type { ChunkExtractionResult, RawExtractedUnit, RawExtractedRelation } from '../../lib/materialBrain/extraction'

export function generateLargeScaleSyntheticExtractions(pageCount: number = 60): {
  chunk: PageChunk
  extraction: ChunkExtractionResult
}[] {
  const CORE_SUBJECTS = [
    { subject: 'Conservacion de energia', kind: 'concept' as const, statement: 'La energía total en un sistema cerrado permanece constante y se transforma entre diferentes modalidades.' },
    { subject: 'Segunda ley de newton', kind: 'formula' as const, statement: 'La fuerza resultante sobre un cuerpo es proporcional a la masa y a la aceleración producida: F = m a.' },
    { subject: 'Ley de ohm', kind: 'formula' as const, statement: 'La diferencia de potencial eléctrico es directamente proporcional a la corriente y resistencia: V = I R.' },
    { subject: 'Entropia termodinamica', kind: 'concept' as const, statement: 'Medida del grado de desorden molecular y de la energía no disponible para realizar trabajo útil.' },
    { subject: 'Resonancia armonica', kind: 'concept' as const, statement: 'Aumento significativo de la amplitud cuando la frecuencia impulsora iguala la frecuencia natural.' },
    { subject: 'Efecto fotoelectrico', kind: 'concept' as const, statement: 'Emisión de electrones por un material cuando incide sobre él radiación electromagnética de frecuencia suficiente.' },
    { subject: 'Principio de incertidumbre', kind: 'concept' as const, statement: 'Es imposible determinar simultáneamente y con precisión arbitraria la posición y el momento lineal.' },
    { subject: 'Difraccion de ondas', kind: 'concept' as const, statement: 'Fenómeno por el cual una onda se desvía al encontrar un obstáculo o atravesar una rendija.' },
  ]

  const QUALIFIERS_POOL = [
    ['clasica'], ['relativista'], ['cuantica'], ['experimental'],
    ['teorica'], ['mecanica'], ['electromagnetica'], ['optica'],
  ]

  const results: { chunk: PageChunk; extraction: ChunkExtractionResult }[] = []

  for (let page = 1; page <= pageCount; page++) {
    const chunkId = `synth_chunk_${page}`
    const materialId = `mat_synth_${Math.floor((page - 1) / 15) + 1}` // 4 materiales sintéticos
    const chunkText = `[Pagina ${page}]\nTexto sintético de la página ${page} del material ${materialId} para prueba de rendimiento de merge.`

    const chunk: PageChunk = {
      id: chunkId,
      materialId,
      pages: [page],
      order: page,
      text: chunkText,
    }

    const units: RawExtractedUnit[] = []
    const relations: RawExtractedRelation[] = []

    // 8-10 unidades por página, reutilizando CORE_SUBJECTS con distintas variantes
    for (let u = 0; u < CORE_SUBJECTS.length; u++) {
      const core = CORE_SUBJECTS[u]
      const qualifierIndex = (page + u) % QUALIFIERS_POOL.length
      const qualifiers = (page % 3 === 0) ? QUALIFIERS_POOL[qualifierIndex] : []
      const quote = `Texto sintético de la página ${page}`

      units.push({
        kind: core.kind,
        canonicalSubject: core.subject,
        qualifiers,
        label: `${core.subject} (p.${page})`,
        statement: `${core.statement} Evidencia de la página ${page}.`,
        quote,
        page,
        domainTags: ['fisica', 'sintetico'],
        modelSuggestedTier: (u % 3 === 0 ? 'critical' : 'supporting'),
      })
    }

    // 2 relaciones por página
    if (units.length >= 2) {
      relations.push({
        type: 'depends_on',
        fromSubject: units[1].canonicalSubject,
        toSubject: units[0].canonicalSubject,
        statement: `La ${units[1].canonicalSubject} depende de ${units[0].canonicalSubject}`,
        quote: `Texto sintético de la página ${page}`,
        page,
      })
      relations.push({
        type: 'causes',
        fromSubject: units[4].canonicalSubject,
        toSubject: units[3].canonicalSubject,
        statement: `El fenómeno ${units[4].canonicalSubject} influye en ${units[3].canonicalSubject}`,
        quote: `Texto sintético de la página ${page}`,
        page,
      })
    }

    results.push({
      chunk,
      extraction: {
        units,
        relations,
        warnings: [],
        droppedInvalidProvenance: 0,
        droppedStructural: 0,
      },
    })
  }

  return results
}

