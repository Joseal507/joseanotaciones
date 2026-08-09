import { NextRequest, NextResponse } from 'next/server';
import { alai } from '../../../lib/alai';
import { detectLanguage } from '../../../lib/detectLanguage';
import { QuizQuestion, QuizQuestionType, MultipleChoiceQuestion, MultiSelectQuestion, TrueFalseQuestion, FillBlankQuestion, MatchingQuestion, ShortAnswerQuestion } from '../../../lib/types/quiz';
import { generateValidatedLegacyJson } from '../../../lib/ai/legacyRouteGeneration';

export const maxDuration = 120;

const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

interface MaterialBlock {
  id: string;
  name: string;
  text: string;
}

interface ExtractedConcept {
  text: string;
  materialId: string;
  materialName: string;
  page?: number;
}

interface ConceptTask {
  concept: string;
  materialId: string;
  materialName: string;
  page?: number;
  type: QuizQuestionType;
}

function parseMaterialBlocks(text: string, defaultId = ''): MaterialBlock[] {
  const blocks: MaterialBlock[] = [];
  
  const flashcardRegex = /\[Material\s+\d+:\s*ID=([^|\]]+)\s*\|\s*([^|\]]+)[^\]]*\]\n([\s\S]*?)(?=\n\[Material\s+\d+:\s*ID=|$)/gi;
  let match;
  while ((match = flashcardRegex.exec(text)) !== null) {
    blocks.push({
      id: match[1].trim(),
      name: match[2].trim(),
      text: match[3].trim()
    });
  }
  
  if (blocks.length === 0) {
    const quizRegex = /<<< MATERIAL_\d+_START:\s*([^\n(]+)(?:\s*\(ID:\s*([^)]+)\))?\s*>>>\n([\s\S]*?)(?=\n<<< MATERIAL_\d+_START:|\n<<< MATERIAL_\d+_END|$)/gi;
    let quizMatch;
    while ((quizMatch = quizRegex.exec(text)) !== null) {
      const name = quizMatch[1].trim();
      const id = quizMatch[2] ? quizMatch[2].trim() : `mat_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const content = quizMatch[3].trim();
      blocks.push({
        id,
        name,
        text: content
      });
    }
  }
  
  if (blocks.length === 0 && text.trim().length > 0) {
    blocks.push({
      id: defaultId || 'mat_default',
      name: 'Material Principal',
      text: text.trim()
    });
  }
  
  return blocks;
}

function normalizeText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoChunks(text: string, chunkSize = 15000): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining);
      break;
    }

    let cut = remaining.lastIndexOf('\n\n', chunkSize);
    if (cut < chunkSize * 0.5) cut = remaining.lastIndexOf('\n', chunkSize);
    if (cut < chunkSize * 0.5) cut = chunkSize;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  return chunks.filter(Boolean);
}

function toInt(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeQuestion(q: any, defaultMaterialId = '', defaultMaterialName = ''): QuizQuestion | null {
  if (!q || typeof q !== 'object') return null;

  const type = String(q.type || q.tipo || '').trim() as QuizQuestionType;
  const question = String(q.question || q.pregunta || '').trim();
  const explanation = String(q.explanation || q.explicacion || '').trim();
  const difficulty = (['easy', 'medium', 'hard'].includes(String(q.difficulty || q.dificultad)) 
    ? q.difficulty 
    : 'medium') as 'easy' | 'medium' | 'hard';
  
  const sourceMaterial = String(q.sourceMaterial || q.sourceMaterialId || defaultMaterialId || '').trim();
  const sourceMaterialName = String(q.sourceMaterialName || defaultMaterialName || '').trim();
  const sourcePage = Number.isFinite(Number(q.sourcePage)) ? Math.trunc(Number(q.sourcePage)) : undefined;

  if (!question || !type) return null;

  const base = {
    id: String(q.id || genId()),
    type,
    question,
    explanation,
    difficulty,
    sourceMaterial,
    sourceMaterialName,
    sourcePage
  };

  if (type === 'multiple_choice') {
    const rawOptions = Array.isArray(q.options || q.opciones) ? (q.options || q.opciones) : [];
    const options = rawOptions.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 4);
    let correctAnswer = toInt(q.correctAnswer ?? q.correcta);
    if (options.length < 2 || correctAnswer === null || correctAnswer < 0 || correctAnswer >= options.length) return null;
    
    const correctValue = options[correctAnswer];
    const shuffledOptions = [...options].sort(() => Math.random() - 0.5);
    correctAnswer = shuffledOptions.indexOf(correctValue);
    
    return { ...base, type, options: shuffledOptions, correctAnswer } as MultipleChoiceQuestion;
  }

  if (type === 'multi_select') {
    const rawOptions = Array.isArray(q.options || q.opciones) ? (q.options || q.opciones) : [];
    const options = rawOptions.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 5);
    const rawCorrect = Array.isArray(q.correctAnswers || q.correctas) ? (q.correctAnswers || q.correctas) : [];
    const correctAnswers = Array.from(
      new Set(
        rawCorrect
          .map((v: any) => toInt(v))
          .filter((v: number | null): v is number => v !== null && v >= 0 && v < options.length)
      )
    );
    if (
      options.length < 2 ||
      correctAnswers.length < 2
    ) return null;
    
    const correctValues = correctAnswers.filter((idx): idx is number => typeof idx === "number").map(idx => options[idx]);
    const shuffledOptions = [...options].sort(() => Math.random() - 0.5);
    const shuffledCorrect = correctValues
      .map(val => shuffledOptions.indexOf(val))
      .filter(idx => idx !== -1);

    return { ...base, type, options: shuffledOptions, correctAnswers: shuffledCorrect } as MultiSelectQuestion;
  }

  if (type === 'true_false') {
    let correctAnswer: boolean | null = null;
    if (typeof q.correctAnswer === 'boolean') {
      correctAnswer = q.correctAnswer;
    } else if (q.correctAnswer !== undefined && q.correctAnswer !== null) {
      const valStr = String(q.correctAnswer).toLowerCase().trim();
      if (['true', '1', 'yes', 'si', 'verdadero', 'v'].includes(valStr)) correctAnswer = true;
      if (['false', '0', 'no', 'falso', 'f'].includes(valStr)) correctAnswer = false;
    }
    if (correctAnswer === null) return null;
    return { ...base, type, correctAnswer } as TrueFalseQuestion;
  }

  if (type === 'fill_blank') {
    const answer = String(q.answer || q.respuesta || '').trim();
    if (!answer) return null;
    
    let updatedQuestion = question;
    if (!updatedQuestion.includes('___')) {
      updatedQuestion = `${updatedQuestion} ___`;
    }

    let rawBank = Array.isArray(q.wordBank || q.bancoPalabras) ? (q.wordBank || q.bancoPalabras) : [];
    let wordBank = rawBank.map((w: any) => String(w).trim()).filter(Boolean);
    
    if (!wordBank.includes(answer)) {
      wordBank.unshift(answer);
    }
    
    if (wordBank.length < 4) return null;
    
    const shuffledBank = wordBank.sort(() => Math.random() - 0.5).slice(0, 5);
    return { ...base, type, question: updatedQuestion, answer, wordBank: shuffledBank } as FillBlankQuestion;
  }

  if (type === 'matching') {
    const rawPairs = Array.isArray(q.pairs || q.pares) ? (q.pairs || q.pares) : [];
    const pairs: { left: string; right: string }[] = [];
    const seenLeft = new Set<string>();
    const seenRight = new Set<string>();

    for (const pair of rawPairs) {
      if (!pair || typeof pair !== 'object') continue;
      const left = String(pair.left || pair.izquierda || '').trim();
      const right = String(pair.right || pair.derecha || '').trim();
      if (!left || !right) continue;
      
      const leftLower = left.toLowerCase();
      if (['caso practico', 'fundamento teorico', 'analisis critico', 'contexto empirico', 'concepto', 'definicion'].includes(leftLower)) {
        continue;
      }
      
      const leftNorm = left.toLowerCase();
      const rightNorm = right.toLowerCase();
      if (seenLeft.has(leftNorm) || seenRight.has(rightNorm)) continue;
      
      seenLeft.add(leftNorm);
      seenRight.add(rightNorm);
      pairs.push({ left, right });
    }

    if (pairs.length !== 4) return null; // Grid estricto 4x4

    return { ...base, type, pairs } as MatchingQuestion;
  }

  if (type === 'short_answer') {
    const acceptedAnswers = Array.isArray(q.acceptedAnswers || q.palabrasClave)
      ? (q.acceptedAnswers || q.palabrasClave).map((a: any) => String(a).trim()).filter(Boolean)
      : [];
    const answerModelo = String(q.respuestaModelo || q.respuesta || '').trim();
    
    if (acceptedAnswers.length === 0 && answerModelo) {
      acceptedAnswers.push(answerModelo);
    }
    if (acceptedAnswers.length === 0) return null;

    return { ...base, type, acceptedAnswers, caseInsensitive: true } as ShortAnswerQuestion;
  }

  return null;
}

function extractValidQuestions(text: string, materialBlocks: MaterialBlock[]): QuizQuestion[] {
  const list: QuizQuestion[] = [];
  
  let parsed: any = null;
  try {
    parsed = JSON.parse(text.trim());
  } catch {}
  
  if (!parsed) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch {}
    }
  }
  
  if (parsed && Array.isArray(parsed.questions || parsed.quiz)) {
    const questions = parsed.questions || parsed.quiz;
    for (const q of questions) {
      const block = materialBlocks.find(b => b.id === q.sourceMaterial || b.id === q.sourceMaterialId) || materialBlocks[0];
      const sanitized = sanitizeQuestion(q, block?.id, block?.name);
      if (sanitized) list.push(sanitized);
    }
  }
  
  if (list.length === 0) {
    let depth = 0;
    let startIdx = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) startIdx = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const candidate = text.slice(startIdx, i + 1);
          try {
            const q = JSON.parse(candidate);
            if (q && (q.question || q.pregunta) && (q.type || q.tipo)) {
              const block = materialBlocks.find(b => b.id === q.sourceMaterial || b.id === q.sourceMaterialId) || materialBlocks[0];
              const sanitized = sanitizeQuestion(q, block?.id, block?.name);
              if (sanitized) {
                list.push(sanitized);
              }
            }
          } catch {}
        }
        if (depth < 0) depth = 0;
      }
    }
  }
  
  return list;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const rawText = String(body.content || body.contenido || body.texto || '').trim();
    const count = Math.max(1, Math.min(Number(body.count) || 10, 50));
    const masteryContext = body.masteryContext || null;
    const nivel = ['facil', 'intermedio', 'dificil', 'easy', 'medium', 'hard'].includes(String(body.nivel))
      ? String(body.nivel)
      : 'intermedio';

    const rawTypes = Array.isArray(body.tipos) ? body.tipos : ['multiple_choice'];
    const mapping: Record<string, QuizQuestionType> = {
      multiple: 'multiple_choice',
      multiple_choice: 'multiple_choice',
      multiselect: 'multi_select',
      multi_select: 'multi_select',
      truefalse: 'true_false',
      true_false: 'true_false',
      rellenar: 'fill_blank',
      fill_blank: 'fill_blank',
      relacionar: 'matching',
      matching: 'matching',
      corta: 'short_answer',
      short_answer: 'short_answer'
    };
    
    const instruction = String(body.instruction || '').trim();
    const tipos = Array.from(
      new Set(
        rawTypes
          .map((t: any) => mapping[String(t).trim().toLowerCase()])
          .filter(Boolean)
      )
    ) as QuizQuestionType[];

    if (!rawText) {
      return NextResponse.json({ success: false, error: 'Texto vacío' }, { status: 400 });
    }

    const lang = detectLanguage(rawText);
    const materialBlocks = parseMaterialBlocks(rawText, body.materialId);
    
    console.log(`🧠 [Quiz Backend] Iniciando pipeline de 2 pasos escalable. Materiales: ${materialBlocks.length}`);

    // COLCHÓN PROPORCIONAL DINÁMICO: 15% de holgura para amortiguar cualquier dedupe de manera perfecta
    const bufferCount = count + Math.max(4, Math.ceil(count * 0.15));

    const allExtractedConcepts: ExtractedConcept[] = [];

    await Promise.all(
      materialBlocks.map(async (block) => {
        const chunks = splitIntoChunks(block.text, 15000);
        
        const chunkResults = await Promise.all(
          chunks.map(async (chunk) => {
            const extractPrompt = lang === 'en'
              ? `You are an extremely meticulous, granular fact extractor. Your mission is to extract absolutely every distinct, granular fact, date, formula, name, step in a process, logical condition, or exception from the text.
Rules:
1. Do NOT group or generalize concepts. Keep each fact atomic and distinct. We need a highly detailed list of separate facts.
2. Find the nearest preceding [Pagina N] or [Page N] marker in the text for each fact.
3. Format each extracted line EXACTLY like this:
"- [Page N] Fact text"
where "N" is the page integer. If not found, omit the "[Page N]" prefix.

Material Text:
${chunk}`
              : `Eres un extractor de conocimiento ultra-fiel. Tu ÚNICA FUENTE es el texto proporcionado. Está TERMINANTEMENTE PROHIBIDO inventar hechos o usar conocimiento externo. Extrae hechos, cifras y datos EXACTAMENTE como aparecen.
Reglas:
1. NO agrupes conceptos ni generalices. Mantén cada hecho por separado para tener una lista muy densa y variada de datos diferentes.
2. Para cada hecho que extraigas, busca el marcador [Pagina N], [Página N] o [Page N] más cercano que lo precede.
3. Formatea cada línea extraída EXACTAMENTE de esta manera:
"- [Pagina N] Hecho o concepto"
donde "N" es el número entero de la página. Si no lo encuentras, omite el prefijo "[Pagina N]".

Contexto del Material:
${chunk}`;

            const res = await alai({
              messages: [
        { role: 'system', content: 'Eres un examinador experto. REGLA DE ORO: El 80% de las preguntas DEBEN ser sobre los conceptos listados como DÉBILES o CRÍTICOS. PROHIBIDO preguntar sobre conceptos dominados. Si el estudiante tiene "ilusión de conocimiento" en un concepto, haz una pregunta trampa sobre ese concepto exacto.' },{ role: 'user', content: extractPrompt }],
              temperature: 0.1,
              maxTokens: 4000,
            });

            return res.text
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.startsWith('- '))
              .map(line => {
                const cleanLine = line.replace(/^-\s*/, '').trim();
                const lineMatch = cleanLine.match(/^(?:\[P[áa]gina\s*(\d+)\]|\[Page\s*(\d+)\])?\s*(.*)/i);
                let pageNum: number | undefined = undefined;
                let textContent = cleanLine;
                if (lineMatch) {
                  const numStr = lineMatch[1] || lineMatch[2];
                  if (numStr) pageNum = parseInt(numStr, 10);
                  textContent = lineMatch[3].trim();
                }
                return { text: textContent, page: pageNum };
              })
              .filter(item => item.text.length > 5);
          })
        );

        for (const list of chunkResults) {
          for (const item of list) {
            allExtractedConcepts.push({
              text: item.text,
              page: item.page,
              materialId: block.id,
              materialName: block.name
            });
          }
        }
      })
    );

    console.log(`🧠 [Quiz Backend] Conceptos extraídos totales: ${allExtractedConcepts.length}`);

    if (allExtractedConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudieron extraer conceptos del material.' }, { status: 422 });
    }

    const selectedTasks: ConceptTask[] = [];

    // ── SELECCIÓN ADAPTATIVA basada en masteryContext ──
    // Si hay contexto de mastery, priorizar conceptos débiles
    if (masteryContext?.weakConcepts?.length || masteryContext?.criticalConcepts?.length) {
      const weakSet = new Set([
        ...(masteryContext.criticalConcepts || []).map((s: string) => s.toLowerCase()),
        ...(masteryContext.weakConcepts || []).map((s: string) => s.toLowerCase()),
        ...(masteryContext.forgettingRiskConcepts || []).map((s: string) => s.toLowerCase()),
      ]);
      const strongSet = new Set(
        (masteryContext.strongConcepts || []).map((s: string) => s.toLowerCase())
      );

      // Clasificar conceptos extraídos
      const weak: ExtractedConcept[] = [];
      const normal: ExtractedConcept[] = [];
      const strong: ExtractedConcept[] = [];

      for (const c of allExtractedConcepts) {
        const text = c.text.toLowerCase();
        const isWeak = Array.from(weakSet).some((w: string) => text.includes(w) || w.includes(text.slice(0, 20)));
        const isStrong = Array.from(strongSet).some((s: string) => text.includes(s) || s.includes(text.slice(0, 20)));

        if (isWeak) weak.push(c);
        else if (isStrong) strong.push(c);
        else normal.push(c);
      }

      // Distribución adaptativa:
      // críticos/débiles: 55% | normales: 35% | fuertes: 10%
      const weakCount = Math.round(bufferCount * 0.55);
      const normalCount = Math.round(bufferCount * 0.35);
      const strongCount = bufferCount - weakCount - normalCount;

      const adaptiveConcepts: ExtractedConcept[] = [
        ...weak.sort(() => Math.random() - 0.5).slice(0, weakCount),
        ...normal.sort(() => Math.random() - 0.5).slice(0, normalCount),
        ...strong.sort(() => Math.random() - 0.5).slice(0, strongCount),
      ];

      // Si no hay suficientes débiles, completar con normales
      if (adaptiveConcepts.length < bufferCount) {
        const missing = bufferCount - adaptiveConcepts.length;
        const extra = [...normal, ...strong]
          .filter(c => !adaptiveConcepts.includes(c))
          .sort(() => Math.random() - 0.5)
          .slice(0, missing);
        adaptiveConcepts.push(...extra);
      }

      // Ajustar dificultad según el perfil del estudiante
      let adaptedNivel = nivel;
      if (masteryContext.studentProfile === 'beginner') {
        adaptedNivel = 'facil';
      } else if (masteryContext.studentProfile === 'memorizer' || masteryContext.studentProfile === 'understander') {
        adaptedNivel = 'intermedio';
      } else if (masteryContext.studentProfile === 'advanced') {
        adaptedNivel = 'dificil';
      }

      // Crear tasks con dificultad adaptada
      for (const c of adaptiveConcepts) {
        const type = tipos[Math.floor(Math.random() * tipos.length)];
        selectedTasks.push({
          concept: c.text,
          materialId: c.materialId,
          materialName: c.materialName,
          page: c.page,
          type,
        });
      }

      console.log('[Quiz Adaptativo] Debiles: ' + weak.length + ' | Normales: ' + normalCount + ' | Fuertes: ' + strongCount + ' | Perfil: ' + masteryContext.studentProfile);
    }

    // DISTRIBUCIÓN PROPORCIONAL GARANTIZADA POR MATERIAL
    // Agrupar conceptos por material
    // Shuffle global primero (solo si no se usó selección adaptativa)
    if (selectedTasks.length === 0) allExtractedConcepts.sort(() => Math.random() - 0.5);
    const conceptsByMaterial: Record<string, ExtractedConcept[]> = {};
    for (const c of allExtractedConcepts) {
      if (!conceptsByMaterial[c.materialId]) conceptsByMaterial[c.materialId] = [];
      conceptsByMaterial[c.materialId].push(c);
    }
    const matIds = Object.keys(conceptsByMaterial);
    console.log('[Quiz Backend] Conceptos por material:', matIds.map(id => id + ': ' + conceptsByMaterial[id].length).join(', '));

    // Calcular cuántas preguntas le tocan a cada material proporcionalmente
    // Solo si no se usó selección adaptativa
    const totalConcepts = allExtractedConcepts.length;
    const tasksPerMaterial: Record<string, number> = {};
    let assigned = 0;
    if (selectedTasks.length === 0) matIds.forEach((id, idx) => {
      if (idx === matIds.length - 1) {
        tasksPerMaterial[id] = bufferCount - assigned;
      } else {
        const share = Math.round((conceptsByMaterial[id].length / totalConcepts) * bufferCount);
        tasksPerMaterial[id] = Math.max(1, share);
        assigned += tasksPerMaterial[id];
      }
    });
    console.log('[Quiz Backend] Tareas por material:', matIds.map(id => id + ': ' + tasksPerMaterial[id]).join(', '));

    // Generar tareas round-robin entre materiales para intercalar bien
    const cursors: Record<string, number> = {};
    matIds.forEach(id => { cursors[id] = 0; });

    // Crear lista intercalada: 1 de mat1, 1 de mat2, 1 de mat1, etc.
    const interleavedTasks: ConceptTask[] = [];
    const maxPerMat = Math.max(...matIds.map(id => tasksPerMaterial[id]));
    let typeIdx = 0;
    for (let i = 0; i < maxPerMat; i++) {
      for (const matId of matIds) {
        if (cursors[matId] >= tasksPerMaterial[matId]) continue;
        const concepts = conceptsByMaterial[matId];
        const concept = concepts[cursors[matId] % concepts.length];
        // Tipo random puro — sin patrón predecible
        const type = tipos[Math.floor(Math.random() * tipos.length)];
        interleavedTasks.push({
          concept: concept.text,
          materialId: concept.materialId,
          materialName: concept.materialName,
          page: concept.page,
          type
        });
        cursors[matId]++;
        typeIdx++;
      }
    }
    selectedTasks.push(...interleavedTasks.slice(0, bufferCount));

    console.log('[Quiz Backend] Tareas totales asignadas con distribucion proporcional: ' + selectedTasks.length);
    console.log('[Quiz Backend] Distribucion final:', matIds.map(id => id + ': ' + selectedTasks.filter(t => t.materialId === id).length).join(', '));

    const difficultyLabel = nivel === 'facil' || nivel === 'easy' ? 'easy' : nivel === 'dificil' || nivel === 'hard' ? 'hard' : 'medium';

    const promptTipos = lang === 'en'
      ? `Type-specific specifications (STRICT JSON):
- "multiple_choice": "options" is exactly 4 strings. "correctAnswer" is the index 0-3.
- "true_false": "correctAnswer" is boolean (true or false).
- "multi_select": "options" is 4-5 strings. "correctAnswers" is array of correct indices.
- "fill_blank": "question" MUST contain exactly one "___" placeholder. Make sure that the missing word or phrase ("answer") is NOT repeated in the sentence. For example, if the sentence is "Bohr studied at Copenhagen University", replacing "Copenhagen" must result in "Bohr studied at ___ University", NOT "Bohr studied at ___ Copenhagen University". "answer" is the word. "wordBank" has exactly 4 options.

REQUIRED IN EVERY QUESTION:
- "primaryConcept": string — the main academic concept being tested (1-3 words, e.g. "ATP synthesis", NOT the question text)
- "concepts": string[] — list of 1-3 academic concepts this question covers
- "matching": "pairs" MUST have exactly 4 objects: { "left": "concept", "right": "match" }. Do NOT use placeholder/generic words. Use real facts.
- "short_answer": "acceptedAnswers" is array of 1-5 strings, "caseInsensitive" is true.`
      : `Especificación estricta de tipos (JSON ESTRICTO):
- "multiple_choice": "options" tiene exactamente 4 strings. "correctAnswer" es el entero (0-3).
- "true_false": "correctAnswer" es un booleano (true o false).
- "multi_select": "options" tiene de 4 a 5 strings. "correctAnswers" es un array de enteros correctos.
- "fill_blank": "question" DEBE contener exactamente un "___" reemplazando una palabra crucial. REGLA GRAMATICAL: Todas las opciones en "wordBank" DEBEN compartir el mismo género (masculino/femenino) y número (singular/plural) que la respuesta correcta, para que la respuesta no sea obvia por descartes del texto previo (ej. "el", "una"). "answer" es la palabra correcta. "wordBank" tiene 4 opciones.

OBLIGATORIO EN CADA PREGUNTA:
- "primaryConcept": string — el concepto académico principal que evalúa (1-3 palabras, ej. "síntesis de ATP", NO el texto de la pregunta)
- "concepts": string[] — lista de 1-3 conceptos académicos que cubre esta pregunta
- "matching": "pairs" DEBE contener exactamente 4 objetos: { "left": "concepto", "right": "definición" }. REGLA CRÍTICA: Los 4 conceptos DEBEN pertenecer a la MISMA CATEGORÍA EXACTA (ej. 4 fechas, 4 autores, o 4 teorías) para que la respuesta requiera conocimiento y no sea deducible por simple descarte. Extrae hechos reales.
- "short_answer": "acceptedAnswers" es un array de 1-5 strings correctos, "caseInsensitive" es true.`;

    const templateExample = lang === 'en'
      ? `STRICT JSON FORMAT EXAMPLES PER TYPE (FOLLOW THIS PRECISELY):
1. "multiple_choice": {"id": "q_1", "type": "multiple_choice", "question": "...", "explanation": "...", "options": ["A", "B", "C", "D"], "correctAnswer": 1}
2. "true_false": {"id": "q_2", "type": "true_false", "question": "...", "explanation": "...", "correctAnswer": true}
3. "matching": {"id": "q_3", "type": "matching", "question": "...", "pairs": [{"left": "A", "right": "1"}, {"left": "B", "right": "2"}, {"left": "C", "right": "3"}, {"left": "D", "right": "4"}]}`
      : `EJEMPLOS DE FORMATO JSON ESTRICTO POR TIPO (SÍGUELOS AL PIE DE LA LETRA):
1. "multiple_choice": {"id": "q_1", "type": "multiple_choice", "question": "...", "explanation": "...", "options": ["A", "B", "C", "D"], "correctAnswer": 1}
2. "true_false": {"id": "q_2", "type": "true_false", "question": "...", "explanation": "...", "correctAnswer": true}
3. "matching": {"id": "q_3", "type": "matching", "question": "...", "pairs": [{"left": "A", "right": "1"}, {"left": "B", "right": "2"}, {"left": "C", "right": "3"}, {"left": "D", "right": "4"}]}`;

    // ─── PASO 3: GENERACIÓN MULTILOTE SECUENCIAL ───
    const sanitized: QuizQuestion[] = [];
    const BATCH_SIZE = 10;

    for (let start = 0; start < selectedTasks.length; start += BATCH_SIZE) {
      const batchTasks = selectedTasks.slice(start, start + BATCH_SIZE);
      const batchNum = Math.trunc(start / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(selectedTasks.length / BATCH_SIZE);

      console.log(`🧠 [Quiz Backend] Procesando lote ${batchNum}/${totalBatches} (${batchTasks.length} preguntas)...`);

      const conversionPrompt = lang === 'en'
        ? `You are an assessment writer. Generate high-quality, fully distinct quiz questions of difficulty "${difficultyLabel}" based strictly on the tasks below.

CRITICAL VARIATION RULES:
1. If some source concepts in the list below overlap, have similar meanings, or are duplicates, you MUST vary the angle, context, and focus of their respective questions.
2. For example, if Concept A and Concept B both relate to a discovery date, make one question evaluate the date, and the other evaluate the scientific implication, the people, or the experiments. No two questions must feel similar or repetitive.
3. Use highly diverse and creative phrasing for all questions.

${promptTipos}
${templateExample}

Return ONLY valid JSON matching this schema:
{
  "questions": [
    {
      "id": "unique_string",
      "type": "assigned_type",
      "question": "...",
      "explanation": "...",
      "difficulty": "${difficultyLabel}",
      "sourceMaterial": "material_id",
      "sourceMaterialName": "material_name",
      "sourcePage": page_number,
      ... type specific fields
    }
  ]
}

TASKS LIST FOR THIS BATCH:
${batchTasks.map((t, idx) => `
Task #${idx + 1}:
- Source Concept: "${t.concept}"
- Target Question Type: "${t.type}"
- Source Material ID: "${t.materialId}"
- Source Material Name: "${t.materialName}"
- Source Page: ${t.page || 'null'}
`).join('\n')}`
        : `Eres un examinador de fidelidad extrema. Tu misión es convertir hechos en preguntas SIN AÑADIR NADA externo. Si un hecho dice "A", la pregunta solo trata sobre "A".

INSTRUCCIÓN CRÍTICA ADICIONAL:
${instruction}

REGLAS CRÍTICAS DE VARIACIÓN (ANTI-REPETICIÓN):
1. Si algunos hechos de origen en la lista de abajo se solapan, son similares o están duplicados debido a la brevedad del texto de origen, DEBES variar por completo el ángulo, el foco conceptual y el contexto de cada pregunta.
2. Por ejemplo, si el Hecho A y el Hecho B hablan sobre Niels Bohr y el Premio Nobel, haz que una pregunta evalúe el año exacto (1922) y la otra evalúe el motivo del premio, los descubrimientos previos o sus implicaciones. Ninguna pregunta debe sonar parecida o redundante.
3. Utiliza redacciones muy creativas y diversas para que estudiar el mazo sea una experiencia práctica e instructiva.

${promptTipos}
${templateExample}

Devuelve SOLO JSON válido con este formato:
{
  "questions": [
    {
      "id": "unique_string",
      "type": "tipo_asignado",
      "question": "...",
      "explanation": "...",
      "difficulty": "${difficultyLabel}",
      "sourceMaterial": "material_id",
      "sourceMaterialName": "material_name",
      "sourcePage": numero_de_pagina,
      ... campos específicos del tipo
    }
  ]
}

LISTA DE TAREAS PARA ESTE LOTE:
${batchTasks.map((t, idx) => `
Tarea #${idx + 1}:
- Hecho de Origen: "${t.concept}"
- Tipo de Pregunta Asignado: "${t.type}"
- ID del Material: "${t.materialId}"
- Nombre del Material: "${t.materialName}"
- Página: ${t.page || 'null'}
`).join('\n')}`;

      try {
        const parsedBatch = await generateValidatedLegacyJson<QuizQuestion[]>({
          taskType: 'evaluation_question',
          prompt: conversionPrompt,
          temperature: 0.15,
          maxTokens: 3500,
          normalize: value => extractValidQuestions(JSON.stringify(value), materialBlocks),
          validate: value => {
            const questions = Array.isArray(value) ? value : []
            const errors: string[] = []
            if (!questions.length) errors.push('STRUCTURAL_VALIDATION_FAILED:no_quiz_questions')
            const seen = new Set<string>()
            for (const question of questions) {
              const key = normalizeText(question.question)
              if (seen.has(key)) errors.push('SEMANTIC_DUPLICATION:quiz_question')
              seen.add(key)
              if (!tipos.includes(question.type)) errors.push(`INCOMPATIBLE_ACTIVITY:${question.type}`)
            }
            if (questions.length < Math.min(2, batchTasks.length)) errors.push('LOW_DIVERSITY:quiz_batch')
            return { valid: errors.length === 0, errors }
          },
          telemetryContext: { route: 'quizzes', batch: batchNum },
        })
        sanitized.push(...parsedBatch);
        console.log(`✅ Lote ${batchNum} procesado exitosamente: ${parsedBatch.length} preguntas añadidas.`);
      } catch (err: any) {
        console.error(`⚠️ Error al procesar lote ${batchNum}:`, err.message);
        throw err
      }
    }

    // Filtrar duplicados
    const deduped = sanitized.filter((q, index, arr) => {
      const key = normalizeText(q.question);
      return arr.findIndex(x => normalizeText(x.question) === key) === index;
    });

    // Mezclado final e intercalado de fuentes
    const shuffled: QuizQuestion[] = [];
    const questionsByMaterial: Record<string, QuizQuestion[]> = {};
    for (const q of deduped) {
      const matId = q.sourceMaterial || 'default';
      if (!questionsByMaterial[matId]) questionsByMaterial[matId] = [];
      questionsByMaterial[matId].push(q);
    }
    
    const matKeys = Object.keys(questionsByMaterial);
    let maxLen = 0;
    matKeys.forEach(k => { if (questionsByMaterial[k].length > maxLen) maxLen = questionsByMaterial[k].length; });
    
    for (let i = 0; i < maxLen; i++) {
      for (const k of matKeys) {
        if (questionsByMaterial[k][i]) {
          shuffled.push(questionsByMaterial[k][i]);
        }
      }
    }

    // EL RECORTE FINAL AHORA SÍ CONSERVARÁ LA CANTIDAD PEDIDA DE MANERA ABSOLUTA
    const finalQuiz = shuffled.slice(0, count);
    console.log(`🎯 [Quiz Backend] Proceso multilote completado. Enviando: ${finalQuiz.length}/${count} preguntas de alta calidad.`);

    return NextResponse.json({
      success: true,
      quiz: finalQuiz,
      requestedCount: count,
      generatedCount: finalQuiz.length,
    });

  } catch (error: any) {
    console.error('Error general:', error?.message || error);
    return NextResponse.json({ success: false, error: error?.message || 'Error interno' }, { status: 500 });
  }
}
