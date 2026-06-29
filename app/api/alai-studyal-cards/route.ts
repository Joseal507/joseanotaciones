import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../lib/alai';
import { detectLanguage } from '../../../lib/detectLanguage';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const texto = body.texto || body.content || body.contenido || '';
    const existentes: string[] = body.existentes || [];
    const masteryContext = body.masteryContext || null;

    if (!texto?.trim()) {
      console.log('❌ Texto vacío');
      return NextResponse.json({ success: false, error: 'Texto vacío' });
    }

    const lang = detectLanguage(texto);
    console.log(`🌐 Idioma: ${lang} | Chars: ${texto.length}`);

    // ─── PASO 1: Dividir documento en chunks ───
    // Chunks más grandes para capturar más contexto por pasada
    const CHUNK_SIZE = 18000;
    const chunks: string[] = [];
    let remaining = texto.trim();

    while (remaining.length > 0) {
      if (remaining.length <= CHUNK_SIZE) {
        chunks.push(remaining);
        break;
      }
      // Cortar en párrafo completo para no partir conceptos a mitad
      let cut = remaining.lastIndexOf('\n\n', CHUNK_SIZE);
      if (cut < CHUNK_SIZE * 0.5) cut = remaining.lastIndexOf('\n', CHUNK_SIZE);
      if (cut < CHUNK_SIZE * 0.5) cut = CHUNK_SIZE;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trim();
    }

    console.log(`📄 ${chunks.length} chunk(s) de hasta ${CHUNK_SIZE} chars`);

    // ─── PASO 2: Extraer conceptos de cada chunk (PARALELO) ───
    const allConcepts: string[] = [];

    // Procesar hasta 3 chunks en paralelo para material largo
    const PARALLEL = 3;
    for (let start = 0; start < chunks.length; start += PARALLEL) {
      const batch_chunks = chunks.slice(start, start + PARALLEL);
      const batch_results = await Promise.all(
        batch_chunks.map(async (chunk, batchIdx) => {
          const i = start + batchIdx;

      const extractPrompt = lang === 'en'
        ? `You are an exhaustive knowledge extractor. Your mission: extract ABSOLUTELY EVERYTHING from the material, omit nothing.

STRICT RULES:
1. Extract EVERY fact, number, name, date, definition, rule, process, exception, formula, example
2. Only EXPLICIT facts in the text. Zero inventions.
3. Be granular: if there are 10 characteristics, list all 10 separately
4. Include exact numerical details (percentages, dates, quantities)
5. Each item on its own line starting with "- "
6. Minimum 20 concepts per page of material. More is better.

Material (${chunk.length} chars):
${chunk}`
        : `Eres un extractor de conocimiento exhaustivo. Tu misión: extraer ABSOLUTAMENTE TODO del material, sin omitir nada.

REGLAS ESTRICTAS:
1. Extrae CADA dato, cifra, nombre, fecha, definición, regla, proceso, excepción, fórmula, ejemplo
2. Solo hechos EXPLÍCITOS en el texto. Cero inventos.
3. Sé granular: si hay 10 características, lista las 10 por separado
4. Incluye detalles numéricos exactos (porcentajes, fechas, cantidades)
5. Cada elemento en su línea con "- "
6. Mínimo 20 conceptos por página de material. Más es mejor.

Material (${chunk.length} chars):
${chunk}`;

      const concepts = await alaiRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [{ role: 'user', content: extractPrompt }],
          temperature: 0.1,
          max_tokens: 6000,
        });
        const text = r.choices[0]?.message?.content || '';
        return text
          .split('\n')
          .filter((l: string) => l.trim().startsWith('- '))
          .map((l: string) => l.replace(/^-\s*/, '').trim())
          .filter((l: string) => l.length > 5);
      });

          return concepts;
        })
      );
      // Aplanar resultados del batch paralelo
      for (let b = 0; b < batch_results.length; b++) {
        const concepts = batch_results[b];
        const i = start + b;
        allConcepts.push(...concepts);
        console.log(`📝 Chunk ${i + 1}/${chunks.length}: ${concepts.length} conceptos | Total: ${allConcepts.length}`);
      }
    }

    console.log(`🧠 Total conceptos: ${allConcepts.length}`);

    if (allConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudieron extraer conceptos del material.' });
    }

    // ─── PASO 3: Convertir conceptos en flashcards ───
    const BATCH_SIZE = 15;
    const allFlashcards: { question: string; answer: string }[] = [];
    const existentesAll = [...existentes];

    for (let i = 0; i < allConcepts.length; i += BATCH_SIZE) {
      const batch = allConcepts.slice(i, i + BATCH_SIZE);

      const flashPrompt = lang === 'en'
        ? `Convert each concept into a clear, simple flashcard.

CRITICAL RULES (FOLLOW ALL):

1. CONTENT:
- Answer MUST come from the material. Real facts only.
- If you can't answer with the material, SKIP that concept.
- NEVER write "not specified", "not mentioned", etc.
- Max 2 sentences. Specific. Concrete.
- No LaTeX for simple numbers.
- Do NOT repeat: ${existentesAll.slice(-60).join(' | ')}

2. REQUIRED FIELDS PER CARD (no exceptions):
- "question": question
- "answer": answer
- "sourceText": REQUIRED. Literal copy (10-30 words) from material.
- "sourcePage": REQUIRED. Integer. Look for [Pagina N] markers.
- "sourceMaterialId": REQUIRED if multiple materials. Material starts with [Material N: ID=VALUE | ...]. Copy EXACTLY the VALUE after "ID=". Example: if you see [Material 2: ID=mat_abc123 | ...] write "mat_abc123". Omit if single material.

⚠️ Cards without sourceText + sourcePage will be DISCARDED.
⚠️ If material starts with [Material 1: mat_abc] and fragment is from it, sourceMaterialId MUST be "mat_abc".

Return ONLY valid JSON:
{
  "flashcards": [
    { "question": "...", "answer": "...", "sourceText": "...", "sourcePage": 3, "sourceMaterialId": "mat_xxx", "primaryConcept": "ATP", "concepts": ["ATP", "Mitocondria"] }
  ]
}

CRITICAL: "primaryConcept" = the main academic concept this card tests (1-3 words, NOT the question text).
"concepts" = list of 1-3 academic concepts covered by this card.

Material context:
${texto.slice(0, 14000)}

Concepts:
${batch.map((c, idx) => `${idx + 1}. ${c}`).join('\n')}`
        : `Convierte cada concepto en una flashcard clara y simple.

${masteryContext ? `
PERFIL DEL ESTUDIANTE — ADAPTA LAS FLASHCARDS:
- Conceptos débiles: ${masteryContext.weakConcepts?.join(', ') || 'ninguno'}
- Conceptos críticos: ${masteryContext.criticalConcepts?.join(', ') || 'ninguno'}
- Perfil: ${masteryContext.studentProfile}
INSTRUCCIÓN: Prioriza flashcards sobre los conceptos débiles y críticos. Para conceptos ya dominados (${masteryContext.strongConcepts?.join(', ') || 'ninguno'}), crea flashcards de nivel avanzado o de conexión entre conceptos.
` : ''}

REGLAS CRÍTICAS (DEBES SEGUIRLAS TODAS):

1. CONTENIDO:
- La respuesta DEBE venir directamente del material. Solo hechos reales.
- Si no puedes responder con el material, OMITE ese concepto.
- NUNCA escribas "no se especifica", "no se menciona", etc.
- Máximo 2 oraciones. Específico. Concreto.
- NO uses LaTeX para números simples.
- NO repitas: ${existentesAll.slice(-60).join(' | ')}

2. CAMPOS OBLIGATORIOS POR CADA CARD (sin excepción):
- "question": pregunta
- "answer": respuesta
- "sourceText": OBLIGATORIO. Copia textual (10-30 palabras) del material. Sin modificar.
- "sourcePage": OBLIGATORIO. Número entero. Busca [Pagina N] en el material.
- "sourceMaterialId": OBLIGATORIO si hay varios materiales. El material empieza con [Material N: ID=VALOR | ...]. Copia EXACTAMENTE el VALOR después de "ID=". Ejemplo: si ves [Material 2: ID=mat_abc123 | ...] escribe "mat_abc123". Si solo hay un material, omítelo.

⚠️ Si la card no tiene sourceText + sourcePage será DESCARTADA.
⚠️ Si el material empieza con [Material 1: mat_abc] y el fragmento viene de ahí, sourceMaterialId DEBE ser "mat_abc".

Devuelve SOLO JSON válido:
{
  "flashcards": [
    { "question": "...", "answer": "...", "sourceText": "...", "sourcePage": 3, "sourceMaterialId": "mat_xxx", "primaryConcept": "ATP", "concepts": ["ATP", "Mitocondria"] }
  ]
}

CRÍTICO: "primaryConcept" = el concepto académico principal que evalúa esta card (1-3 palabras, NO el texto de la pregunta).
"concepts" = lista de 1-3 conceptos académicos que cubre esta card.

Contexto del material:
${texto.slice(0, 14000)}

Conceptos:
${batch.map((c, idx) => `${idx + 1}. ${c}`).join('\n')}`;

      const cards = await alaiRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [{ role: 'user', content: flashPrompt }],
          temperature: 0.2,
          max_tokens: 10000,
        });

        const text = r.choices[0]?.message?.content || '';
        let parsed: any = null;
        try { parsed = JSON.parse(text.trim()); } catch {}
        if (!parsed) {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
        }
        const cards = parsed?.flashcards || [];
        // Debug: ver si trae sourceText
        if (cards.length > 0) {
          const first = cards[0];
          console.log('🔍 Primera card:', {
            hasSourceText: !!first?.sourceText,
            hasSourcePage: !!first?.sourcePage,
            sourceTextPreview: first?.sourceText?.slice(0, 60),
            sourcePage: first?.sourcePage,
          });
        }
        return cards;
      });

      // ─── Filtrar respuestas inútiles ───
      const filtered = cards.filter((c: any) => {
        if (!c.question?.trim() || !c.answer?.trim()) return false;
        const badPhrases = [
          'no se proporciona', 'no se especifica', 'no se menciona',
          'no está definido', 'no se define', 'no hay información',
          'not specified', 'not provided', 'not mentioned',
          'not defined', 'no information', 'not stated',
          'not available', 'no disponible', 'not found',
          'sin información', 'not given', 'no se da',
        ];
        const answerLower = c.answer.toLowerCase();
        return !badPhrases.some(phrase => answerLower.includes(phrase));
      }).map((c: any) => ({
        question: c.question,
        answer: c.answer,
        sourceText: typeof c.sourceText === 'string' ? c.sourceText.trim().slice(0, 400) : undefined,
        sourcePage: Number.isFinite(Number(c.sourcePage)) ? Number(c.sourcePage) : undefined,
        sourceMaterialId: typeof c.sourceMaterialId === 'string' ? c.sourceMaterialId : undefined,
      }));

      allFlashcards.push(...filtered);
      filtered.forEach((c: any) => existentesAll.push(c.question));
      console.log(`✅ Lote ${Math.ceil((i + 1) / BATCH_SIZE)}: ${filtered.length}/${cards.length} cards válidas | Total: ${allFlashcards.length}`);
    }

    console.log(`🎯 TOTAL FINAL: ${allFlashcards.length} flashcards | idioma: ${lang}`);

    return NextResponse.json({
      success: true,
      flashcards: allFlashcards,
      idioma: lang,
    });

  } catch (error: any) {
    console.error('flashcards error:', error.message);
    return NextResponse.json({ success: false, error: error.message });
  }
}
