import { NextRequest, NextResponse } from 'next/server';
import { alai, safeParseJson } from '../../../lib/alai';
import { detectLanguage } from '../../../lib/detectLanguage';
import { generateValidatedLegacyJson } from '../../../lib/ai/legacyRouteGeneration';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

type CardType =
  | 'cheat_code'
  | 'ejemplo_click'
  | 'analogia'
  | 'error_clasico'
  | 'examen_tip'
  | 'palabras_gatillo'
  | 'no_confundir'
  | 'regla_oro'
  | 'solo_una_cosa'
  | 'cadena_logica'
  | 'como_piensa_alai'
  | 'combo'
  | 'dato_inesperado'
  | 'respuesta_perfecta'
  | 'trampa_examen'
  | 'feynman'
  | 'diez_segundos'
  | 'cinco_segundos'
  | 'si_yo_fuera_tu'
  | 'tesis_central'
  | 'premisa_clave'
  | 'como_defender'
  | 'linea_causal'
  | 'figura_clave'
  | 'antes_despues'
  | 'momento_decisivo';

type MaterialMode = 'tecnico' | 'historico' | 'argumentativo' | 'mixto';
type CardStage = 'entiende' | 'recuerda' | 'no_confundas' | 'examen';
type VariantAction = 'another_trick' | 'another_analogy' | 'simple';

interface MaterialBlock {
  id: string;
  name: string;
  text: string;
}

interface MaterialProfile {
  mode: MaterialMode;
  modeReason: string;
  keyEntities: string[];
  specificFacts: string[];
  possibleConfusions: string[];
  examAngles: string[];
  thesis?: string;
  mainArguments?: string[];
  keyEvents?: string[];
  lang: 'es' | 'en';
}

interface RawCard {
  id: string;
  type: CardType;
  stage: CardStage;
  title: string;
  concept: string;
  content: string;
  difficulty: number;
  forgetRisk: number;
  sourceMaterial: string;
  sourceMaterialName: string;
  sourcePages: number[];
  tags: string[];
}

interface ProfessorAdvice {
  title: string;
  bullets: string[];
  closing?: string;
}

const ALLOWED_TYPES: CardType[] = [
  'cheat_code',
  'ejemplo_click',
  'analogia',
  'error_clasico',
  'examen_tip',
  'palabras_gatillo',
  'no_confundir',
  'regla_oro',
  'solo_una_cosa',
  'cadena_logica',
  'como_piensa_alai',
  'combo',
  'dato_inesperado',
  'respuesta_perfecta',
  'trampa_examen',
  'feynman',
  'diez_segundos',
  'cinco_segundos',
  'si_yo_fuera_tu',
  'tesis_central',
  'premisa_clave',
  'como_defender',
  'linea_causal',
  'figura_clave',
  'antes_despues',
  'momento_decisivo',
];

const DEFAULT_TITLES: Record<CardType, string> = {
  cheat_code: 'Truquito',
  ejemplo_click: 'El ejemplo que hace click',
  analogia: 'Analogía',
  error_clasico: 'Error clásico',
  examen_tip: 'Si esto sale en el examen',
  palabras_gatillo: 'Palabras gatillo',
  no_confundir: 'Cómo NO confundirlos',
  regla_oro: 'Regla de oro',
  solo_una_cosa: 'Si solo recuerdas una cosa',
  cadena_logica: 'Cadena lógica',
  como_piensa_alai: 'Cómo lo piensa ALAI',
  combo: 'Combo',
  dato_inesperado: 'Dato inesperado',
  respuesta_perfecta: 'Cómo responder perfecto',
  trampa_examen: 'Trampa del examen',
  feynman: 'Explícalo simple',
  diez_segundos: 'En 10 segundos',
  cinco_segundos: 'En 5 segundos',
  si_yo_fuera_tu: 'Si yo fuera tú',
  tesis_central: 'Tesis central',
  premisa_clave: 'Premisa clave',
  como_defender: 'Cómo defender este argumento',
  linea_causal: 'Línea causal',
  figura_clave: 'Figura clave',
  antes_despues: 'Antes vs Después',
  momento_decisivo: 'Momento decisivo',
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function cleanStr(v: any, max = 500) {
  return String(v || '').replace(/\r/g, '').trim().slice(0, max);
}

function cleanContent(v: any) {
  return String(v || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l: string) => l.trimEnd())
    .filter((l: string) => l.trim().length > 0)
    .join('\n')
    .trim()
    .slice(0, 1200);
}

