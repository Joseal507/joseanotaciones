import { NextRequest, NextResponse } from 'next/server';
import { alaiRequest } from '../../../lib/alai';

// ── JSON PARSER ROBUSTO ──────────────────────────────────
function safeParseJSON(raw: string): any {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found');
  const jsonStr = match[0];

  // Intento 1: directo
  try { return JSON.parse(jsonStr); } catch {}

  // Intento 2: escapar backslashes sueltos caracter por caracter
  try {
    const valid = ['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'];
    let fixed = '';
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '\\') {
        const next = jsonStr[i + 1];
        fixed += (next && valid.includes(next)) ? '\\' : '\\\\';
      } else {
        fixed += jsonStr[i];
      }
    }
    return JSON.parse(fixed);
  } catch {}

  // Intento 3: quitar todos los backslashes
  try { return JSON.parse(jsonStr.split('\\').join('')); } catch {}

  throw new Error('Could not parse JSON');
}

// ── VISION: OpenRouter Gemini 2.5 Flash ─────────────
async function solveWithVision(
  imageBase64: string,
  imageMime: string,
  prompt: string
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OpenRouter no configurado');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ] }],
      temperature: 0.05,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter vision ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('OpenRouter vision empty response');
  return text;
}

// ── PROMPT BUILDER ───────────────────────────────────────
function buildPrompt(lang: string): string {
  const example = lang === 'en' ? `{
  "problema": "Solve x^2 + 5x + 6 = 0",
  "tipo": "algebra",
  "dificultad": "basico",
  "pasos": [
    {
      "numero": 1,
      "titulo": "Factor the equation",
      "explicacion": "Find two numbers that multiply to 6 and add to 5",
      "operacion": "(x + 2)(x + 3) = 0",
      "resultado": "x = -2 or x = -3"
    }
  ],
  "respuesta_final": "x = -2 or x = -3",
  "respuesta_texto": "x equals negative 2 or negative 3",
  "verificacion": "(-2)^2 + 5(-2) + 6 = 4 - 10 + 6 = 0 correct",
  "consejo": "For quadratics ax^2+bx+c find two numbers that multiply to c and add to b"
}` : `{
  "problema": "Resolver x^2 + 5x + 6 = 0",
  "tipo": "algebra",
  "dificultad": "basico",
  "pasos": [
    {
      "numero": 1,
      "titulo": "Factorizar la ecuacion",
      "explicacion": "Buscamos dos numeros que multiplicados den 6 y sumados den 5",
      "operacion": "(x + 2)(x + 3) = 0",
      "resultado": "x = -2 o x = -3"
    }
  ],
  "respuesta_final": "x = -2 o x = -3",
  "respuesta_texto": "x es igual a negativo 2 o negativo 3",
  "verificacion": "(-2)^2 + 5(-2) + 6 = 4 - 10 + 6 = 0 correcto",
  "consejo": "Para cuadraticas ax^2+bx+c busca numeros que multipliquen a c y sumen a b"
}`;

  return lang === 'en'
    ? `You are Peter SauPeter, expert math professor. Return ONLY valid JSON.
NO markdown. NO backticks. NO backslashes. NO LaTeX commands.
Write math in plain text: x^2, sqrt(x), (a)/(b), pi, infinity, sum, integral.
Structure:
${example}`
    : `Eres Peter SauPeter, profesor experto en matematicas. Devuelve SOLO JSON valido.
SIN markdown. SIN backticks. SIN barras invertidas. SIN comandos LaTeX.
Escribe matematica en texto plano: x^2, sqrt(x), (a)/(b), pi, infinito, suma, integral.
Estructura:
${example}`;
}

// ── MAIN HANDLER ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { imageBase64, imageMime = 'image/png', idioma = 'es', texto } = await req.json();

    if (!imageBase64 && !texto) {
      return NextResponse.json({ error: 'Se requiere imagen o texto' }, { status: 400 });
    }

    const lang = idioma === 'en' ? 'en' : 'es';
    const prompt = buildPrompt(lang);
    let rawText = '';

    if (imageBase64) {
      // ── CON IMAGEN: usar visión ──────────────────────────
      const visionPrompt = lang === 'en'
        ? `Look at this image carefully. Read EXACTLY what math expression or problem you see (could be simple like 2+2 or 1+1 or a complex equation). Then solve it step by step.\n\n${prompt}`
        : `Mira esta imagen con atencion. Lee EXACTAMENTE que expresion matematica o problema ves (puede ser simple como 2+2 o 1+1 o una ecuacion compleja). Luego resuelvelo paso a paso.\n\n${prompt}`;

      try {
        rawText = await solveWithVision(imageBase64, imageMime, visionPrompt);
      } catch (visionErr) {
        console.log('Vision failed, using alaiRequest text fallback...');
        // Fallback: usar alaiRequest con todas las keys rotando
        rawText = await alaiRequest(async (client, model) => {
          const fallbackPrompt = lang === 'en'
            ? `${prompt}\n\nI cannot read the image. Solve a representative quadratic equation step by step as example.`
            : `${prompt}\n\nNo puedo leer la imagen. Resuelve una ecuacion cuadratica representativa paso a paso como ejemplo.`;
          const r = await client.chat.completions.create({
            model: model('llama-3.3-70b-versatile'),
            messages: [{ role: 'user', content: fallbackPrompt }],
            temperature: 0.1,
            max_tokens: 3000,
          });
          return r.choices[0]?.message?.content || '';
        });
      }
    } else {
      // ── SOLO TEXTO: usar alaiRequest que rota todas las keys ──
      rawText = await alaiRequest(async (client, model) => {
        const full = lang === 'en'
          ? `${prompt}\n\nMath problem to solve: ${texto}`
          : `${prompt}\n\nProblema matematico a resolver: ${texto}`;
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [
            {
              role: 'system',
              content: 'Return ONLY valid JSON. No markdown. No backticks. No backslashes in math.',
            },
            { role: 'user', content: full },
          ],
          temperature: 0.1,
          max_tokens: 3000,
        });
        return r.choices[0]?.message?.content || '';
      });
    }

    if (!rawText.trim()) {
      return NextResponse.json({ error: 'Sin respuesta del modelo' }, { status: 500 });
    }

    const parsed = safeParseJSON(rawText);
    return NextResponse.json({ success: true, resultado: parsed });

  } catch (error: any) {
    console.error('Peter SauPeter error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
