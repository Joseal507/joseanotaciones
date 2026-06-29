import { NextRequest, NextResponse } from 'next/server';
import { alai } from '../../../lib/alai';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function extractJson(text: string) {
  try {
    return JSON.parse(text.trim());
  } catch {}

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return null;
}

function cleanPages(value: any): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n > 0)
        .map((n: number) => Math.trunc(n))
    )
  ).sort((a, b) => a - b).slice(0, 12);
}

function cleanConfidence(value: any): 'alta' | 'media' | 'baja' {
  const v = String(value || '').toLowerCase().trim();
  if (v.includes('high') || v.includes('alta')) return 'alta';
  if (v.includes('low') || v.includes('baja')) return 'baja';
  return 'media';
}

function stripSourceLine(answer: string) {
  return String(answer || '')
    .replace(/\n?\s*📄\s*Fuente:[\s\S]*$/i, '')
    .replace(/\n?\s*Fuente:\s*[^\n]+$/i, '')
    .trim();
}

function containsOutsideMaterialMarker(text: string) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('no está directamente en el material') ||
    t.includes('no aparece en el material') ||
    t.includes('no se encuentra en el material') ||
    t.includes('not in the material') ||
    t.includes('outside the material')
  );
}


function normalizeAnswerSpacing(answer: string) {
  return String(answer || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s+/, '').replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wordTokens(text: string) {
  return String(text || '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function requestedWordCount(message: string): number | null {
  const m = String(message || '').toLowerCase().match(/\b(?:en|de)?\s*(\d{1,2})\s+palabras?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 30 ? n : null;
}

function importantWordsFromMaterial(materialText: string, target: number) {
  const stop = new Set([
    'el','la','los','las','un','una','unos','unas','de','del','a','en','y','o','que','con','por','para',
    'es','son','se','su','sus','como','más','mas','al','lo','le','les','tu','tus','mi','mis','este','esta',
    'estos','estas','este','ese','esa','material','documento','pdf','página','pagina','paginas','seleccionado',
    'the','and','or','of','to','in','is','are','this','that','with','from'
  ]);

  const freq = new Map<string, { word: string; count: number }>();

  for (const raw of wordTokens(materialText)) {
    const key = raw.toLowerCase();
    if (key.length < 4) continue;
    if (stop.has(key)) continue;
    if (/^\d+$/.test(key)) continue;
    if (/^(material|pagina|page|id)$/i.test(key)) continue;

    const prev = freq.get(key);
    freq.set(key, { word: prev?.word || raw, count: (prev?.count || 0) + 1 });
  }

  const picked = Array.from(freq.values())
    .sort((a, b) => b.count - a.count || b.word.length - a.word.length)
    .map((x) => x.word)
    .slice(0, target);

  while (picked.length < target) picked.push('clave');
  return picked.join(' ');
}

function enforceWordCount(answer: string, message: string, history: any[], materialText = '') {
  const target = requestedWordCount(message);
  if (!target) return answer;

  const msg = String(message || '').toLowerCase();
  const answerWords = wordTokens(answer);
  const asksMaterial = /\b(material|pdf|documento)\b/i.test(msg);
  const asksImportant = /importante|general|resumen|idea|tema/i.test(msg);
  const answerIsGreeting = /ya estoy listo/i.test(answer);

  if ((asksMaterial || asksImportant || answerIsGreeting) && materialText.trim()) {
    return importantWordsFromMaterial(materialText, target);
  }

  if (answerWords.length === target) return answerWords.join(' ');

  const meaningfulHistory = [...history].reverse().find((m: any) => {
    const c = String(m?.content || '').trim();
    if (!c) return false;
    if (/ya estoy listo para responder/i.test(c)) return false;
    if (c.length < 20) return false;
    return true;
  })?.content || answer;

  const contextWords = wordTokens(meaningfulHistory)
    .filter((w: string) => !/^(el|la|los|las|un|una|unos|unas|de|del|a|en|y|o|que|con|por|para|es|son)$/i.test(w));

  if (contextWords.length >= target) return contextWords.slice(0, target).join(' ');

  if (materialText.trim()) return importantWordsFromMaterial(materialText, target);

  const picked = answerWords.slice(0, target);
  while (picked.length < target) picked.push('clave');
  return picked.join(' ');
}

function requestedParagraphLines(message: string) {
  const t = String(message || '').toLowerCase();
  const p = t.match(/(\d{1,2})\s+p[aá]rrafos?/);
  const l = t.match(/(\d{1,2})\s+l[ií]neas?/);
  if (!p || !l) return null;
  const paragraphs = Number(p[1]);
  const lines = Number(l[1]);
  if (!Number.isFinite(paragraphs) || !Number.isFinite(lines)) return null;
  if (paragraphs <= 0 || lines <= 0 || paragraphs > 12 || lines > 12) return null;
  return { paragraphs, lines };
}

function enforceParagraphVisuals(answer: string, message: string) {
  const req = requestedParagraphLines(message);
  const clean = normalizeAnswerSpacing(answer);
  if (!req) return clean;

  const lines = clean
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === req.paragraphs * req.lines) {
    const blocks: string[] = [];
    for (let i = 0; i < req.paragraphs; i++) {
      blocks.push(lines.slice(i * req.lines, (i + 1) * req.lines).join('\n'));
    }
    return blocks.join('\n\n');
  }

  return clean
    .split('\n\n')
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

function fallbackOutsideAnswer(message: string) {
  const q = String(message || '').trim();

  return `Esta respuesta no está directamente en el material, pero te puedo responder igual:\n\nPuedo ayudarte con "${q}" usando conocimiento general, pero necesito formularlo con cuidado porque no aparece en el documento seleccionado.`;
}

function wantsNumberedList(message: string) {
  const q = String(message || '').toLowerCase();
  return (
    /\b\d{1,2}\s+(razones|puntos|cosas|items|elementos)\b/.test(q) ||
    q.includes('numeradas') ||
    q.includes('numerados') ||
    q.includes('lista numerada') ||
    q.includes('pasos')
  );
}

function fixBrokenNumberedList(answer: string, message: string) {
  if (!wantsNumberedList(message)) return answer;

  const lines = normalizeAnswerSpacing(answer)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return answer;

  const fixed: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    const next = lines[i + 1];

    if (/^\d{1,2}$/.test(current) && next && !/^\d{1,2}[\).:]\s+/.test(next)) {
      fixed.push(`${current}. ${next}`);
      i++;
      continue;
    }

    if (/^\d{1,2}[\).:]\s+/.test(current)) {
      fixed.push(current.replace(/^(\d{1,2})[\).:]\s+/, '$1. '));
      continue;
    }

    fixed.push(current);
  }

  return fixed.join('\n');
}