function clamp15(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizePageArray(v: any): number[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(v.map(Number).filter((n) => Number.isFinite(n) && n > 0))
  ).sort((a, b) => a - b).slice(0, 8);
}

function normalizeStage(v: any): CardStage {
  const s = String(v || '').trim();
  if (s === 'entiende' || s === 'recuerda' || s === 'no_confundas' || s === 'examen') return s;
  return 'recuerda';
}

function parseMaterialBlocks(text: string): MaterialBlock[] {
  const blocks: MaterialBlock[] = [];
  const regex =
    /\[Material\s+\d+:\s*ID=([^|\]]+)\s*\|\s*([^|\]]+)[^\]]*\]\n([\s\S]*?)(?=\n\[Material\s+\d+:\s*ID=|$)/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const blockText = match[3].trim();
    if (blockText.length > 20) {
      blocks.push({
        id: match[1].trim(),
        name: match[2].trim(),
        text: blockText,
      });
    }
  }

  if (!blocks.length && text.trim().length > 20) {
    blocks.push({
      id: 'mat_default',
      name: 'Material',
      text: text.trim(),
    });
  }

  return blocks;
}

function splitIntoChunks(text: string, size = 2500): string[] {
  const chunks: string[] = [];
  let rem = text.trim();

  while (rem.length > 0) {
    if (rem.length <= size) {
      chunks.push(rem);
      break;
    }

    let cut = rem.lastIndexOf('\n\n', size);
    if (cut < size * 0.5) cut = rem.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;

    chunks.push(rem.slice(0, cut).trim());
    rem = rem.slice(cut).trim();
  }

  return chunks.filter(Boolean);
}

async function profileMaterial(
  sample: string,
  lang: 'es' | 'en',
  materia: string,
  tema: string
): Promise<MaterialProfile> {
  const prompt =
    lang === 'en'
      ? `You are classifying study material for a tool called "Truquitos".

Classify the material as:
- tecnico
- historico
- argumentativo
- mixto

Also extract:
- keyEntities
- specificFacts
- possibleConfusions
- examAngles
- thesis (if argumentative)
- mainArguments (if argumentative)
- keyEvents (if historical)

Return ONLY JSON:
{
  "mode": "tecnico|historico|argumentativo|mixto",
  "modeReason": "one short sentence",
  "keyEntities": [],
  "specificFacts": [],
  "possibleConfusions": [],
  "examAngles": [],
  "thesis": null,
  "mainArguments": null,
  "keyEvents": null
}

Subject: ${materia}
Topic: ${tema}

TEXT:
${sample}`
      : `Estás clasificando material de estudio para una herramienta llamada "Truquitos".

Clasifica el material como:
- tecnico
- historico
- argumentativo
- mixto

Además extrae:
- keyEntities
- specificFacts
- possibleConfusions
- examAngles
- thesis (si es argumentativo)
- mainArguments (si es argumentativo)
- keyEvents (si es histórico)

Devuelve SOLO JSON:
{
  "mode": "tecnico|historico|argumentativo|mixto",
  "modeReason": "una frase corta",
  "keyEntities": [],
  "specificFacts": [],
  "possibleConfusions": [],
  "examAngles": [],
  "thesis": null,
  "mainArguments": null,
  "keyEvents": null
}

Materia: ${materia}
Tema: ${tema}

TEXTO:
${sample}`;

  try {
    const res = await alai({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.05,
      maxTokens: 1600,
      json: true,
    });

    const parsed = safeParseJson(res.text);
    if (!parsed) throw new Error('parse failed');

    const mode = ['tecnico', 'historico', 'argumentativo', 'mixto'].includes(parsed.mode)
      ? parsed.mode as MaterialMode
      : 'mixto';

    return {
      mode,
      modeReason: cleanStr(parsed.modeReason, 200),
      keyEntities: Array.isArray(parsed.keyEntities)
        ? parsed.keyEntities.map((x: any) => cleanStr(x, 180)).filter(Boolean).slice(0, 20)
        : [],
      specificFacts: Array.isArray(parsed.specificFacts)
        ? parsed.specificFacts.map((x: any) => cleanStr(x, 260)).filter(Boolean).slice(0, 30)
        : [],
      possibleConfusions: Array.isArray(parsed.possibleConfusions)
        ? parsed.possibleConfusions.map((x: any) => cleanStr(x, 200)).filter(Boolean).slice(0, 15)
        : [],
      examAngles: Array.isArray(parsed.examAngles)
        ? parsed.examAngles.map((x: any) => cleanStr(x, 200)).filter(Boolean).slice(0, 15)
        : [],
      thesis: cleanStr(parsed.thesis, 280) || undefined,
      mainArguments: Array.isArray(parsed.mainArguments)
        ? parsed.mainArguments.map((x: any) => cleanStr(x, 220)).filter(Boolean).slice(0, 10)
        : undefined,
      keyEvents: Array.isArray(parsed.keyEvents)
        ? parsed.keyEvents.map((x: any) => cleanStr(x, 220)).filter(Boolean).slice(0, 10)
        : undefined,
      lang,
    };
  } catch {
    return {
      mode: 'mixto',
      modeReason: '',
      keyEntities: [],
      specificFacts: [],
      possibleConfusions: [],
      examAngles: [],
      lang,
    };
  }
}

