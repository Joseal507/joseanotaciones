import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/groqClient';
import { detectLanguageFromMany } from '../../../lib/detectLanguage';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mensaje, contexto, historial, todosDocumentos, idioma, imageBase64, imageMime, nombreUsuario, enLlamada } = body;

    // Detectar idioma real del mensaje
    const detectarIdioma = (texto: string): 'en' | 'es' => {
      if (!texto || texto.length < 2) return idioma === 'en' ? 'en' : 'es';
      const t = texto.toLowerCase().trim();

      // Palabras clave EN inglés (muy comunes, cortas)
      const palabrasEn = [
        'hello','hi','hey','how','are','you','what','the','is','are','was','were',
        'have','has','this','that','with','from','they','which','when','where',
        'can','will','would','should','could','about','there','their','been',
        'good','great','help','me','my','i','do','does','did','need','want',
        'tell','explain','show','give','make','get','go','know','think','see',
        'please','thanks','thank','yes','no','ok','okay','sure','well','so',
        'a','an','of','in','to','for','on','at','by','or','and','but','if',
        'it','its','we','our','us','them','their','your','his','her','who',
        'why','not','just','now','also','then','than','more','some','any',
      ];

      // Palabras clave EN español
      const palabrasEs = [
        'hola','como','estas','qué','que','con','para','por','una','los','las',
        'del','está','son','como','pero','más','muy','todo','este','esta',
        'también','hacer','tiene','pueden','cuando','donde','porque','aunque',
        'se','lo','le','su','el','la','de','en','un','es','al','si','ya',
        'me','mi','tu','yo','él','ella','nos','vos','hay','fue','ser','estar',
        'bien','mal','hoy','aquí','ahí','así','más','menos','algo','nada',
        'puedo','quiero','necesito','ayuda','gracias','sí','no','bueno',
        'dame','dime','explícame','explica','cuál','cuáles','quién','cuándo',
      ];

      const words = t.split(/[\s,\.!?;:]+/).filter(w => w.length > 0);
      let enCount = 0, esCount = 0;

      words.forEach(w => {
        if (palabrasEn.includes(w)) enCount++;
        if (palabrasEs.includes(w)) esCount++;
      });

      // Si no encontramos nada, revisar caracteres especiales del español
      if (enCount === 0 && esCount === 0) {
        const tieneEspanol = /[áéíóúüñ¿¡]/i.test(t);
        if (tieneEspanol) return 'es';
        // Si tiene solo palabras en inglés puro sin acento, asumir inglés
        const soloAscii = /^[a-z0-9\s\.,!?'"-]+$/.test(t);
        if (soloAscii && t.length > 3) return 'en';
        return idioma === 'en' ? 'en' : 'es';
      }

      return enCount >= esCount ? 'en' : 'es';
    };

    // Detectar idioma del MENSAJE del usuario (no de la interfaz)
    const textoParaDetectar = mensaje || '';
    const lang: 'en' | 'es' = textoParaDetectar.length > 8
      ? detectarIdioma(textoParaDetectar)
      : (idioma === 'en' ? 'en' : 'es');

    // Extras según contexto
    const nombrePart = nombreUsuario
      ? (lang === 'en'
          ? ` You are talking to ${nombreUsuario}. Use their name naturally and warmly in your responses.`
          : ` Estás hablando con ${nombreUsuario}. Usa su nombre de forma natural y amigable en tus respuestas.`)
      : '';

    const llamadaPart = enLlamada
      ? (lang === 'en'
          ? ' VOICE CALL MODE: Respond as if on a real phone call. Be natural, fluid, friendly. NO lists, NO markdown, NO asterisks. Just plain conversational speech. Keep it short and clear.'
          : ' MODO LLAMADA DE VOZ: Responde como si estuvieras en una llamada real. Sé natural, fluido, amigable. NADA de listas, NADA de markdown, NADA de asteriscos. Solo habla normal como un pana. Sé breve y claro.')
      : '';

    const basePart = lang === 'en'
      ? 'You are El Chap, the AI of StudyAL. ALWAYS respond in ENGLISH regardless of any other instruction. NEVER use asterisks, markdown or special formatting. Speak in plain natural text. Be concise, direct and friendly.'
      : 'Eres El Chap, la inteligencia artificial de StudyAL. SIEMPRE responde en ESPAÑOL sin importar nada más. NUNCA uses asteriscos, markdown ni formato especial. Habla en texto plano y natural. Sé conciso, directo y cercano.';

    let systemPrompt = '';
    if (contexto) {
      const docPart = lang === 'en'
        ? ` ONLY respond based on this document. Do NOT invent information.

DOCUMENT:
${contexto.substring(0, 6000)}`
        : ` SOLO responde basándote en este documento. NO inventes información.

DOCUMENTO:
${contexto.substring(0, 6000)}`;
      systemPrompt = basePart + nombrePart + llamadaPart + docPart;
    } else if (todosDocumentos?.length > 0) {
      const docsTexto = todosDocumentos
        .slice(0, 5)
        .map((d: any) => `[${d.materia} - ${d.nombre}]:\n${d.contenido.substring(0, 1500)}`)
        .join('\n\n---\n\n');
      const docsPart = lang === 'en'
        ? ` You have access to the student's documents. Help them study effectively.

DOCUMENTS:
${docsTexto}`
        : ` Tienes acceso a los documentos del estudiante. Ayúdalo a estudiar de manera efectiva.

DOCUMENTOS:
${docsTexto}`;
      systemPrompt = basePart + nombrePart + llamadaPart + docsPart;
    } else {
      const generalPart = lang === 'en'
        ? ' Help with study questions, explain concepts clearly, give memorization tips and motivate the student.'
        : ' Ayuda con preguntas de estudio, explica conceptos con claridad, da consejos de memorización y motiva al estudiante.';
      systemPrompt = basePart + nombrePart + llamadaPart + generalPart;
    }

    const historialSlice = (historial || []).slice(-8).map((m: any) => ({ role: m.role, content: m.content }));

    // ── IMAGEN ──
    if (imageBase64 && imageMime) {
      const respuesta = await groqRequest(async (client, model) => {
        const res = await client.chat.completions.create({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: systemPrompt },
            ...historialSlice,
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
                { type: 'text', text: mensaje || (lang === 'en' ? 'Analyze this image.' : 'Analiza esta imagen.') },
              ],
            },
          ],
          temperature: 0.5,
          max_tokens: 1500,
        });
        return res.choices[0].message.content || '';
      });
      return NextResponse.json({ success: true, respuesta });
    }

    // ── CHAT NORMAL ──
    const respuesta = await groqRequest(async (client, model) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [
          { role: 'system', content: systemPrompt },
          ...historialSlice,
          { role: 'user', content: mensaje },
        ],
        temperature: 0.5,
        max_tokens: 1200,
      });
      return res.choices[0]?.message?.content || '';
    });

    return NextResponse.json({ success: true, respuesta });

  } catch (error: any) {
    console.error('Chat error:', error);
    if (error?.message === 'AI_EXHAUSTED') {
      return NextResponse.json({ success: false, error: 'AI_EXHAUSTED' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
