import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../lib/alai';
import { detectLanguage } from '../../../lib/detectLanguage';

export const maxDuration = 180;

const BRANCH_EMOJIS: Record<string, string> = {
  // Académico
  introducción: '🌱', introduction: '🌱',
  conceptos: '💡', concepts: '💡',
  definiciones: '📖', definitions: '📖',
  historia: '📜', history: '📜',
  origen: '🌅', origins: '🌅',
  evolución: '🔄', evolution: '🔄',
  tipos: '🗂️', types: '🗂️',
  clasificación: '🗂️', classification: '🗂️',
  características: '✨', characteristics: '✨',
  causas: '🔍', causes: '🔍',
  efectos: '💥', effects: '💥',
  consecuencias: '💥',
  proceso: '⚙️', process: '⚙️',
  fórmulas: '🔢', formulas: '🔢',
  ecuaciones: '🔢',
  aplicaciones: '🚀', applications: '🚀',
  ejemplos: '📝', examples: '📝',
  ventajas: '✅', advantages: '✅',
  desventajas: '❌', disadvantages: '❌',
  conclusión: '🎯', conclusion: '🎯',
  resumen: '📋', summary: '📋',
  teoría: '🧠', theory: '🧠',
  métodos: '🔬', methods: '🔬',
  resultados: '📊', results: '📊',
  análisis: '🔬', analysis: '🔬',
  estructura: '🏗️', structure: '🏗️',
  función: '⚡', function: '⚡',
  funciones: '⚡',
  impacto: '💥', impact: '💥',
  // Personas/equipo
  jugadores: '🏃', players: '🏃',
  equipo: '👥', team: '👥',
  personajes: '👥', characters: '👥',
  protagonistas: '⭐',
  líderes: '👑',
  // Cultura/contexto
  cultura: '🎭', culture: '🎭',
  sociedad: '🏛️', society: '🏛️',
  tradición: '📿',
  // Ciencias
  células: '🧬', cells: '🧬',
  células_madre: '🧬',
  órganos: '🫀', organs: '🫀',
  enfermedades: '🦠', diseases: '🦠',
  síntomas: '🤒', symptoms: '🤒',
  tratamientos: '💊', treatments: '💊',
  diagnóstico: '🩺', diagnosis: '🩺',
  // Matemáticas
  teoremas: '📐', theorems: '📐',
  números: '🔢', numbers: '🔢',
  geometría: '📐', geometry: '📐',
  // Tecnología
  algoritmos: '🤖', algorithms: '🤖',
  código: '💻', code: '💻',
  software: '💻',
  hardware: '🖥️',
  // Negocios
  estrategia: '🎯', strategy: '🎯',
  finanzas: '💰', finance: '💰',
  marketing: '📢',
  // Deportes
  logros: '🏆', achievements: '🏆',
  trofeos: '🏆',
  estadísticas: '📊', statistics: '📊',
  partidos: '🏟️', games: '🏟️',
  legado: '👑', legacy: '👑',
  // Geografía
  ubicación: '📍', location: '📍',
  geografía: '🌍', geography: '🌍',
  // Default
};