function buildProfileContext(profile: MaterialProfile) {
  const parts = [
    `MODO: ${profile.mode}`,
    profile.modeReason ? `POR QUÉ: ${profile.modeReason}` : '',
    profile.keyEntities.length ? `ENTIDADES CLAVE: ${profile.keyEntities.slice(0, 10).join(' | ')}` : '',
    profile.specificFacts.length ? `HECHOS ESPECÍFICOS: ${profile.specificFacts.slice(0, 8).join(' | ')}` : '',
    profile.possibleConfusions.length ? `CONFUSIONES POSIBLES: ${profile.possibleConfusions.slice(0, 6).join(' | ')}` : '',
    profile.examAngles.length ? `ÁNGULOS DE EXAMEN: ${profile.examAngles.slice(0, 6).join(' | ')}` : '',
    profile.thesis ? `TESIS: ${profile.thesis}` : '',
    profile.mainArguments?.length ? `ARGUMENTOS PRINCIPALES: ${profile.mainArguments.slice(0, 5).join(' | ')}` : '',
    profile.keyEvents?.length ? `EVENTOS CLAVE: ${profile.keyEvents.slice(0, 5).join(' | ')}` : '',
  ].filter(Boolean);

  return parts.join('\n');
}

function buildPrompt(
  chunk: string,
  block: MaterialBlock,
  profile: MaterialProfile,
  isOnlyChunk: boolean,
  masteryCtx: any = null
) {
  const profileContext = buildProfileContext(profile);

  // Bloque adaptativo basado en el perfil del estudiante
  let adaptiveBlock = '';
  if (masteryCtx) {
    const parts: string[] = [];
    parts.push('PERFIL DEL ESTUDIANTE:');
    parts.push('Dominio general: ' + (masteryCtx.overallMastery ?? 0) + '%');
    if (masteryCtx.criticalConcepts?.length) {
      parts.push('CONCEPTOS CRITICOS (genera truquitos especialmente para estos): ' + masteryCtx.criticalConcepts.join(', '));
    }
    if (masteryCtx.weakConcepts?.length) {
      parts.push('CONCEPTOS DEBILES (prioriza truquitos para estos): ' + masteryCtx.weakConcepts.join(', '));
    }
    if (masteryCtx.repeatedMistakes?.length) {
      parts.push('ERRORES REPETIDOS (genera "no_confundir" y "error_clasico" para estos): ' + masteryCtx.repeatedMistakes.join(', '));
    }
    if (masteryCtx.illusionConcepts?.length) {
      parts.push('ILUSION DE CONOCIMIENTO (genera "trampa_examen" para estos): ' + masteryCtx.illusionConcepts.join(', '));
    }
    if (masteryCtx.strongConcepts?.length) {
      parts.push('CONCEPTOS DOMINADOS (no necesitan truquitos basicos, solo avanzados): ' + masteryCtx.strongConcepts.join(', '));
    }
    if (masteryCtx.forgettingRiskConcepts?.length) {
      parts.push('EN RIESGO DE OLVIDO (genera mnemotecnias y "solo_una_cosa" para estos): ' + masteryCtx.forgettingRiskConcepts.join(', '));
    }
    adaptiveBlock = parts.join('\n');
  }
  const qty = isOnlyChunk
    ? 'Genera entre 12 y 20 tarjetas si el material lo permite.'
    : 'Genera entre 6 y 12 tarjetas nuevas de este fragmento.';

  const adaptiveInstruction = adaptiveBlock
    ? '\n' + adaptiveBlock + '\n'
    : '';

  let priority = '';
  if (profile.mode === 'tecnico') {
    priority = `
TIPOS PRIORITARIOS:
- cheat_code
- palabras_gatillo
- no_confundir
- regla_oro
- cadena_logica
- error_clasico
- trampa_examen
- examen_tip
- feynman
- combo
- dato_inesperado`;
  } else if (profile.mode === 'historico') {
    priority = `
TIPOS PRIORITARIOS:
- linea_causal
- figura_clave
- antes_despues
- momento_decisivo
- no_confundir
- error_clasico
- examen_tip
- dato_inesperado
- regla_oro
- cadena_logica
- combo`;
  } else if (profile.mode === 'argumentativo') {
    priority = `
TIPOS PRIORITARIOS:
- tesis_central
- premisa_clave
- como_defender
- respuesta_perfecta
- error_clasico
- trampa_examen
- examen_tip
- no_confundir
- regla_oro
- ejemplo_click
- figura_clave
- combo
- como_piensa_alai`;
  } else {
    priority = `
TIPOS DISPONIBLES:
${ALLOWED_TYPES.join(', ')}`;
  }

  return `Eres ALAI.

No eres una IA genérica.
Eres un profesor brillante de 30 años que abrió su libreta secreta justo antes del examen.

NO des teoría extra.
NO resumas por resumir.
NO hagas párrafos largos.
NO uses conocimiento externo.
USA SOLO EL TEXTO.

OBJETIVO:
El estudiante debe pensar:
"Ahora sí sé cómo recordar esto"
y
"Ahora sí sé cómo responder esto"

REGLA DE PERSONALIDAD:
Cada tarjeta debe sonar más a consejo secreto de profesor que a tarjeta generada por IA.

REGLA DE SORPRESA:
Siempre que puedas, usa estructuras con alma:
- antes vs después
- error vs realidad
- si recuerdas A, recuerdas B
- si esto sale en examen, responde así
- imagina esto
- cuando dudes, piensa esto

REGLA DE NARRATIVA:
Cada tarjeta debe tener un STAGE:
- "entiende" → primero ubica la idea central
- "recuerda" → luego clava el dato o truco
- "no_confundas" → luego evita errores
- "examen" → finalmente aprende a responder

REGLA DE DIFICULTAD ADAPTATIVA:
- conceptos con difficulty 4 o 5 pueden recibir 2 o 3 tarjetas distintas
- conceptos con difficulty 1 o 2 normalmente solo necesitan 1 tarjeta
- prioriza lo más olvidable primero

REGLA DE ESPECIFICIDAD:
Cada tarjeta debe tener al menos un ancla real del texto:
- nombre
- fecha
- fórmula
- frase casi literal
- evento
- consecuencia
- contraste real del texto

Si una tarjeta podría servir para cualquier tema, recházala.

${priority}

REGLAS DE FORMATO:
- no_confundir y antes_despues: exactamente 3 líneas
- palabras_gatillo: una línea por gatillo en formato "A → B"
- cadena_logica y linea_causal y como_piensa_alai: un paso por línea, sin flechas en content
- respuesta_perfecta: estructura de respuesta, no teoría larga
- máximo 120 palabras por tarjeta
- ${qty}
- usa sourcePages si detectas [Pagina N] o [Page N]

Devuelve SOLO JSON:
{
  "cards": [
    {
      "id": "slug",
      "type": "cheat_code",
      "stage": "entiende",
      "title": "título corto",
      "concept": "concepto específico",
      "content": "contenido del truquito",
      "difficulty": 3,
      "forgetRisk": 4,
      "sourceMaterial": "${block.id}",
      "sourceMaterialName": "${block.name}",
      "sourcePages": [1],
      "tags": ["tag1"]
    }
  ]
}

PERFIL DEL MATERIAL:
${profileContext}

${adaptiveInstruction}

TEXTO:
${chunk}`;
}

