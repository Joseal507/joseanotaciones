import { NextRequest, NextResponse } from 'next/server';
import { alai, safeParseJson } from '../../../lib/alai';
import { detectLanguage } from '../../../lib/detectLanguage';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type QuestionType =
  | 'short_answer'
  | 'open_response'
  | 'multiple_choice'
  | 'true_false'
  | 'matching'
  | 'fill_blank'
  | 'case_application';

type Skill =
  | 'retention' | 'comprehension' | 'application'
  | 'relation' | 'explanation' | 'critical_thinking';

type Difficulty = 'basic' | 'medium' | 'advanced';

interface MaterialBlock {
  id: string;
  name: string;
  text: string;
}

interface ExtractedFact {
  text: string;
  materialId: string;
  materialName: string;
  page?: number;
}

interface ExamQuestion {
  id: string;
  section: string;
  type: QuestionType;
  prompt: string;
  points: number;
  options?: string[];
  correctAnswer?: any;
  expectedAnswer?: string;
  rubricHints?: string[];
  sourceMaterial?: string;
  sourceMaterialName?: string;
  sourcePage?: number;
  skill: Skill;
  difficulty: Difficulty;
  pairs?: { left: string; right: string }[];
  wordBank?: string[];
}

interface ExamSection { id: string; title: string; description?: string; }

interface GeneratedExam {
  id: string;
  title: string;
  totalPoints: number;
  estimatedDifficulty: Difficulty;
  coverage: string;
  sections: ExamSection[];
  questions: ExamQuestion[];
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMaterialBlocks(text: string, defaultId = ''): MaterialBlock[] {
  const blocks: MaterialBlock[] = [];

  const regex = /\[Material\s+\d+:\s*ID=([^|\]]+)\s*\|\s*([^|\]]+)[^\]]*\]\n([\s\S]*?)(?=\n\[Material\s+\d+:\s*ID=|$)/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      id: match[1].trim(),
      name: match[2].trim(),
      text: match[3].trim(),
    });
  }

  if (blocks.length === 0 && text.trim()) {
    blocks.push({
      id: defaultId || 'mat_default',
      name: 'Material Principal',
      text: text.trim(),
    });
  }

  return blocks;
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

// ═══════════════════════════════════════════════════════════════
// FACT EXTRACTION (igual que Cards/Quiz: paralelo, granular)
// ═══════════════════════════════════════════════════════════════

async function extractFacts(materialBlocks: MaterialBlock[], lang: 'es' | 'en'): Promise<ExtractedFact[]> {
  const facts: ExtractedFact[] = [];

  await Promise.all(
    materialBlocks.map(async (block) => {
      const chunks = splitIntoChunks(block.text, 15000);

      const PARALLEL = 3;
      for (let start = 0; start < chunks.length; start += PARALLEL) {
        const batch = chunks.slice(start, start + PARALLEL);

        const results = await Promise.all(
          batch.map(async (chunk) => {
            const prompt = lang === 'en'
              ? `You are an exhaustive academic fact extractor. Extract EVERY discrete, granular fact from the material, no omissions.

STRICT RULES:
1. Extract every fact, number, name, date, definition, rule, process, exception, formula, example.
2. Atomic, never grouped, never generalized.
3. Only EXPLICIT content. Zero invention.
4. For each fact find the nearest preceding [Page N] / [Pagina N] marker.
5. Format EXACTLY:
"- [Page N] Fact text"
If page unknown, omit prefix.
6. Aim for 20+ facts per page of material.

Material (${chunk.length} chars):
${chunk}`
              : `Eres un extractor académico exhaustivo. Extrae TODOS los hechos discretos del material, sin omitir nada.

REGLAS ESTRICTAS:
1. Extrae cada hecho, cifra, nombre, fecha, definición, regla, proceso, excepción, fórmula, ejemplo.
2. Atómico, nunca agrupado, nunca generalizado.
3. Solo contenido EXPLÍCITO. Cero invención.
4. Para cada hecho busca el marcador más cercano [Pagina N] / [Página N] / [Page N].
5. Formato EXACTO:
"- [Pagina N] Hecho o concepto"
Si no sabes la página, omite el prefijo.
6. Apunta a 20+ hechos por página de material.

Material (${chunk.length} chars):
${chunk}`;

            const res = await alai({
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1,
              maxTokens: 5500,
            });

            return res.text
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l.startsWith('- '))
              .map((l) => {
                const clean = l.replace(/^-\s*/, '').trim();
                const m = clean.match(/^(?:\[P[áa]gina\s*(\d+)\]|\[Page\s*(\d+)\])?\s*(.*)/i);
                const page = m && (m[1] || m[2]) ? Number(m[1] || m[2]) : undefined;
                const text = m ? m[3].trim() : clean;
                return { text, page };
              })
              .filter((x) => x.text.length > 8);
          })
        );

        for (const list of results) {
          for (const item of list) {
            facts.push({
              text: item.text,
              page: item.page,
              materialId: block.id,
              materialName: block.name,
            });
          }
        }
      }
    })
  );

  return facts;
}

// ═══════════════════════════════════════════════════════════════
// PLANNING — cantidad real basada en duración + densidad
// ═══════════════════════════════════════════════════════════════