function assignEmoji(label: string): string {
  const lower = (label || '').toLowerCase();
  for (const [key, emoji] of Object.entries(BRANCH_EMOJIS)) {
    if (lower.includes(key.replace(/_/g, ' '))) return emoji;
  }
  return '●';
}

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf('\n\n', maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf('. ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const texto = String(body.texto || body.content || '').trim();
    const materia = String(body.materia || '').trim();
    const tema = String(body.tema || '').trim();

    if (!texto) return NextResponse.json({ success: false, error: 'Texto vacío' });

    const lang = detectLanguage(texto);
    const isEs = lang !== 'en';
    console.log(`🗺️ StudyMap | ${lang} | ${texto.length} chars | tema: ${tema || 'sin tema'}`);

    // ═══ PASO 1: ESQUEMA INTELIGENTE DEL MATERIAL ═══
    // El AI lee una muestra y propone TÍTULO REAL + CATEGORÍAS ESPECÍFICAS

    const sampleSize = Math.min(8000, texto.length);
    const sample = texto.slice(0, sampleSize);

    const schemaPrompt = isEs
      ? `Eres ALAI, experto en pedagogía. Analiza esta muestra del material y propón la mejor estructura para un mapa mental que cubra el 100% del contenido.

CONTEXTO PROVISTO:
- Materia: ${materia || 'No especificada'}
- Tema declarado por estudiante: ${tema || 'No especificado'}

INSTRUCCIONES CRÍTICAS:

1. TÍTULO REAL: Lee la muestra y deriva el TÍTULO VERDADERO del material. Si el material habla de "Los Atlanta Falcons en la NFL", el título debe ser eso, NO el genérico "${tema}". Si el tema del estudiante es vago (ej: "n", "tema 1"), IGNÓRALO y usa lo que dice el material.

2. CATEGORÍAS ESPECÍFICAS: Propón entre 5 y 8 categorías temáticas REALES y ESPECÍFICAS al contenido. NO uses categorías genéricas como "Introducción", "Características", "Aplicaciones", "Conclusión". 
   ❌ MAL: "Características", "Aplicaciones", "Historia", "Legado"
   ✅ BIEN: "Fundación del equipo (1965)", "Jugadores legendarios", "Cultura y afición de Atlanta", "Super Bowl LI y caída ante Patriots", "Estadio Mercedes-Benz"

3. CADA CATEGORÍA DEBE CONTENER UNA IDEA CONCRETA DEL MATERIAL, no una etiqueta genérica.

4. IDIOMA: Responde en español.

Devuelve JSON puro (sin markdown):
{
  "title": "Título real derivado del material (máx 8 palabras)",
  "summary": "Resumen del material en 1-2 oraciones que diga qué cubre realmente",
  "categorias": [
    { "nombre": "Categoría específica 1 con nombre real", "descripcion": "Qué cubre esta categoría en 1 oración con palabras del material" },
    { "nombre": "Categoría específica 2", "descripcion": "..." }
  ]
}

Muestra del material (primeros ${sampleSize} chars de ${texto.length} totales):
${sample}

⚠️ Responde SOLO el JSON. Sin markdown. Sin \`\`\`. Sin texto antes ni después.`
      : `You are ALAI, pedagogy expert. Analyze this material sample and propose the BEST structure for a mind map covering 100% of content.

CONTEXT:
- Subject: ${materia}
- Topic declared by student: ${tema}

CRITICAL RULES:
1. REAL TITLE: Derive the TRUE TITLE from the sample. If student's topic is vague, IGNORE it and use what material says.
2. SPECIFIC CATEGORIES: Propose 5-8 REAL specific thematic categories. NO generic like "Introduction", "Characteristics", "Applications".
   ❌ BAD: "Characteristics", "Applications", "History"
   ✅ GOOD: "Team founding (1965)", "Legendary players", "Atlanta fan culture", "Super Bowl LI loss"

Return pure JSON:
{
  "title": "Real title from material (max 8 words)",
  "summary": "Material summary in 1-2 sentences",
  "categorias": [
    { "nombre": "Specific category 1", "descripcion": "What it covers" }
  ]
}

Sample (first ${sampleSize} chars of ${texto.length}):
${sample}

⚠️ ONLY JSON. No markdown.`;

    let schema: any = null;
    try {
      const schemaResult = await alaiRequest(async (client: any, model: any) => {
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [{ role: 'user', content: schemaPrompt }],
          temperature: 0.2,
          max_tokens: 2500,
        });
        return r.choices[0]?.message?.content || '';
      });

      try {
        schema = JSON.parse(schemaResult.replace(/```json|```/g, '').trim());
      } catch {
        const m = schemaResult.match(/\{[\s\S]*\}/);
        if (m) schema = JSON.parse(m[0]);
      }
    } catch (e: any) {
      console.error('❌ Error esquema:', e?.message);
    }

    if (!schema || !schema.categorias || !Array.isArray(schema.categorias) || schema.categorias.length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudo analizar la estructura del material.' });
    }

    const titleReal = String(schema.title || tema || 'Mapa Mental').trim();
    const summary = String(schema.summary || '').trim();
    const categoriasSchema = schema.categorias.slice(0, 8).map((c: any) => ({
      nombre: String(c.nombre || c.titulo || '').trim(),
      descripcion: String(c.descripcion || c.description || '').trim(),
    })).filter((c: any) => c.nombre.length > 0);

    console.log(`📐 Esquema: "${titleReal}" | ${categoriasSchema.length} categorías`);

    // ═══ PASO 2: EXTRAER CONCEPTOS POR CHUNK Y CLASIFICAR A LAS CATEGORÍAS ═══

    const CHUNK_SIZE = 6000;
    const chunks = chunkText(texto, CHUNK_SIZE);
    console.log(`📄 ${chunks.length} chunks`);

    interface RawConcept {
      categoria: string;
      concepto: string;
      explicacion: string;
      page?: number;
      detalles?: { titulo: string; texto: string }[];
    }

    const allConcepts: RawConcept[] = [];
    const categoriasJoined = categoriasSchema.map((c: any, i: number) => `${i + 1}. "${c.nombre}" — ${c.descripcion}`).join('\n');

    const PARALLEL = 2;
    for (let start = 0; start < chunks.length; start += PARALLEL) {
      const batch = chunks.slice(start, start + PARALLEL);
      const results = await Promise.all(
        batch.map(async (chunk, batchIdx) => {
          const i = start + batchIdx;
          const extractPrompt = isEs
            ? `Extrae los conceptos importantes de este fragmento del material "${titleReal}".

CATEGORÍAS DEFINIDAS PARA ESTE MAPA (úsalas como única opción):
${categoriasJoined}

REGLAS:
1. Cada concepto debe asignarse a UNA de las categorías de arriba (usa el nombre EXACTO).
2. Si un concepto no encaja en ninguna, ASÍGNALO A LA MÁS CERCANA. No inventes categorías nuevas.
3. Mínimo 6 conceptos por fragmento, ideal 10-15.
4. Las "explicaciones" deben USAR datos reales del material (nombres, números, fechas).
5. Si hay [Pagina N], incluye page: N.
6. Los "detalles" son opcionales (2-3 por concepto) con datos hiper-específicos.

Devuelve JSON puro:
{
  "conceptos": [
    {
      "categoria": "Nombre exacto de una de las categorías de arriba",
      "concepto": "Nombre específico del concepto del material (3-7 palabras)",
      "explicacion": "Explicación clara con datos reales del material (1-2 oraciones)",
      "page": 3,
      "detalles": [
        { "titulo": "Dato específico", "texto": "Información concreta" }
      ]
    }
  ]
}

Fragmento ${i + 1}/${chunks.length}:
${chunk}

⚠️ SOLO JSON. Sin markdown.`
            : `Extract concepts from this fragment of "${titleReal}".

DEFINED CATEGORIES (use these only):
${categoriasJoined}

RULES:
1. Each concept assigned to ONE of above categories (exact name).
2. If doesn't fit, use CLOSEST one. Don't invent new.
3. Min 6 concepts, ideal 10-15.
4. Use REAL data from material.

Return pure JSON:
{
  "conceptos": [
    {
      "categoria": "Exact category name",
      "concepto": "Specific concept (3-7 words)",
      "explicacion": "Clear explanation with real data",
      "page": 3,
      "detalles": [{ "titulo": "Detail", "texto": "Info" }]
    }
  ]
}

Fragment ${i + 1}/${chunks.length}:
${chunk}

⚠️ JSON only.`;

          try {
            const result = await alaiRequest(async (client: any, model: any) => {
              const r = await client.chat.completions.create({
                model: model('llama-3.3-70b-versatile'),
                messages: [{ role: 'user', content: extractPrompt }],
                temperature: 0.2,
                max_tokens: 4000,
              });
              return r.choices[0]?.message?.content || '';
            });

            let parsed: any = null;
            try {
              parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
            } catch {
              const m = result.match(/\{[\s\S]*\}/);
              if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
            }
            const conceptos = parsed?.conceptos || [];
            console.log(`📝 Chunk ${i + 1}: ${conceptos.length} conceptos`);
            return conceptos;
          } catch (e: any) {
            console.error(`❌ Error chunk ${i + 1}:`, e?.message);
            return [];
          }
        })
      );
      for (const arr of results) allConcepts.push(...arr);
    }

    console.log(`🧠 Total: ${allConcepts.length} conceptos`);

    if (allConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudieron extraer conceptos.' });
    }

    // ═══ PASO 3: AGRUPAR POR CATEGORÍA DEFINIDA ═══

    const grouped: Record<string, RawConcept[]> = {};
    for (const cat of categoriasSchema) grouped[cat.nombre] = [];

    // Match flexible: si la categoría asignada no matchea exactamente, encontrar la más parecida
    for (const c of allConcepts) {
      const assignedCat = String(c.categoria || '').trim();
      if (grouped[assignedCat]) {
        grouped[assignedCat].push(c);
      } else {
        // Match parcial: buscar la categoría que más se parezca
        const lcAssigned = assignedCat.toLowerCase();
        let bestMatch = categoriasSchema[0]?.nombre;
        let bestScore = 0;
        for (const cat of categoriasSchema) {
          const lc = cat.nombre.toLowerCase();
          const score = lc.split(/\s+/).filter((w: string) => w.length > 3 && lcAssigned.includes(w)).length;
          if (score > bestScore) { bestScore = score; bestMatch = cat.nombre; }
        }
        if (bestMatch) grouped[bestMatch].push(c);
      }
    }

    // Filtrar categorías vacías
    const usedCategorias = categoriasSchema.filter((cat: any) => (grouped[cat.nombre] || []).length > 0);

    // ═══ PASO 4: CONSTRUIR ÁRBOL ═══

    const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

    const root: any = {
      id: 'root',
      label: titleReal,
      type: 'root',
      emoji: '🎯',
      description: summary,
      children: [],
    };

    root.children = usedCategorias.map((cat: any, bi: number) => {
      const conceptos = grouped[cat.nombre];
      const branchPage = conceptos.find(c => c.page)?.page;

      // Dedupe conceptos (a veces el AI repite el mismo concepto en diferentes chunks)
      const seen = new Set<string>();
      const uniqueConceptos = conceptos.filter(c => {
        const key = c.concepto.toLowerCase().trim().slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return {
        id: `b${bi}`,
        label: cat.nombre,
        type: 'branch',
        emoji: assignEmoji(cat.nombre),
        description: cat.descripcion,
        page: branchPage,
        children: uniqueConceptos.slice(0, 10).map((c, li) => ({
          id: `b${bi}-l${li}`,
          label: c.concepto,
          type: 'leaf',
          description: c.explicacion,
          page: c.page,
          children: Array.isArray(c.detalles)
            ? c.detalles.slice(0, 4).map((d, di) => ({
                id: `b${bi}-l${li}-d${di}`,
                label: d.titulo,
                type: 'detail',
                description: d.texto,
                page: c.page,
              }))
            : [],
        })),
      };
    });

    const countNodes = (n: any): number =>
      1 + (n.children || []).reduce((s: number, c: any) => s + countNodes(c), 0);
    const totalConcepts = countNodes(root) - 1;

    const mapa = { title: titleReal, summary, totalConcepts, root };

    console.log(`✅ "${titleReal}" | ${totalConcepts} nodos | ${usedCategorias.length} categorías reales`);

    return NextResponse.json({ success: true, mapa });

  } catch (error: any) {
    console.error('alai-studyal-map error:', error.message);
    return NextResponse.json({ success: false, error: error.message });
  }
}