async function generateCardsFromChunk(
  chunk: string,
  block: MaterialBlock,
  profile: MaterialProfile,
  isOnlyChunk: boolean,
  masteryCtx: any = null
): Promise<RawCard[]> {
  try {
    const raw = await generateValidatedLegacyJson<any[]>({
      taskType: 'session_content',
      prompt: buildPrompt(chunk, block, profile, isOnlyChunk, masteryCtx),
      temperature: 0.08,
      maxTokens: 4200,
      normalize: value => Array.isArray((value as any)?.cards) ? (value as any).cards : [],
      validate: value => {
        const cards = Array.isArray(value) ? value : []
        const errors: string[] = []
        if (!cards.length) errors.push('LOW_DIVERSITY:no_study_cards')
        const content = cards.map(card => cleanContent(card?.content).toLowerCase())
        if (new Set(content).size !== content.length) errors.push('SEMANTIC_DUPLICATION:study_cards')
        for (const card of cards) {
          if (!cleanContent(card?.content) || !cleanStr(card?.title, 120)) {
            errors.push('STRUCTURAL_VALIDATION_FAILED:invalid_study_card')
          }
        }
        return { valid: errors.length === 0, errors }
      },
      telemetryContext: { route: 'cheat_codes', phase: 'cards', materialId: block.id },
    })

    return raw.map((card: any): RawCard | null => {
      const type = cleanStr(card?.type, 40) as CardType;
      const safeType: CardType = ALLOWED_TYPES.includes(type) ? type : 'cheat_code';
      const content = cleanContent(card?.content);
      if (!content || content.length < 20) return null;

      const rawTitle = cleanStr(card?.title, 120);
      const rawConcept = cleanStr(card?.concept, 90);
      const firstContentLine = content.split('\n')[0].trim();
      const titleTooLong = rawTitle.length > 55;
      const titleIsContent =
        rawTitle.toLowerCase().slice(0, 50) === firstContentLine.toLowerCase().slice(0, 50);
      const titleIsGeneric = !rawTitle || titleTooLong || titleIsContent;
      const finalTitle = titleIsGeneric
        ? (rawConcept && rawConcept.length <= 50 ? rawConcept : DEFAULT_TITLES[safeType])
        : rawTitle;

      return {
        id: cleanStr(card?.id, 80) || uid(),
        type: safeType,
        stage: normalizeStage(card?.stage),
        title: finalTitle,
        concept: rawConcept,
        content,
        difficulty: clamp15(card?.difficulty),
        forgetRisk: clamp15(card?.forgetRisk),
        sourceMaterial: block.id,
        sourceMaterialName: block.name,
        sourcePages: normalizePageArray(card?.sourcePages),
        tags: Array.isArray(card?.tags)
          ? card.tags.map((t: any) => cleanStr(t, 40)).filter(Boolean).slice(0, 5)
          : [],
      };
    }).filter(Boolean) as RawCard[];
  } catch (err: any) {
    console.warn(`[Truquitos] chunk failed: ${err?.message?.slice(0, 100)}`);
    throw err;
  }
}