function calculateRecommendedMinutes(facts: ExtractedFact[], totalChars: number, pageCount: number): number {
  const conceptScore = facts.length;
  const sizeScore = totalChars / 1000;
  const pageScore = pageCount;

  const raw = (conceptScore * 0.7) + (sizeScore * 0.4) + (pageScore * 1.5);

  if (raw < 25) return 10;
  if (raw < 55) return 20;
  if (raw < 110) return 30;
  if (raw < 200) return 45;
  return 60;
}

function planExamComposition(durationMinutes: number, totalFacts: number) {
  const baseByTime =
    durationMinutes <= 5 ? 6 :
    durationMinutes <= 10 ? 12 :
    durationMinutes <= 20 ? 20 :
    durationMinutes <= 30 ? 28 :
    durationMinutes <= 45 ? 40 :
    55;

  const factCapacity = Math.max(10, Math.floor(totalFacts / 1.2));
  const total = Math.min(baseByTime, factCapacity);

  // Variación aleatoria de proporciones (±25%) por ejecución
  const rand = () => 0.75 + Math.random() * 0.5;

  const rawProps = {
    multiple_choice: 0.28 * rand(),
    true_false: 0.14 * rand(),
    fill_blank: 0.14 * rand(),
    short_answer: 0.16 * rand(),
    matching: totalFacts >= 12 ? 0.06 * rand() : 0,
    case_application: 0.11 * rand(),
    open_response: 0.11 * rand(),
  };
  const sumProps = Object.values(rawProps).reduce((a, b) => a + b, 0);
  const norm = (v: number) => v / sumProps;

  const distribution: Record<QuestionType, number> = {
    multiple_choice: Math.max(2, Math.round(total * norm(rawProps.multiple_choice))),
    true_false: Math.max(1, Math.round(total * norm(rawProps.true_false))),
    fill_blank: Math.max(1, Math.round(total * norm(rawProps.fill_blank))),
    short_answer: Math.max(1, Math.round(total * norm(rawProps.short_answer))),
    matching: rawProps.matching > 0 ? Math.max(1, Math.round(total * norm(rawProps.matching))) : 0,
    case_application: Math.max(1, Math.round(total * norm(rawProps.case_application))),
    open_response: Math.max(1, Math.round(total * norm(rawProps.open_response))),
  };

  // Ajustar suma
  let sum = Object.values(distribution).reduce((a, b) => a + b, 0);
  while (sum > total) {
    const max = (Object.keys(distribution) as QuestionType[]).reduce((a, b) =>
      distribution[a] >= distribution[b] ? a : b
    );
    if (distribution[max] > 0) { distribution[max] -= 1; sum -= 1; } else break;
  }
  while (sum < total) {
    distribution.multiple_choice += 1;
    sum += 1;
  }

  return { total, distribution };
}

const SECTIONS: { id: string; title: string; skill: Skill; types: QuestionType[] }[] = [
  { id: 'I',   title: 'I. Retención y conceptos básicos', skill: 'retention',          types: ['fill_blank', 'true_false'] },
  { id: 'II',  title: 'II. Comprensión',                  skill: 'comprehension',      types: ['multiple_choice', 'short_answer'] },
  { id: 'III', title: 'III. Aplicación',                  skill: 'application',        types: ['case_application'] },
  { id: 'IV',  title: 'IV. Relaciones entre conceptos',   skill: 'relation',           types: ['matching', 'multiple_choice'] },
  { id: 'V',   title: 'V. Desarrollo / pensamiento crítico', skill: 'critical_thinking', types: ['open_response'] },
];

// ═══════════════════════════════════════════════════════════════
// SANITIZE
// ═══════════════════════════════════════════════════════════════