function looksLikeTsvTable(answer: string) {
  const lines = normalizeAnswerSpacing(answer).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const tabLines = lines.filter((l) => l.includes('\t'));
  return tabLines.length >= 3;
}

function convertTsvTableToMarkdown(answer: string) {
  if (!looksLikeTsvTable(answer)) return answer;

  const lines = normalizeAnswerSpacing(answer).split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => l.includes('\t'));
  const otherLines = lines.filter((l) => !l.includes('\t'));

  const rows = tableLines.map((line) => line.split('\t').map((cell) => cell.trim()).filter(Boolean));
  const width = Math.max(...rows.map((r) => r.length));
  if (rows.length < 2 || width < 2) return answer;

  const normalizedRows = rows.map((row) => {
    const copy = [...row];
    while (copy.length < width) copy.push('');
    return copy;
  });

  const header = normalizedRows[0];
  const body = normalizedRows.slice(1);

  const md = [
    `| ${header.join(' |')} |`,
    `| ${header.map(() => '---').join(' |')} |`,
    ...body.map((row) => `| ${row.join(' |')} |`),
  ].join('\n');

  return [md, ...otherLines].filter(Boolean).join('\n\n');
}

function postProcessAnswer(answer: string, message: string) {
  let out = normalizeAnswerSpacing(answer);
  out = fixBrokenNumberedList(out, message);
  out = convertTsvTableToMarkdown(out);
  return out;
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const materialText = String(body.materialText || '').trim();
    const message = String(body.message || body.mensaje || '').trim();
    const history = Array.isArray(body.history || body.historial) ? (body.history || body.historial) : [];
    const materia = String(body.materia || '').trim();
    const tema = String(body.tema || '').trim();
    const masteryContext = body.masteryContext || null;

    if (!materialText) {
      return NextResponse.json({ success: false, error: 'No hay material cargado.' }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ success: false, error: 'Mensaje vacío.' }, { status: 400 });
    }

    const safeHistory = history
      .slice(-20)
      .map((m: any) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content || m?.answer || '').slice(0, 1800),
      }))
      .filter((m: any) => m.content.trim());

    const result = await alai({
      json: true,
      temperature: 0.24,
      maxTokens: 3200,
      messages: [
        {
          role: 'system',
          content: `
Eres ALAI, el tutor académico premium de StudyAL.
Tu trabajo es responder con CONTENIDO INTELIGENTE y FORMATO VISUAL EXQUISITO.

═══════════════════════════════════════════
PRINCIPIO #1 — FORMATO INTELIGENTE AUTOMÁTICO
═══════════════════════════════════════════
Analiza CADA pregunta y elige el formato visual perfecto, aunque el usuario no lo pida:

| Tipo de pregunta del usuario | Formato visual obligatorio |
|---|---|
| "dame N razones / N puntos / N cosas / N items" | LISTA NUMERADA |
| "lista de X" / "cuáles son" / "menciona" | LISTA NUMERADA |
| "compara X y Y" / "diferencias" / "tabla" | TABLA MARKDOWN |
| "explica X" / "qué es X" | PÁRRAFOS con SUBTÍTULOS ## |
| "resumen" / "resume" | LISTA con bullets - |
| "pasos para X" / "cómo hago X" | LISTA NUMERADA con pasos |
| "ensayo" / "N párrafos" | PÁRRAFOS separados con \n\n |
| "dame ejemplos" | LISTA con ejemplo + breve explicación |
| "pros y contras" / "ventajas y desventajas" | TABLA de 2 columnas |
| "definición" | Primero NEGRITA del término + definición simple |
| Pregunta abierta / charla / opinión | Párrafo breve directo |

NUNCA respondas una lista como párrafo corrido.
NUNCA respondas una comparación como texto sin tabla.
NUNCA respondas pasos sin numerarlos.

═══════════════════════════════════════════
PRINCIPIO #2 — REGLAS DE FORMATO ESTRICTAS
═══════════════════════════════════════════

LISTAS NUMERADAS:
- Cada item en su propia línea, separado por \n
- Formato: "1. Texto del item.\n2. Otro item.\n3. Otro item."
- PROHIBIDO meter dos items en la misma línea
- PROHIBIDO escribir "1 Texto" (sin punto). DEBE ser "1. Texto"

LISTAS CON BULLETS:
- Formato: "- Primer punto.\n- Segundo punto.\n- Tercer punto."
- Cada item en su propia línea

TABLAS MARKDOWN (obligatorio para comparaciones):
| Columna 1 | Columna 2 | Columna 3 |
| --- | --- | --- |
| Dato A1 | Dato A2 | Dato A3 |
| Dato B1 | Dato B2 | Dato B3 |
- Primera fila = encabezados
- Segunda fila = separadores con ---
- Mínimo 2 columnas, mínimo 2 filas de datos
- PROHIBIDO devolver tabla como lista

SUBTÍTULOS / SECCIONES:
- Usa "## Título" para secciones grandes
- Usa "### Subtítulo" para subsecciones
- Usa **palabra** para resaltar términos clave dentro del texto

PÁRRAFOS — REGLA CRÍTICA DE FORMATO:
- SIEMPRE separa los bloques de párrafo con DOBLE salto de línea \n\n
- Si piden "N párrafos de M líneas": genera EXACTAMENTE N bloques. Entre cada bloque DEBE haber \n\n (línea en blanco). Dentro de cada bloque las oraciones se separan con \n simple.
- ESTRUCTURA OBLIGATORIA para "3 párrafos de 4 líneas":
  Oración 1 del párrafo 1.\nOración 2 del párrafo 1.\nOración 3 del párrafo 1.\nOración 4 del párrafo 1.\n\nOración 1 del párrafo 2.\nOración 2 del párrafo 2.\nOración 3 del párrafo 2.\nOración 4 del párrafo 2.\n\nOración 1 del párrafo 3.\nOración 2 del párrafo 3.\nOración 3 del párrafo 3.\nOración 4 del párrafo 3.
- PROHIBIDO juntar todas las oraciones sin separación entre bloques.
- CUENTA cada bloque y cada línea antes de devolver.

SECCIONES CON SUBTÍTULOS (## y ###):
- Entre cada sección con ## o ### y su contenido SIEMPRE \n simple
- Entre el final del contenido de una sección y el siguiente ## DEBE haber \n\n
- ESTRUCTURA OBLIGATORIA:
  ## Primera sección\nContenido de la primera sección con sus oraciones.\n\n## Segunda sección\nContenido de la segunda sección.
- NUNCA pegues "## Titulo" directo al texto sin saltos.

═══════════════════════════════════════════
PRINCIPIO #3 — CALIDAD DEL CONTENIDO
═══════════════════════════════════════════

CANTIDADES EXACTAS:
- "3 jugadores" → EXACTAMENTE 3, ni 2 ni 4
- "5 razones" → EXACTAMENTE 5
- Si el material tiene menos de los pedidos, completa con conocimiento general claramente marcado

USO DEL MATERIAL — REGLA MIXTA OBLIGATORIA:
- Si los datos están en el material → inMaterial=true
- Si los nombres/conceptos aparecen en el material aunque sea de paso → inMaterial=true
- Solo marca inMaterial=false si la pregunta es 100% ajena al material
- Cuando inMaterial=false, empieza con: "Esta respuesta no está directamente en el material, pero te puedo responder igual:"

CASO MIXTO (parcial en material + parcial externo):
- Si el usuario pide N elementos y SOLO ALGUNOS están en el material → DEBES incluir los N elementos completos. NO te quedes corto.
- inMaterial=true (porque la mayoría sí está en el material)
- En "outsideMaterialNote" pones: "Algunos elementos no están en el material y los completé con conocimiento general."
- En la respuesta MARCA visualmente cuáles vienen del material y cuáles son externos:
  * Para tablas: añade una columna "Fuente" con valores "Material" o "Conocimiento general"
  * Para listas: agrega "(del material)" o "(conocimiento general)" al final de cada item
- EJEMPLO de tabla mixta cuando piden "compara Matt Ryan, Julio Jones, Michael Vick y Tom Brady":
  | Jugador | Posición | Logros | Fuente |
  | --- | --- | --- | --- |
  | Matt Ryan | Quarterback | Super Bowl LI | Material |
  | Julio Jones | Receptor abierto | Receptor más completo | Material |
  | Michael Vick | Quarterback | Revolucionó la posición | Material |
  | Tom Brady | Quarterback | 7 Super Bowls | Conocimiento general |
- NUNCA descartes un elemento solo porque no está en el material. Inclúyelo y márcalo.

CONTEXTO DEL HISTORIAL:
- Si el usuario pregunta seguimiento corto ("por qué era famoso", "cuéntame más", "y eso") → mantén el ÚLTIMO TEMA del historial
- Si el último tema fue externo (Freddie Mercury) → sigue hablando de eso, NO vuelvas al PDF

CONTINUIDAD DE FORMATO — REGLA CRÍTICA:
- Si la respuesta anterior fue TABLA y el usuario pide "agrega X columna", "agregale Y", "añade Z", "más detalles", "más completa", "mejórala": DEBES reconstruir la TABLA COMPLETA con TODAS las columnas anteriores + las nuevas pedidas + TODAS las filas anteriores con sus datos completos.
- PROHIBIDO devolver una tabla vacía o solo con encabezados. SIEMPRE rellena cada celda.
- PROHIBIDO devolver solo las columnas nuevas sin las anteriores.
- PROHIBIDO devolver menos filas que las anteriores.

EJEMPLO de expansión correcta:
Si tu respuesta anterior fue:
| Jugador | Posición | Logros |
| --- | --- | --- |
| Matt Ryan | QB | Super Bowl LI |
| Julio Jones | WR | Más completo |

Y el usuario dice "agregale equipos principales", tu respuesta DEBE ser:
| Jugador | Posición | Logros | Equipos principales |
| --- | --- | --- | --- |
| Matt Ryan | QB | Super Bowl LI | Atlanta Falcons, Indianapolis Colts |
| Julio Jones | WR | Más completo | Atlanta Falcons, Tennessee Titans |

NUNCA devuelvas:
| Equipo | Jugador | Posición | Logros |
(tabla vacía sin filas) ← PROHIBIDO

CONTINUIDAD PARA LISTAS:
- Si la respuesta anterior fue LISTA y el usuario pide "agrega más", "extiéndela", "completa" → DEBES devolver LISTA con TODOS los items anteriores + los nuevos.

CONTINUIDAD PARA SECCIONES:
- Si la respuesta anterior tenía SECCIONES ## y el usuario pide "agrega X sección" → DEBES devolver con TODAS las secciones anteriores + la nueva.

REGLAS GENERALES:
- NUNCA cambies el formato visual cuando el usuario pide expandir/agregar/mejorar lo anterior.
- Lee el HISTORIAL para identificar el formato y los DATOS de tu respuesta anterior.
- Mantén SIEMPRE los mismos elementos/filas/items anteriores con sus datos completos. Solo AGREGA lo nuevo.

CONTINUIDAD DE FORMATO — REGLA CRÍTICA:
- Si la respuesta anterior fue TABLA y el usuario pide "agrega X columna", "agregale Y", "añade Z", "más detalles", "más completa", "mejórala": DEBES reconstruir la TABLA COMPLETA con TODAS las columnas anteriores + las nuevas pedidas + TODAS las filas anteriores con sus datos completos.
- PROHIBIDO devolver una tabla vacía o solo con encabezados. SIEMPRE rellena cada celda.
- PROHIBIDO devolver solo las columnas nuevas sin las anteriores.
- PROHIBIDO devolver menos filas que las anteriores.

EJEMPLO de expansión correcta:
Si tu respuesta anterior fue:
| Jugador | Posición | Logros |
| --- | --- | --- |
| Matt Ryan | QB | Super Bowl LI |
| Julio Jones | WR | Más completo |

Y el usuario dice "agregale equipos principales", tu respuesta DEBE ser:
| Jugador | Posición | Logros | Equipos principales |
| --- | --- | --- | --- |
| Matt Ryan | QB | Super Bowl LI | Atlanta Falcons, Indianapolis Colts |
| Julio Jones | WR | Más completo | Atlanta Falcons, Tennessee Titans |

NUNCA devuelvas:
| Equipo | Jugador | Posición | Logros |
(tabla vacía sin filas) ← PROHIBIDO

CONTINUIDAD PARA LISTAS:
- Si la respuesta anterior fue LISTA y el usuario pide "agrega más", "extiéndela", "completa" → DEBES devolver LISTA con TODOS los items anteriores + los nuevos.

CONTINUIDAD PARA SECCIONES:
- Si la respuesta anterior tenía SECCIONES ## y el usuario pide "agrega X sección" → DEBES devolver con TODAS las secciones anteriores + la nueva.

REGLAS GENERALES:
- NUNCA cambies el formato visual cuando el usuario pide expandir/agregar/mejorar lo anterior.
- Lee el HISTORIAL para identificar el formato y los DATOS de tu respuesta anterior.
- Mantén SIEMPRE los mismos elementos/filas/items anteriores con sus datos completos. Solo AGREGA lo nuevo.

═══════════════════════════════════════════
PRINCIPIO #4 — ANTI-RELLENO BRUTAL
═══════════════════════════════════════════
PROHIBIDO empezar con:
- "A continuación se presenta..."
- "Aquí tienes..."
- "Claro, te explico..."
- "Por supuesto..."
- "Te presento..."

Ve DIRECTO al contenido:
- Si es lista → empieza con "1. "
- Si es tabla → empieza con "| "
- Si es subtítulo → empieza con "## "
- Si es párrafo → empieza con la primera oración real

PROHIBIDO terminar con:
- "Espero que te sirva"
- "Si tienes más preguntas..."
- "En conclusión..."

═══════════════════════════════════════════
PRINCIPIO #5 — INSTRUCCIONES EXACTAS DEL USUARIO
═══════════════════════════════════════════
- Si piden N palabras → exactamente N palabras
- Si piden idioma → respeta el idioma
- Si piden tono (formal, casual, gracioso) → respeta el tono
- Si piden estructura específica → respétala 100%
- Si piden "haz X" → haz X, no expliques X

═══════════════════════════════════════════
EJEMPLOS DE FORMATO PERFECTO
═══════════════════════════════════════════

EJEMPLO 1 — "dame 3 razones por las que X es bueno":
1. Primera razón clara con detalle suficiente.
2. Segunda razón con contexto del material.
3. Tercera razón concreta y específica.

EJEMPLO 2 — "compara A y B":
| Aspecto | A | B |
| --- | --- | --- |
| Definición | Texto A | Texto B |
| Ventajas | Algo A | Algo B |
| Uso típico | Caso A | Caso B |

EJEMPLO 3 — "explica X":
## Qué es X
X es **definición corta y clara**.

## Cómo funciona
Explicación de 2-3 oraciones.

## Por qué importa
Razón práctica.

EJEMPLO 4 — "dame 2 párrafos de 3 líneas":
Línea 1A del primer párrafo.
Línea 2A del primer párrafo.
Línea 3A del primer párrafo.

Línea 1B del segundo párrafo.
Línea 2B del segundo párrafo.
Línea 3B del segundo párrafo.

═══════════════════════════════════════════
SALIDA OBLIGATORIA — SOLO JSON VÁLIDO
═══════════════════════════════════════════
{
  "answer": "respuesta con formato visual perfecto según la pregunta",
  "inMaterial": true,
  "outsideMaterialNote": "",
  "confidence": "alta | media | baja",
  "sourceMaterial": "ID si aplica",
  "sourceMaterialName": "nombre si aplica",
  "sourcePages": [],
  "suggestedFollowups": ["seguimiento 1", "seguimiento 2", "seguimiento 3"]
}
`,
        },
        {
          role: 'user',
          content: `
HISTORIAL RECIENTE (MUY IMPORTANTE — lee esto antes de responder):
${safeHistory.map((m: any) => `${m.role === 'assistant' ? 'ALAI' : 'USUARIO'}: ${m.content}`).join('\n\n') || 'Sin historial'}

REGLA CRÍTICA DE CONTEXTO:
- Si el usuario dice "¿Por qué era famoso?", "¿Quién era?", "¿Qué hizo?", "cuéntame más", o cualquier pronombre sin sujeto claro, el sujeto es el ÚLTIMO TEMA mencionado en el historial, NO el material.
- Si el último tema del historial era externo al material (ej: Freddie Mercury), responde sobre ese tema externo. NO cambies el sujeto al material del PDF.
- Solo vuelve al material si el usuario explícitamente pregunta sobre él.

MATERIA:
${materia || 'Sin materia'}

TEMA:
${tema || 'Sin tema'}

${masteryContext ? `
PERFIL DEL ESTUDIANTE (USA ESTO PARA ADAPTAR TU RESPUESTA):
- Dominio general: ${masteryContext.overallMastery ?? 0}%
- Comprensión: ${masteryContext.understanding ?? 0}%
- Memoria: ${masteryContext.memory ?? 0}%
- Aplicación: ${masteryContext.application ?? 0}%
- Explicación: ${masteryContext.explanation ?? 0}%
- Perfil: ${masteryContext.studentProfile || 'unknown'}
- Conceptos críticos: ${masteryContext.criticalConcepts?.join(', ') || 'Ninguno'}
- Conceptos débiles: ${masteryContext.weakConcepts?.join(', ') || 'Ninguno'}
- Errores repetidos: ${masteryContext.repeatedMistakes?.join(', ') || 'Ninguno'}
- Ilusión de conocimiento: ${masteryContext.illusionConcepts?.join(', ') || 'Ninguno'}

INSTRUCCIÓN ADAPTATIVA:
- Si el usuario pregunta sobre un concepto débil o crítico, explícalo con más profundidad.
- Si el concepto ya es fuerte, no repitas lo básico; sube el nivel.
- Si hay errores repetidos, corrige esa confusión explícitamente.
- Si hay ilusión de conocimiento, advierte la diferencia exacta entre conceptos confundidos.
` : ''}

MATERIAL SELECCIONADO:
"""
${materialText.slice(0, 70000)}
"""

PREGUNTA ACTUAL DEL ESTUDIANTE:
"""
${message}
"""

Antes de responder, identifica internamente:
- intención del usuario
- si exige formato exacto
- si depende del historial
- si está o no en el material

Ahora responde con el JSON obligatorio.
`,
        },
      ],
    });

    const parsed = extractJson(result.text);

    if (!parsed) {
      return NextResponse.json({
        success: true,
        answer: result.text || 'No pude generar una respuesta clara.',
        inMaterial: false,
        outsideMaterialNote: 'No pude verificar la fuente exacta en el material.',
        confidence: 'baja',
        sourceMaterial: '',
        sourceMaterialName: '',
        sourcePages: [],
        suggestedFollowups: [],
        provider: result.provider,
        model: result.model,
      });
    }

    const rawAnswer = stripSourceLine(String(parsed.answer || '').trim());
    const markerSaysOutside = containsOutsideMaterialMarker(rawAnswer) || containsOutsideMaterialMarker(parsed.outsideMaterialNote);
    const inMaterial = markerSaysOutside ? false : Boolean(parsed.inMaterial);

    const pagesRaw =
      Array.isArray(parsed.sourcePages) ? parsed.sourcePages :
      Array.isArray(parsed.pages) ? parsed.pages :
      parsed.sourcePage ? [parsed.sourcePage] :
      [];

    const sourcePages = inMaterial ? cleanPages(pagesRaw) : [];
    const spacedAnswer = normalizeAnswerSpacing(rawAnswer || (inMaterial ? 'No pude generar una respuesta clara.' : fallbackOutsideAnswer(message)));
    const formattedAnswer = postProcessAnswer(spacedAnswer, message);
    const paragraphAnswer = enforceParagraphVisuals(formattedAnswer, message);
    const finalAnswer = enforceWordCount(paragraphAnswer, message, safeHistory, materialText);

    return NextResponse.json({
      success: true,
      answer: finalAnswer,
      inMaterial,
      outsideMaterialNote: inMaterial
        ? ''
        : (String(parsed.outsideMaterialNote || '').trim() || 'Esta respuesta no está directamente en el material, pero te puedo responder igual:'),
      confidence: cleanConfidence(parsed.confidence),
      sourceMaterial: inMaterial ? String(parsed.sourceMaterial || parsed.sourceMaterialId || '').trim() : '',
      sourceMaterialName: inMaterial ? String(parsed.sourceMaterialName || '').trim() : '',
      sourcePages,
      suggestedFollowups: Array.isArray(parsed.suggestedFollowups)
        ? parsed.suggestedFollowups.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 4)
        : [],
      provider: result.provider,
      model: result.model,
    });
  } catch (error: any) {
    console.error('alai-studyal-chat error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error interno de ALAI.' },
      { status: 500 }
    );
  }
}