function deduplicateAndRank(cards: RawCard[]): RawCard[] {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/los|las|el|la|de|con|para|en|un|una|que|del|al|sobre|por|como/g, '')
      .replace(/\s+/g, '')
      .trim();

  const seenExact = new Set<string>();
  const conceptGroups = new Map<string, RawCard[]>();

  for (const card of cards) {
    const exactKey = `${card.type}__${normalize(card.content).slice(0, 80)}`;
    if (seenExact.has(exactKey)) continue;
    seenExact.add(exactKey);

    const axis = normalize(card.concept || card.title).slice(0, 50) || normalize(card.content).slice(0, 50);
    if (!conceptGroups.has(axis)) conceptGroups.set(axis, []);
    conceptGroups.get(axis)!.push(card);
  }

  const diverse: RawCard[] = [];

  for (const [, group] of conceptGroups.entries()) {
    group.sort((a, b) => (b.forgetRisk + b.difficulty) - (a.forgetRisk + a.difficulty));
    const top = group[0];
    const limit = (top.difficulty + top.forgetRisk >= 8) ? 2 : 1;

    const pickedTypes = new Set<string>();
    for (const card of group) {
      if (pickedTypes.has(card.type)) continue;
      diverse.push(card);
      pickedTypes.add(card.type);
      if (pickedTypes.size >= limit) break;
    }
  }

  const stageScore = (c: RawCard) => {
    const base = c.forgetRisk + c.difficulty;
    const stageBonus = c.stage === 'entiende' ? 3 : c.stage === 'recuerda' ? 2 : c.stage === 'no_confundas' ? 2 : 1;
    return base + stageBonus;
  };

  const byStage = {
    entiende: diverse.filter(c => c.stage === 'entiende').sort((a, b) => stageScore(b) - stageScore(a)),
    recuerda: diverse.filter(c => c.stage === 'recuerda').sort((a, b) => stageScore(b) - stageScore(a)),
    no_confundas: diverse.filter(c => c.stage === 'no_confundas').sort((a, b) => stageScore(b) - stageScore(a)),
    examen: diverse.filter(c => c.stage === 'examen').sort((a, b) => stageScore(b) - stageScore(a)),
  };

  const final: RawCard[] = [];
  final.push(...byStage.entiende.slice(0, 4));
  final.push(...byStage.recuerda.slice(0, 4));
  final.push(...byStage.no_confundas.slice(0, 3));
  final.push(...byStage.examen.slice(0, 3));

  const used = new Set(final.map(c => c.id));
  const remaining = diverse
    .filter(c => !used.has(c.id))
    .sort((a, b) => stageScore(b) - stageScore(a));

  while (final.length < 14 && remaining.length) {
    final.push(remaining.shift()!);
  }

  return final.slice(0, 14);
}