function toInt(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function sanitizeQuestion(q: any, section: string, fallbackMaterial?: MaterialBlock): ExamQuestion | null {
  if (!q || typeof q !== 'object') return null;

  const type = String(q.type || '').trim() as QuestionType;
  const prompt = String(q.prompt || q.question || '').trim();
  if (!prompt || !type) return null;

  const validTypes: QuestionType[] = ['short_answer','open_response','multiple_choice','true_false','matching','fill_blank','case_application'];
  if (!validTypes.includes(type)) return null;

  const skill = (['retention','comprehension','application','relation','explanation','critical_thinking'].includes(q.skill) ? q.skill : 'comprehension') as Skill;
  const difficulty = (['basic','medium','advanced'].includes(q.difficulty) ? q.difficulty : 'medium') as Difficulty;
  const points = Math.max(2, Math.min(Number(q.points) || 10, 25));

  const base: ExamQuestion = {
    id: String(q.id || genId()),
    section,
    type,
    prompt,
    points,
    expectedAnswer: String(q.expectedAnswer || q.respuestaEsperada || '').trim(),
    rubricHints: Array.isArray(q.rubricHints) ? q.rubricHints.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 5) : [],
    sourceMaterial: String(q.sourceMaterial || fallbackMaterial?.id || '').trim(),
    sourceMaterialName: String(q.sourceMaterialName || fallbackMaterial?.name || '').trim(),
    sourcePage: Number.isFinite(Number(q.sourcePage)) ? Math.trunc(Number(q.sourcePage)) : undefined,
    skill,
    difficulty,
  };

  if (type === 'multiple_choice') {
    const opts = Array.isArray(q.options) ? q.options.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 4) : [];
    const idx = toInt(q.correctAnswer);
    if (opts.length < 3 || idx === null || idx < 0 || idx >= opts.length) return null;
    base.options = opts;
    base.correctAnswer = idx;
    return base;
  }

  if (type === 'true_false') {
    let val: boolean | null = null;
    if (typeof q.correctAnswer === 'boolean') val = q.correctAnswer;
    else {
      const s = String(q.correctAnswer).toLowerCase().trim();
      if (['true','verdadero','v','si','1'].includes(s)) val = true;
      if (['false','falso','f','no','0'].includes(s)) val = false;
    }
    if (val === null) return null;
    base.correctAnswer = val;
    return base;
  }

  if (type === 'fill_blank') {
    const answer = String(q.expectedAnswer || q.answer || '').trim();
    if (!answer) return null;
    if (!base.prompt.includes('___')) base.prompt = `${base.prompt} ___`;
    base.expectedAnswer = answer;

    let bank = Array.isArray(q.wordBank) ? q.wordBank.map((w: any) => String(w).trim()).filter(Boolean) : [];
    if (!bank.includes(answer)) bank.unshift(answer);
    if (bank.length < 4) {
      const fillers = ['proceso','concepto','estructura','método','función','análisis','sistema'];
      for (const f of fillers) { if (bank.length >= 4) break; if (!bank.includes(f)) bank.push(f); }
    }
    base.wordBank = bank.sort(() => Math.random() - 0.5).slice(0, 5);
    return base;
  }

  if (type === 'matching') {
    const rawPairs = Array.isArray(q.pairs) ? q.pairs : [];
    const pairs: { left: string; right: string }[] = [];
    for (const p of rawPairs) {
      const left = String(p?.left || '').trim();
      const right = String(p?.right || '').trim();
      if (left && right) pairs.push({ left, right });
    }
    if (pairs.length < 3 || pairs.length > 5) return null;
    base.pairs = pairs;
    return base;
  }

  if (type === 'short_answer') {
    if (!base.expectedAnswer) return null;
    return base;
  }

  if (type === 'open_response' || type === 'case_application') {
    if (!base.expectedAnswer) base.expectedAnswer = '';
    return base;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// GENERATE (lotes de 6 paralelos)
// ═══════════════════════════════════════════════════════════════

async function generateExam(
  materialText: string,
  durationMinutes: number,
  materia: string,
  tema: string,
  selectedPages: number[],
  masteryContext: any = null
): Promise<{ exam: GeneratedExam; recommendedMinutes: number }> {
  const lang = detectLanguage(materialText);
  const materialBlocks = parseMaterialBlocks(materialText);
  if (!materialBlocks.length) throw new Error('No hay material válido para generar el examen.');

  console.log(`🧠 [Exam] Materiales: ${materialBlocks.length}`);

  const facts = await extractFacts(materialBlocks, lang);
  if (facts.length < 5) throw new Error('El material no tiene suficiente densidad de conceptos para crear un examen real.');

  console.log(`🧠 [Exam] Hechos extraídos: ${facts.length}`);

  const totalChars = materialBlocks.reduce((acc, b) => acc + b.text.length, 0);
  const pageCount = selectedPages.length || Math.max(1, Math.round(totalChars / 2500));
  const recommendedMinutes = calculateRecommendedMinutes(facts, totalChars, pageCount);

  const { total, distribution } = planExamComposition(durationMinutes, facts.length);
  console.log(`🧠 [Exam] Plan: ${total} preguntas`, distribution);

  // Shuffle con priorización adaptativa si hay masteryContext
  let shuffledFacts: ExtractedFact[];
  if (masteryContext?.weakConcepts?.length || masteryContext?.criticalConcepts?.length) {
    const weakSet = new Set([
      ...(masteryContext.criticalConcepts || []).map((s: string) => s.toLowerCase()),
      ...(masteryContext.weakConcepts || []).map((s: string) => s.toLowerCase()),
    ]);
    const weakFacts = facts.filter((f: ExtractedFact) =>
      Array.from(weakSet).some((w: string) => f.text.toLowerCase().includes(w))
    );
    const normalFacts = facts.filter((f: ExtractedFact) =>
      !Array.from(weakSet).some((w: string) => f.text.toLowerCase().includes(w))
    );
    // 60% de hechos débiles, 40% normales
    const weakCount = Math.round(total * 0.6);
    const normalCount = total - weakCount;
    shuffledFacts = [
      ...weakFacts.sort(() => Math.random() - 0.5).slice(0, weakCount * 2),
      ...normalFacts.sort(() => Math.random() - 0.5).slice(0, normalCount * 2),
    ].sort(() => Math.random() - 0.5);
    console.log('[Exam Adaptativo] Debiles: ' + weakFacts.length + ' | Normales: ' + normalFacts.length);
  } else {
    shuffledFacts = [...facts].sort(() => Math.random() - 0.5);
  }

  // Asignar slots por sección
  type Slot = { section: string; sectionId: string; type: QuestionType; fact: ExtractedFact };
  const slots: Slot[] = [];
  let cursor = 0;

  const activeSections = SECTIONS.filter((sec) =>
    sec.types.some((t) => (distribution[t] || 0) > 0)
  );

  // No siempre empezar por sección I — variar orden
  const shuffledSections = [...activeSections].sort(() => Math.random() - 0.5);

  for (const sec of shuffledSections) {
    const sectionTotal = sec.types.reduce((acc, t) => acc + (distribution[t] || 0), 0);
    for (let i = 0; i < sectionTotal && cursor < shuffledFacts.length; i++) {
      const availableTypes = sec.types.filter((t) => (distribution[t] || 0) > 0);
      if (!availableTypes.length) break;
      const type = availableTypes[i % availableTypes.length];
      distribution[type] -= 1;
      slots.push({
        section: sec.title,
        sectionId: sec.id,
        type,
        fact: shuffledFacts[cursor],
      });
      cursor++;
    }
  }

  // Resto a Comprensión
  for (const t of Object.keys(distribution) as QuestionType[]) {
    while (distribution[t] > 0 && cursor < shuffledFacts.length) {
      slots.push({
        section: 'II. Comprensión',
        sectionId: 'II',
        type: t,
        fact: shuffledFacts[cursor],
      });
      distribution[t] -= 1;
      cursor++;
    }
  }

  console.log(`🧠 [Exam] Slots asignados: ${slots.length}`);

  // Procesar lotes en paralelo
  const BATCH = 6;
  const allQuestions: ExamQuestion[] = [];

  const batches: Slot[][] = [];
  for (let s = 0; s < slots.length; s += BATCH) {
    batches.push(slots.slice(s, s + BATCH));
  }

  const PARALLEL = 3;
  for (let p = 0; p < batches.length; p += PARALLEL) {
    const parallelBatches = batches.slice(p, p + PARALLEL);

    const batchResults = await Promise.all(
      parallelBatches.map(async (batch, batchIdx) => {
        const batchNum = p + batchIdx + 1;
        return await processBatch(batch, materia, tema, lang, materialBlocks, batchNum, batches.length);
      })
    );

    for (const list of batchResults) {
      allQuestions.push(...list);
    }
  }

  console.log(`🧠 [Exam] Preguntas crudas generadas: ${allQuestions.length}`);

  // Dedupe
  const deduped = allQuestions.filter((q, i, arr) => {
    const key = normalize(q.prompt).slice(0, 80);
    return arr.findIndex((x) => normalize(x.prompt).slice(0, 80) === key) === i;
  });

  console.log(`🧠 [Exam] Tras dedupe: ${deduped.length}`);

  if (deduped.length < Math.max(4, Math.floor(total * 0.45))) {
    throw new Error('ALAI no pudo generar suficientes preguntas reales desde el material.');
  }

  // Mezclar preguntas pero agrupar 2-3 por sección para no saltar caóticamente
  const bySection: Record<string, ExamQuestion[]> = {};
  for (const q of deduped) {
    if (!bySection[q.section]) bySection[q.section] = [];
    bySection[q.section].push(q);
  }
  const sectionKeys = Object.keys(bySection).sort(() => Math.random() - 0.5);
  for (const k of sectionKeys) {
    bySection[k].sort(() => Math.random() - 0.5);
  }
  const interleaved: ExamQuestion[] = [];
  let added = true;
  let cursors: Record<string, number> = {};
  sectionKeys.forEach(k => cursors[k] = 0);
  while (added) {
    added = false;
    for (const k of sectionKeys) {
      const arr = bySection[k];
      if (cursors[k] < arr.length) {
        interleaved.push(arr[cursors[k]]);
        cursors[k]++;
        added = true;
      }
    }
  }
  deduped.length = 0;
  deduped.push(...interleaved);

  // Limitar al total planeado
  const finalQuestions = deduped.slice(0, total);

  // Construir secciones efectivas
  const sectionMap = new Map<string, ExamSection>();
  for (const q of finalQuestions) {
    if (!sectionMap.has(q.section)) {
      sectionMap.set(q.section, { id: q.section, title: q.section });
    }
  }

  const totalPoints = finalQuestions.reduce((a, q) => a + (q.points || 10), 0);
  const advancedCount = finalQuestions.filter((q) => q.difficulty === 'advanced').length;
  const estimatedDifficulty: Difficulty =
    advancedCount / finalQuestions.length > 0.4 ? 'advanced' :
    advancedCount / finalQuestions.length > 0.15 ? 'medium' : 'basic';

  const coverage = selectedPages.length
    ? `Páginas ${selectedPages.join(', ')}`
    : `${materialBlocks.length} material(es)`;

  const exam: GeneratedExam = {
    id: genId(),
    title: `Examen ALAI · ${tema || materia || 'StudyAL'}`,
    totalPoints,
    estimatedDifficulty,
    coverage,
    sections: Array.from(sectionMap.values()),
    questions: finalQuestions,
  };

  console.log(`🎯 [Exam] FINAL: ${finalQuestions.length} preguntas, ${totalPoints} pts, ${exam.sections.length} secciones`);

  return { exam, recommendedMinutes };
}

async function processBatch(
  batch: { section: string; sectionId: string; type: QuestionType; fact: ExtractedFact }[],
  materia: string,
  tema: string,
  lang: 'es' | 'en',
  materialBlocks: MaterialBlock[],
  batchNum: number,
  totalBatches: number,
): Promise<ExamQuestion[]> {
  const typeSpec = lang === 'en'
    ? `Type schemas (return strict JSON):
- "multiple_choice": { "options": [4 strings], "correctAnswer": index 0-3 }
- "true_false": { "correctAnswer": boolean }
- "short_answer": { "expectedAnswer": "model short answer (3-12 words)" }
- "fill_blank": { "prompt": "sentence with ___", "expectedAnswer": "missing word", "wordBank": [4 plausible options including the correct one] }
- "matching": { "pairs": [{"left","right"}] × 3-5, all from same category, real facts only }
- "case_application": { "prompt": "practical scenario", "expectedAnswer": "model answer", "rubricHints": [...] }
- "open_response": { "prompt": "deep critical question", "expectedAnswer": "model answer", "rubricHints": [...] }`
    : `Esquemas por tipo (JSON estricto):
- "multiple_choice": { "options": [4 strings], "correctAnswer": índice 0-3 }
- "true_false": { "correctAnswer": booleano }
- "short_answer": { "expectedAnswer": "respuesta modelo breve (3-12 palabras)" }
- "fill_blank": { "prompt": "oración con ___", "expectedAnswer": "palabra faltante", "wordBank": [4 opciones plausibles incluyendo la correcta] }
- "matching": { "pairs": [{"left","right"}] × 3-5, todas misma categoría, hechos reales }
- "case_application": { "prompt": "escenario práctico", "expectedAnswer": "respuesta modelo", "rubricHints": [...] }
- "open_response": { "prompt": "pregunta crítica profunda", "expectedAnswer": "respuesta modelo", "rubricHints": [...] }`;

  const prompt = lang === 'en'
    ? `You are ALAI, a serious university exam writer. Generate one HIGH QUALITY question per task. Use ONLY the source fact. Zero invention.

CRITICAL QUALITY RULES — ALL QUESTIONS MUST BE SELF-CONTAINED AND UNAMBIGUOUS:

1. SPECIFICITY (mandatory):
   - Mention concepts, people, events, formulas BY NAME. Never use vague references.
   - ❌ BAD: "What did the narrator see?", "What did he discover?", "Why is it important?"
   - ✅ GOOD: "What did Mendel discover when crossing pea plants?", "Why did Newton's First Law explain inertia?"

2. SELF-CONTAINED:
   - The question must be answerable without having the source paragraph in front of you.
   - Include enough context in the prompt itself.

3. SKILL-SPECIFIC RULES:

   COMPREHENSION questions (skill: "comprehension"):
   - Must test UNDERSTANDING, not recall.
   - Ask "why", "how does X relate to Y", "what does X mean in context of Y".
   - NEVER ask "what does the text say about X" — too shallow.

   APPLICATION questions (skill: "application", type: "case_application"):
   - MUST present a CONCRETE SCENARIO with specific data/numbers/situation.
   - The student must DECIDE, CALCULATE, CHOOSE, or PREDICT — not define.
   - Include all data needed in the prompt itself.
   - ❌ BAD: "How would you apply Newton's First Law?"
   - ✅ GOOD: "A 1200kg car traveling at 60 km/h brakes suddenly. Without a seatbelt, what happens to a passenger and why, according to Newton's First Law?"

4. VARIATION:
   - Each question evaluates a DIFFERENT angle.
   - For multiple_choice, distractors must be plausible but clearly wrong if you know the material.
   - For fill_blank, wordBank must share grammar/gender with the correct answer.
   - NEVER repeat phrasing or ask twice about the same exact fact.

${typeSpec}

Return ONLY valid JSON:
{ "questions": [ {
  "id":"...","section":"...","type":"...","prompt":"...","points":number,
  "expectedAnswer":"...","rubricHints":[...],"skill":"retention|comprehension|application|relation|explanation|critical_thinking",
  "difficulty":"basic|medium|advanced",
  "sourceMaterial":"...","sourceMaterialName":"...","sourcePage":number|null,
  ...type-specific fields
} ] }

Subject: ${materia}
Topic: ${tema}

TASKS (batch ${batchNum}/${totalBatches}):
${batch.map((s, i) => `
#${i + 1}
- Section: ${s.section}
- Type: ${s.type}
- Source fact: "${s.fact.text}"
- Material ID: ${s.fact.materialId}
- Material name: ${s.fact.materialName}
- Page: ${s.fact.page ?? 'null'}
`).join('\n')}`
    : `Eres ALAI, redactor serio de exámenes universitarios. Genera UNA pregunta de ALTA CALIDAD por tarea. Usa ÚNICAMENTE el hecho de origen. Cero invención.

REGLAS CRÍTICAS DE CALIDAD — TODA PREGUNTA DEBE SER AUTOSUFICIENTE Y CLARA:

1. ESPECIFICIDAD (obligatoria):
   - Menciona conceptos, personas, eventos, fórmulas POR SU NOMBRE. Nunca uses referencias vagas SIN contexto.
   - REGLA SOBRE "EL NARRADOR" / "EL AUTOR" / "EL PERSONAJE":
     * Si el material es ficción/novela/cuento y el narrador es un personaje, puedes mencionarlo PERO siempre añadiendo el CONTEXTO específico (qué escena, qué momento, qué situación).
     * NUNCA preguntes solo "¿Qué vio el narrador?" — debe ser "¿Qué vio el narrador al entrar a [lugar específico]?" o "¿Qué describe el narrador sobre [evento específico]?"
     * Si conoces el nombre del narrador/personaje en el material, ÚSALO en lugar de "el narrador".
   - ❌ MAL: "¿Qué vio el narrador?", "¿Qué descubrió él?", "¿Por qué es importante?", "¿Qué dice el autor?"
   - ❌ MAL: "¿Qué siente el personaje?" (sin decir cuál personaje ni en qué momento)
   - ✅ BIEN: "¿Qué descubrió Mendel al cruzar guisantes amarillos y verdes?"
   - ✅ BIEN: "Según el narrador en el capítulo de la cena familiar, ¿cómo describe la actitud de su padre?"
   - ✅ BIEN: "¿Qué siente Gregorio Samsa al despertar transformado en insecto al inicio de La Metamorfosis?"

2. AUTOSUFICIENCIA:
   - La pregunta debe poder responderse sin tener el párrafo fuente al lado.
   - Incluye el contexto necesario DENTRO del enunciado.
   - Si la pregunta requiere mencionar un personaje, situación o hecho previo, INCLUYE esa info en el prompt.

3. REGLAS ESPECÍFICAS POR SKILL:

   PREGUNTAS DE COMPRENSIÓN (skill: "comprehension"):
   - Deben evaluar ENTENDIMIENTO, no memoria.
   - Pregunta "por qué", "cómo se relaciona X con Y", "qué significa X en el contexto de Y".
   - ❌ MAL: "¿Qué dice el texto sobre X?" — demasiado superficial.
   - ❌ MAL: "¿Qué vio el narrador en la escena?" — sin especificar qué escena.
   - ✅ BIEN: "¿Por qué Romeo decide tomar el veneno al ver a Julieta en la cripta?"
   - ✅ BIEN: "¿Cómo se relaciona la mitosis con el crecimiento celular?"

   PREGUNTAS DE APLICACIÓN (skill: "application", type: "case_application"):
   - DEBE presentar un ESCENARIO CONCRETO con datos/números/situación específica.
   - El estudiante debe DECIDIR, CALCULAR, ELEGIR o PREDECIR — no definir.
   - Incluye todos los datos necesarios DENTRO del prompt.
   - ❌ MAL: "¿Cómo aplicarías la primera ley de Newton?"
   - ❌ MAL: "Aplica el concepto de fotosíntesis."
   - ✅ BIEN: "Un automóvil de 1200kg viaja a 60 km/h y frena de golpe. Sin cinturón, ¿qué le sucede al pasajero según la primera ley de Newton? Justifica."
   - ✅ BIEN: "Una planta lleva 3 días en oscuridad y sus hojas amarillean. Basándote en la fotosíntesis, explica qué le ocurre y por qué."

4. VARIACIÓN:
   - Cada pregunta evalúa un ÁNGULO DISTINTO.
   - Las preguntas deben sentirse como un examen universitario real y exigente.
   - Para multiple_choice, los distractores deben ser plausibles PERO claramente incorrectos si conoces el material.
   - Para fill_blank, el wordBank debe compartir género/número con la respuesta correcta.
   - NUNCA repitas la misma redacción ni preguntes dos veces sobre el mismo hecho.

${typeSpec}

Devuelve SOLO JSON válido:
{ "questions": [ {
  "id":"...","section":"...","type":"...","prompt":"...","points":number,
  "expectedAnswer":"...","rubricHints":[...],"skill":"retention|comprehension|application|relation|explanation|critical_thinking",
  "difficulty":"basic|medium|advanced",
  "sourceMaterial":"...","sourceMaterialName":"...","sourcePage":number|null,
  ...campos específicos del tipo
} ] }

Materia: ${materia}
Tema: ${tema}

TAREAS (lote ${batchNum}/${totalBatches}):
${batch.map((s, i) => `
#${i + 1}
- Sección: ${s.section}
- Tipo: ${s.type}
- Hecho fuente: "${s.fact.text}"
- ID Material: ${s.fact.materialId}
- Nombre material: ${s.fact.materialName}
- Página: ${s.fact.page ?? 'null'}
`).join('\n')}`;

  try {
    const res = await alai({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.22,
      maxTokens: 4200,
      json: true,
    });

    const parsed = safeParseJson(res.text);
    const raw = Array.isArray(parsed?.questions) ? parsed.questions : [];

    const result: ExamQuestion[] = [];
    raw.forEach((q: any, idx: number) => {
      const slot = batch[idx] || batch[0];
      const mat = materialBlocks.find((b) => b.id === slot.fact.materialId);
      const sanitized = sanitizeQuestion(
        { ...q, section: slot.section, type: q.type || slot.type },
        slot.section,
        mat
      );
      if (sanitized) result.push(sanitized);
    });
    console.log(`✅ [Exam] Lote ${batchNum}/${totalBatches}: ${result.length}/${batch.length} válidas`);
    return result;
  } catch (err: any) {
    console.warn(`⚠️ [Exam] Lote ${batchNum} falló:`, err?.message || err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// EVALUATE
// ═══════════════════════════════════════════════════════════════

async function evaluateExam(body: any) {
  const exam: GeneratedExam | null = body.exam || null;
  const answers = Array.isArray(body.answers) ? body.answers : [];
  const confidences = Array.isArray(body.confidences) ? body.confidences : [];
  const materia = String(body.materia || '').trim();
  const tema = String(body.tema || '').trim();
  const materialText = String(body.materialText || '').slice(0, 14000);

  if (!exam || !Array.isArray(exam.questions)) {
    throw new Error('Examen inválido para evaluar.');
  }

  // Detectar preguntas respondidas vs vacías/saltadas
  const isAnsweredVal = (v: any) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length >= 1;
    if (typeof v === 'number' || typeof v === 'boolean') return true;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return false;
  };

  const objectiveResults = exam.questions.map((q, i) => {
    const userAnswer = answers[i];
    const answered = isAnsweredVal(userAnswer);
    let isCorrect: boolean | null = null;

    if (!answered) {
      isCorrect = false;
    } else if (q.type === 'multiple_choice') isCorrect = userAnswer === q.correctAnswer;
    else if (q.type === 'true_false') isCorrect = userAnswer === q.correctAnswer;
    else if (q.type === 'fill_blank') isCorrect = normalize(String(userAnswer || '')) === normalize(String(q.expectedAnswer || ''));
    else if (q.type === 'matching') {
      const pairs = q.pairs || [];
      const userMap = userAnswer && typeof userAnswer === 'object' ? userAnswer : {};
      const ok = pairs.filter((p, idx) => userMap[idx] === idx).length;
      isCorrect = ok === pairs.length;
    }

    return { index: i, isCorrect, userAnswer, question: q, answered };
  });

  const totalQuestions = exam.questions.length;
  const answeredCount = objectiveResults.filter(r => r.answered).length;
  const skippedCount = totalQuestions - answeredCount;

  const prompt = `Eres ALAI, corrector universitario serio de StudyAL.

CRÍTICO — REGLAS DE CÁLCULO DEL SCORE:
- El examen tiene ${totalQuestions} preguntas en total y ${exam.totalPoints} puntos posibles.
- El estudiante respondió ${answeredCount} de ${totalQuestions}.
- Las preguntas no respondidas/saltadas valen 0 pts y CUENTAN para el total.
- "score" es el porcentaje sobre los ${exam.totalPoints} pts posibles (sobre el 100%, no sobre lo que respondió).
- Si saltó muchas preguntas, su score debe reflejar eso (penalización real).

Devuelve SOLO JSON válido con este esquema EXACTO:
{
  "score": 0-100,
  "earnedPoints": number,
  "totalPoints": ${exam.totalPoints},
  "answeredCount": ${answeredCount},
  "skippedCount": ${skippedCount},
  "skillScores": {
    "retention": 0-100,
    "comprehension": 0-100,
    "application": 0-100,
    "relation": 0-100,
    "explanation": 0-100,
    "critical_thinking": 0-100
  },
  "perQuestion": [
    {"index": 0, "correct": true|false, "partialScore": 0-100, "earnedPoints": number, "feedback": "...", "modelAnswer": "..."}
  ],
  "strengths": ["...","..."],
  "weaknesses": ["...","..."],
  "masteredConcepts": ["..."],
  "weakConcepts": ["..."],
  "weakPages": [numbers],
  "passProbability": 0-100,
  "gradeProbabilities": {
    "A": 0-100,
    "B": 0-100,
    "C": 0-100,
    "fail": 0-100
  },
  "calibrationInsight": "frase corta sobre auto-conocimiento del estudiante",
  "recommendation": "texto claro y específico",
  "recoveryPlan": [
    {"title":"...","detail":"..."}
  ]
}

Materia: ${materia}
Tema: ${tema}

Material de referencia (resumido):
${materialText}

Preguntas, respuestas esperadas, respuestas del estudiante y confianza declarada:
${exam.questions.map((q, i) => `
#${i + 1} (${q.type}, skill=${q.skill}, sección=${q.section}, ${q.points}pts, page=${q.sourcePage ?? 'n/a'})
Prompt: ${q.prompt}
${q.options ? `Opciones: ${q.options.map((o, idx) => `${idx}=${o}`).join(' | ')}` : ''}
${q.pairs ? `Pares correctos: ${q.pairs.map((p) => `${p.left}→${p.right}`).join(' | ')}` : ''}
Respuesta esperada: ${q.expectedAnswer || '(abierta)'}
Respuesta estudiante: ${objectiveResults[i].answered ? JSON.stringify(answers[i]) : '(SALTADA / SIN RESPONDER)'}
Confianza declarada: ${confidences[i] || 'no marcada'}
${objectiveResults[i].isCorrect !== null ? `Auto-grade objetivo: ${objectiveResults[i].isCorrect ? 'CORRECTA' : 'INCORRECTA'}` : ''}
`).join('\n')}

Reglas estrictas:
1. score = (earnedPoints / ${exam.totalPoints}) * 100, redondeado.
2. Preguntas SALTADAS = 0 pts y partialScore=0. NO inventes feedback positivo para saltadas.
3. Usa auto-grade objetivo cuando esté presente para multiple_choice, true_false, fill_blank, matching.
4. Para abiertas (short_answer, open_response, case_application): evalúa semánticamente contra material + expectedAnswer + rubricHints. Sé estricto pero justo. partialScore puede ser 0, 40, 60, 80, 100 según calidad.
5. earnedPoints por pregunta = round(partialScore/100 * q.points).
6. skillScores: promedio de partialScore por skill (incluyendo 0s de saltadas si aplica a esa skill).
7. weakPages: páginas de preguntas que falló o saltó.
8. calibrationInsight: analiza si el estudiante sabe cuándo sabe (correctas+seguras = bien) o tiene ilusión de saber (incorrectas+seguras = peligroso). Frase breve y útil.
9. passProbability: 70+ = probable aprobar; <50 = riesgo alto.
10. gradeProbabilities: distribución realista. Si score=85 → A:60, B:35, C:5, fail:0 aprox.
11. recoveryPlan: 3-5 pasos concretos enfocados en weakSkills + weakConcepts.`;

  const res = await alai({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.12,
    maxTokens: 3600,
    json: true,
  });

  const parsed = safeParseJson(res.text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ALAI no pudo corregir el examen.');
  }

  return parsed;
}

// ═══════════════════════════════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// ADAPT — genera N preguntas adicionales adaptadas al rendimiento
// ═══════════════════════════════════════════════════════════════

async function adaptExam(body: any) {
  const exam: GeneratedExam | null = body.exam || null;
  const answeredQuestions: ExamQuestion[] = Array.isArray(body.answeredQuestions) ? body.answeredQuestions : [];
  const skillPerformance: Record<string, { correct: number; total: number }> = body.skillPerformance || {};
  const recentCorrectRate = Number(body.recentCorrectRate) || 0.5;
  const materialText = String(body.materialText || '').trim();
  const materia = String(body.materia || '').trim();
  const tema = String(body.tema || '').trim();
  const count = Math.max(1, Math.min(Number(body.count) || 3, 6));
  const askedPrompts: string[] = Array.isArray(body.askedPrompts) ? body.askedPrompts : [];

  if (!materialText) throw new Error('Sin material para adaptar.');

  const lang = detectLanguage(materialText);
  const materialBlocks = parseMaterialBlocks(materialText);
  const facts = await extractFacts(materialBlocks, lang);
  if (!facts.length) throw new Error('Sin hechos para adaptar.');

  // Determinar skills débiles
  const weakSkills: Skill[] = [];
  for (const [s, perf] of Object.entries(skillPerformance)) {
    if (perf.total >= 2 && perf.correct / perf.total < 0.6) weakSkills.push(s as Skill);
  }

  // Determinar dificultad adaptativa
  let targetDifficulty: Difficulty = 'medium';
  if (recentCorrectRate > 0.85) targetDifficulty = 'advanced';
  else if (recentCorrectRate < 0.45) targetDifficulty = 'basic';

  // Filtrar facts ya usados (evita repetición)
  const usedFactKeys = new Set(askedPrompts.map((p) => normalize(p).slice(0, 60)));
  const freshFacts = facts.filter((f) => !usedFactKeys.has(normalize(f.text).slice(0, 60)));
  const poolFacts = freshFacts.length >= count ? freshFacts : facts;

  // Priorizar facts no usados
  const shuffled = [...poolFacts].sort(() => Math.random() - 0.5);
  const selectedFacts = shuffled.slice(0, count);

  // Asignar tipo y sección según skills débiles
  const slots: { section: string; sectionId: string; type: QuestionType; fact: ExtractedFact }[] = [];
  const typesByWeakSkill: Record<Skill, QuestionType[]> = {
    retention: ['fill_blank', 'true_false'],
    comprehension: ['multiple_choice', 'short_answer'],
    application: ['case_application'],
    relation: ['matching', 'multiple_choice'],
    explanation: ['short_answer', 'open_response'],
    critical_thinking: ['open_response'],
  };

  for (let i = 0; i < selectedFacts.length; i++) {
    const fact = selectedFacts[i];
    const skill = weakSkills.length ? weakSkills[i % weakSkills.length] : 'comprehension';
    const types = typesByWeakSkill[skill];
    const type = types[Math.floor(Math.random() * types.length)];
    const section = SECTIONS.find((sec) => sec.skill === skill)?.title || 'II. Comprensión';
    slots.push({ section, sectionId: 'A', type, fact });
  }

  const newQuestions = await processBatch(slots, materia, tema, lang, materialBlocks, 1, 1);

  // Dedupe contra preguntas ya hechas
  const finalNew = newQuestions.filter((nq) => {
    const key = normalize(nq.prompt).slice(0, 80);
    return !askedPrompts.some((ap) => normalize(ap).slice(0, 80) === key);
  }).map((nq) => ({ ...nq, difficulty: targetDifficulty }));

  return {
    newQuestions: finalNew,
    weakSkills,
    targetDifficulty,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = String(body.mode || 'generate');

    if (mode === 'evaluate') {
      const evaluation = await evaluateExam(body);
      return NextResponse.json({ success: true, evaluation });
    }

    if (mode === 'adapt') {
      const result = await adaptExam(body);
      return NextResponse.json({ success: true, ...result });
    }

    const materialText = String(body.materialText || body.content || '').trim();
    const durationMinutes = Math.max(5, Math.min(Number(body.durationMinutes) || 30, 120));
    const materia = String(body.materia || '').trim();
    const tema = String(body.tema || '').trim();
    const masteryContext = body.masteryContext || null;
    const selectedPages = Array.isArray(body.selectedPages)
      ? body.selectedPages.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];

    if (!materialText) {
      return NextResponse.json({ success: false, error: 'Texto vacío.' }, { status: 400 });
    }

    const { exam, recommendedMinutes } = await generateExam(materialText, durationMinutes, materia, tema, selectedPages, masteryContext);

    return NextResponse.json({
      success: true,
      recommendedMinutes,
      exam,
    });
  } catch (error: any) {
    console.error('[ALAI Exam API]', error?.message || error);
    return NextResponse.json({ success: false, error: error?.message || 'Error interno' }, { status: 500 });
  }
}