async function buildProfessorAdvice(
  cards: RawCard[],
  profile: MaterialProfile
): Promise<ProfessorAdvice | null> {
  const lang = profile.lang;

  const prompt =
    lang === 'en'
      ? `You are ALAI. Write the final section:
"What a professor would tell you 5 minutes before the exam."

Do NOT explain theory.
Do give concrete advice.
Base yourself ONLY on these cards.

Return ONLY JSON:
{
  "title": "What a professor would tell you before the exam",
  "bullets": ["...", "...", "..."],
  "closing": "one short final line"
}

Cards:
${JSON.stringify(cards.slice(0, 8), null, 2)}`
      : `Eres ALAI. Escribe la sección final:
"Lo que un profesor te diría 5 minutos antes del examen".

NO expliques teoría.
SÍ da consejos concretos.
Básate SOLO en estas tarjetas.

Devuelve SOLO JSON:
{
  "title": "Lo que un profesor te diría antes del examen",
  "bullets": ["...", "...", "..."],
  "closing": "una línea final corta"
}

Tarjetas:
${JSON.stringify(cards.slice(0, 8), null, 2)}`;

  try {
    const res = await alai({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.12,
      maxTokens: 800,
      json: true,
    });

    const parsed = safeParseJson(res.text);
    if (!parsed) return null;

    return {
      title: cleanStr(parsed.title, 120) || 'Lo que un profesor te diría antes del examen',
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets.map((x: any) => cleanStr(x, 220)).filter(Boolean).slice(0, 4)
        : [],
      closing: cleanStr(parsed.closing, 220) || undefined,
    };
  } catch {
    return null;
  }
}

async function generateVariantCard(params: {
  materialText: string;
  card: RawCard;
  action: VariantAction;
  lang: 'es' | 'en';
}) {
  const actionInstruction =
    params.action === 'another_trick'
      ? (params.lang === 'en'
          ? `Generate ONE alternative memory trick for the same concept. Prefer type = cheat_code, combo or palabras_gatillo.`
          : `Genera UN truquito alternativo para el mismo concepto. Prefiere type = cheat_code, combo o palabras_gatillo.`)
      : params.action === 'another_analogy'
        ? (params.lang === 'en'
            ? `Generate ONE alternative analogy for the same concept. Prefer type = analogia.`
            : `Genera UNA analogía alternativa para el mismo concepto. Prefiere type = analogia.`)
        : (params.lang === 'en'
            ? `Generate ONE ultra-simple version as if explaining to a child. Prefer type = feynman.`
            : `Genera UNA versión ultra simple como si se lo explicaras a un niño. Prefiere type = feynman.`);

  const prompt =
    params.lang === 'en'
      ? `You are ALAI. ${actionInstruction}

Use ONLY the material below.
Do not invent.
Do not repeat the exact same wording.

Return ONLY JSON:
{
  "card": {
    "id": "slug",
    "type": "cheat_code",
    "stage": "recuerda",
    "title": "short title",
    "concept": "${params.card.concept}",
    "content": "new content",
    "difficulty": ${params.card.difficulty},
    "forgetRisk": ${params.card.forgetRisk},
    "sourceMaterial": "${params.card.sourceMaterial}",
    "sourceMaterialName": "${params.card.sourceMaterialName}",
    "sourcePages": ${JSON.stringify(params.card.sourcePages)},
    "tags": ${JSON.stringify(params.card.tags || [])}
  }
}

Original card:
${JSON.stringify(params.card, null, 2)}

Material:
${params.materialText.slice(0, 12000)}`
      : `Eres ALAI. ${actionInstruction}

Usa SOLO el material de abajo.
No inventes.
No repitas exactamente la misma redacción.

Devuelve SOLO JSON:
{
  "card": {
    "id": "slug",
    "type": "cheat_code",
    "stage": "recuerda",
    "title": "título corto",
    "concept": "${params.card.concept}",
    "content": "contenido nuevo",
    "difficulty": ${params.card.difficulty},
    "forgetRisk": ${params.card.forgetRisk},
    "sourceMaterial": "${params.card.sourceMaterial}",
    "sourceMaterialName": "${params.card.sourceMaterialName}",
    "sourcePages": ${JSON.stringify(params.card.sourcePages)},
    "tags": ${JSON.stringify(params.card.tags || [])}
  }
}

Tarjeta original:
${JSON.stringify(params.card, null, 2)}

Material:
${params.materialText.slice(0, 12000)}`;

  const res = await alai({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    maxTokens: 900,
    json: true,
  });

  const parsed = safeParseJson(res.text);
  const card = parsed?.card;
  if (!card) return null;

  const safeType: CardType = ALLOWED_TYPES.includes(card.type) ? card.type : 'cheat_code';
  const content = cleanContent(card.content);
  if (!content) return null;

  return {
    id: cleanStr(card.id, 80) || uid(),
    type: safeType,
    stage: normalizeStage(card.stage),
    title: cleanStr(card.title, 120) || DEFAULT_TITLES[safeType],
    concept: cleanStr(card.concept, 90),
    content,
    difficulty: clamp15(card.difficulty),
    forgetRisk: clamp15(card.forgetRisk),
    sourceMaterial: cleanStr(card.sourceMaterial, 120) || params.card.sourceMaterial,
    sourceMaterialName: cleanStr(card.sourceMaterialName, 180) || params.card.sourceMaterialName,
    sourcePages: normalizePageArray(card.sourcePages?.length ? card.sourcePages : params.card.sourcePages),
    tags: Array.isArray(card.tags)
      ? card.tags.map((t: any) => cleanStr(t, 40)).filter(Boolean).slice(0, 5)
      : params.card.tags || [],
  } satisfies RawCard;
}

async function generateAllCards(blocks: MaterialBlock[], profile: MaterialProfile, masteryCtx: any = null): Promise<RawCard[]> {
  const all: RawCard[] = [];

  await Promise.all(
    blocks.map(async (block) => {
      const chunks = splitIntoChunks(block.text, 2500);
      const PARALLEL = 3;

      for (let i = 0; i < chunks.length; i += PARALLEL) {
        const batch = chunks.slice(i, i + PARALLEL);
        const results = await Promise.all(
          batch.map((chunk) =>
            generateCardsFromChunk(chunk, block, profile, chunks.length === 1, masteryCtx)
              .catch(() => [] as RawCard[])
          )
        );
        results.forEach((list) => all.push(...list));
      }
    })
  );

  return all;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode = String(body.mode || '').trim();

    if (mode === 'variant') {
      const materialText = String(body.materialText || '').trim();
      const card = body.card as RawCard;
      const action = String(body.action || 'another_trick') as VariantAction;

      if (!materialText || !card) {
        return NextResponse.json({ success: false, error: 'Faltan datos para generar variante.' }, { status: 400 });
      }

      const lang = detectLanguage(materialText) === 'en' ? 'en' : 'es';
      const variant = await generateVariantCard({ materialText, card, action, lang });

      if (!variant) {
        return NextResponse.json({ success: false, error: 'No se pudo generar otra versión.' }, { status: 500 });
      }

      return NextResponse.json({ success: true, card: variant });
    }

    const materialText = String(body.materialText || '').trim();
    const materia = String(body.materia || '').trim();
    const tema = String(body.tema || '').trim();
    const masteryContext = body.masteryContext || null;

    if (!materialText) {
      return NextResponse.json({ success: false, error: 'Material vacío.' }, { status: 400 });
    }

    const lang = detectLanguage(materialText) === 'en' ? 'en' : 'es';
    const blocks = parseMaterialBlocks(materialText);

    if (!blocks.length) {
      return NextResponse.json({ success: false, error: 'No se pudo leer el material.' }, { status: 400 });
    }

    const profileSample = blocks.map((b) => b.text).join('\n\n').slice(0, 6000);
    const profile = await profileMaterial(profileSample, lang, materia, tema);

    console.log(`✨ [Truquitos] Bloques: ${blocks.length} | Modo: ${profile.mode}`);

    const rawCards = await generateAllCards(blocks, profile, masteryContext);
    console.log(`✨ [Truquitos] Raw: ${rawCards.length}`);

    const cards = deduplicateAndRank(rawCards);
    console.log(`✨ [Truquitos] Final: ${cards.length}`);

    if (!cards.length) {
      return NextResponse.json(
        { success: false, error: 'No se pudieron generar Truquitos con este material.' },
        { status: 500 }
      );
    }

    const professorAdvice = await buildProfessorAdvice(cards, profile);

    return NextResponse.json({
      success: true,
      cards,
      professorAdvice,
      meta: {
        blocks: blocks.length,
        lang,
        mode: profile.mode,
        rawCount: rawCards.length,
      },
    });
  } catch (error: any) {
    console.error('[Truquitos API]', error?.message || error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error interno.' },
      { status: 500 }
    );
  }
}
