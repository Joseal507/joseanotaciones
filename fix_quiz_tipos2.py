from pathlib import Path

# ══════════════════════════════════════════════
# 1) API — forzar distribución de tipos
# ══════════════════════════════════════════════
api_path = Path("app/api/quiz/route.ts")
api_path.write_text(r"""
import { NextRequest, NextResponse } from 'next/server';
import { groqRequest } from '../../../lib/studyai';
import { detectContentLanguage } from '../../../lib/detectLanguage';

export const maxDuration = 60;

const NIVEL_CONFIG = {
  facil:      { es: 'FACIL: Preguntas directas de definicion y reconocimiento.', en: 'EASY: Direct definition and recognition questions.', temp: 0.3 },
  intermedio: { es: 'INTERMEDIO: Comprension y aplicacion de conceptos.', en: 'INTERMEDIATE: Comprehension and application.', temp: 0.4 },
  dificil:    { es: 'DIFICIL: Analisis, sintesis y casos especiales.', en: 'HARD: Analysis, synthesis and edge cases.', temp: 0.6 },
};

type TipoPregunta = 'multiple' | 'multiselect' | 'truefalse' | 'rellenar' | 'relacionar' | 'corta';

// Un prompt separado por tipo para forzar que genere exactamente ese tipo
function getPromptForType(tipo: TipoPregunta, lang: 'es' | 'en', count: number, nivelDesc: string): string {
  const n = count;
  if (tipo === 'multiple') {
    return lang === 'en'
      ? `Create exactly ${n} MULTIPLE CHOICE questions. Each has 4 options, only 1 correct. Mix correct position randomly (0,1,2,3).
Return JSON array: [{"tipo":"multiple","pregunta":"...","opciones":["a","b","c","d"],"correcta":0,"explicacion":"..."}]`
      : `Crea exactamente ${n} preguntas de OPCION MULTIPLE. Cada una tiene 4 opciones, solo 1 correcta. Mezcla la posicion correcta (0,1,2,3).
Devuelve array JSON: [{"tipo":"multiple","pregunta":"...","opciones":["a","b","c","d"],"correcta":0,"explicacion":"..."}]`;
  }
  if (tipo === 'multiselect') {
    return lang === 'en'
      ? `Create exactly ${n} MULTI-SELECT questions. Each has 4-5 options, with 2 or 3 correct answers. The field "correctas" is an array of correct indices.
Return JSON array: [{"tipo":"multiselect","pregunta":"Select ALL correct options: ...","opciones":["a","b","c","d","e"],"correctas":[0,2],"explicacion":"..."}]`
      : `Crea exactamente ${n} preguntas de SELECCION MULTIPLE (varias correctas). Cada una tiene 4-5 opciones, con 2 o 3 respuestas correctas. El campo "correctas" es un array de indices correctos.
Devuelve array JSON: [{"tipo":"multiselect","pregunta":"Selecciona TODAS las correctas: ...","opciones":["a","b","c","d","e"],"correctas":[0,2],"explicacion":"..."}]`;
  }
  if (tipo === 'truefalse') {
    return lang === 'en'
      ? `Create exactly ${n} TRUE OR FALSE questions. Each is a statement. "correcta": 0 means True, 1 means False. Make roughly half true and half false.
Return JSON array: [{"tipo":"truefalse","pregunta":"Statement here...","opciones":["True","False"],"correcta":0,"explicacion":"..."}]`
      : `Crea exactamente ${n} preguntas de VERDADERO O FALSO. Cada una es una afirmacion. "correcta": 0 = Verdadero, 1 = Falso. Haz aproximadamente mitad verdaderas y mitad falsas.
Devuelve array JSON: [{"tipo":"truefalse","pregunta":"Afirmacion aqui...","opciones":["Verdadero","Falso"],"correcta":0,"explicacion":"..."}]`;
  }
  if (tipo === 'rellenar') {
    return lang === 'en'
      ? `Create exactly ${n} FILL IN THE BLANK questions. Replace ONE key word/phrase with "___". Include a "wordBank" array with 4-5 options (the correct answer + 3-4 distractors, shuffled). "respuesta" is the correct word.
Return JSON array: [{"tipo":"rellenar","pregunta":"The ___ is the process...","respuesta":"photosynthesis","wordBank":["osmosis","photosynthesis","mitosis","respiration"],"explicacion":"..."}]`
      : `Crea exactamente ${n} preguntas de RELLENAR EL ESPACIO. Reemplaza UNA palabra/frase clave con "___". Incluye un "wordBank" array con 4-5 opciones (la correcta + 3-4 distractores, mezclados). "respuesta" es la palabra correcta.
Devuelve array JSON: [{"tipo":"rellenar","pregunta":"La ___ es el proceso...","respuesta":"fotosintesis","wordBank":["osmosis","fotosintesis","mitosis","respiracion"],"explicacion":"..."}]`;
  }
  if (tipo === 'relacionar') {
    return lang === 'en'
      ? `Create exactly ${n} MATCHING questions. Each has exactly 4 pairs. "izquierda" and "derecha" are arrays of 4 items. "derecha" must be SHUFFLED (not same order as izquierda). "pares[i]" means izquierda[i] matches derecha[pares[i]].
Return JSON array: [{"tipo":"relacionar","pregunta":"Match each concept:","izquierda":["A","B","C","D"],"derecha":["def2","def4","def1","def3"],"pares":[2,0,3,1],"explicacion":"..."}]`
      : `Crea exactamente ${n} preguntas de RELACIONAR COLUMNAS. Cada una tiene exactamente 4 pares. "izquierda" y "derecha" son arrays de 4 items. "derecha" DEBE estar MEZCLADA. "pares[i]" indica que izquierda[i] corresponde a derecha[pares[i]].
Devuelve array JSON: [{"tipo":"relacionar","pregunta":"Relaciona cada concepto:","izquierda":["A","B","C","D"],"derecha":["def2","def4","def1","def3"],"pares":[2,0,3,1],"explicacion":"..."}]`;
  }
  if (tipo === 'corta') {
    return lang === 'en'
      ? `Create exactly ${n} SHORT ANSWER questions. "palabrasClave" are 3-5 key terms expected in a correct answer. "respuestaModelo" is a full model answer.
Return JSON array: [{"tipo":"corta","pregunta":"Briefly explain...","palabrasClave":["term1","term2","term3"],"respuestaModelo":"Full answer...","explicacion":"..."}]`
      : `Crea exactamente ${n} preguntas de RESPUESTA CORTA. "palabrasClave" son 3-5 terminos clave esperados en la respuesta. "respuestaModelo" es la respuesta modelo completa.
Devuelve array JSON: [{"tipo":"corta","pregunta":"Explica brevemente...","palabrasClave":["termino1","termino2","termino3"],"respuestaModelo":"Respuesta completa...","explicacion":"..."}]`;
  }
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count = 10, idioma, nivel = 'intermedio', tipos = ['multiple'] } = body;

    const lang = detectContentLanguage(content, idioma === 'en' ? 'en' : 'es');
    const cfg = NIVEL_CONFIG[nivel as keyof typeof NIVEL_CONFIG] || NIVEL_CONFIG.intermedio;
    const desc = lang === 'en' ? cfg.en : cfg.es;

    // Distribución de tipos
    const tiposValidos: TipoPregunta[] = (tipos as TipoPregunta[]).filter(t =>
      ['multiple','multiselect','truefalse','rellenar','relacionar','corta'].includes(t)
    );
    const tiposActivos = tiposValidos.length > 0 ? tiposValidos : ['multiple' as TipoPregunta];

    const distribucion: Record<TipoPregunta, number> = {} as any;
    const base = Math.floor(count / tiposActivos.length);
    let resto = count - base * tiposActivos.length;
    tiposActivos.forEach(t => {
      distribucion[t] = base + (resto-- > 0 ? 1 : 0);
    });

    // Truncar contenido para que quepa en un prompt razonable
    const maxContent = 6000;
    const truncated = content.length > maxContent ? content.substring(0, maxContent) : content;

    // Generar cada tipo POR SEPARADO en paralelo para forzar que salgan todos
    const allPromises = tiposActivos.map(tipo => {
      const n = distribucion[tipo];
      if (n <= 0) return Promise.resolve([]);

      const sysPrompt = `${lang === 'en' ? 'Expert quiz creator' : 'Experto creador de quizzes'}. ${desc}
${getPromptForType(tipo, lang, n, desc)}
ONLY return valid JSON array. No markdown, no extra text, no \`\`\`.`;

      return groqRequest(async (client, model) => {
        const r = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: `${lang === 'en' ? 'Content' : 'Contenido'}:\n\n${truncated}` },
          ],
          temperature: cfg.temp,
          max_tokens: 4000,
        });
        const text = r.choices[0].message.content || '[]';
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
          console.warn(`[Quiz] No JSON array found for tipo ${tipo}`);
          return [];
        }
        try {
          const parsed = JSON.parse(match[0]);
          // Forzar el tipo correcto y validar
          return parsed
            .map((q: any) => ({ ...q, tipo }))
            .filter((q: any) => {
              if (!q.pregunta || !q.explicacion) return false;
              if (tipo === 'multiple' || tipo === 'truefalse') {
                return Array.isArray(q.opciones) && typeof q.correcta === 'number';
              }
              if (tipo === 'multiselect') {
                return Array.isArray(q.opciones) && Array.isArray(q.correctas) && q.correctas.length >= 2;
              }
              if (tipo === 'rellenar') {
                return typeof q.respuesta === 'string' && q.pregunta.includes('___');
              }
              if (tipo === 'relacionar') {
                return Array.isArray(q.izquierda) && Array.isArray(q.derecha) && Array.isArray(q.pares)
                  && q.izquierda.length >= 3 && q.derecha.length >= 3;
              }
              if (tipo === 'corta') {
                return Array.isArray(q.palabrasClave) && typeof q.respuestaModelo === 'string';
              }
              return false;
            })
            .slice(0, n);
        } catch (e) {
          console.warn(`[Quiz] JSON parse error for tipo ${tipo}:`, e);
          return [];
        }
      }).catch((e: any) => {
        console.warn(`[Quiz] Error generating tipo ${tipo}:`, e.message);
        return [];
      });
    });

    const results = await Promise.allSettled(allPromises);
    const todasPreguntas: any[] = [];
    results.forEach(r => {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        todasPreguntas.push(...r.value);
      }
    });

    // Shuffle para mezclar tipos
    for (let i = todasPreguntas.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [todasPreguntas[i], todasPreguntas[j]] = [todasPreguntas[j], todasPreguntas[i]];
    }

    const quiz = todasPreguntas.slice(0, count);

    console.log(`[Quiz] Generated: ${quiz.length}/${count} questions. Types: ${
      tiposActivos.map(t => `${t}(${quiz.filter((q: any) => q.tipo === t).length})`).join(', ')
    }`);

    if (quiz.length === 0) {
      return NextResponse.json({ success: false, error: 'No se generaron preguntas' }, { status: 500 });
    }

    return NextResponse.json({ success: true, quiz, nivel });

  } catch (error: any) {
    console.error('[Quiz] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
""", encoding='utf-8')
print("✅ API: cada tipo se genera en llamada separada (paralelo)")

# ══════════════════════════════════════════════
# 2) QuizPage — word bank para rellenar
# ══════════════════════════════════════════════
quiz_path = Path("components/materias/QuizPage.tsx")
text = quiz_path.read_text(encoding='utf-8')

# Reemplazar componente RespuestaRellenar con word bank
old_rellenar = """// — Rellenar —
function RespuestaRellenar({ p, respondida, valor, onChange, onConfirmar, themeColor }:
  { p: PreguntaRellenar; respondida: boolean; valor: string; onChange: (v: string) => void; onConfirmar: () => void; themeColor: string }) {
  const ok = respondida && valor.trim().toLowerCase() === p.respuesta.toLowerCase();
  const cercano = respondida && !ok && (
    p.respuesta.toLowerCase().includes(valor.trim().toLowerCase()) ||
    valor.trim().toLowerCase().includes(p.respuesta.toLowerCase().substring(0, 4))
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 560 }}>
      {p.pistas && p.pistas.length > 0 && !respondida && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {p.pistas.map((pista, i) => (
            <span key={i} style={{
              fontFamily: BODY, fontSize: 12, color: 'rgba(255,255,255,0.45)',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, padding: '3px 10px',
            }}>
              💡 {pista}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          type="text"
          value={valor}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !respondida && valor.trim() && onConfirmar()}
          disabled={respondida}
          placeholder="Escribe la palabra..."
          autoFocus
          style={{
            flex: 1, padding: '14px 18px',
            background: respondida
              ? (ok ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)')
              : 'rgba(255,255,255,0.05)',
            border: `2px solid ${respondida ? (ok ? '#4ade8055' : '#f8717155') : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 12, color: '#fff',
            fontFamily: BODY, fontSize: 16, fontWeight: 500,
            outline: 'none', transition: 'all 0.2s',
          }}
        />
        {!respondida && (
          <button onClick={onConfirmar} disabled={!valor.trim()} style={{
            padding: '14px 20px', borderRadius: 12,
            background: valor.trim() ? themeColor : 'rgba(255,255,255,0.05)',
            color: valor.trim() ? '#000' : 'rgba(255,255,255,0.2)',
            border: 'none', fontFamily: BODY, fontSize: 14, fontWeight: 700,
            cursor: valor.trim() ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}>Confirmar</button>
        )}
      </div>
      {respondida && (
        <div style={{
          padding: '10px 16px', borderRadius: 10,
          background: ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
          border: `1px solid ${ok ? '#4ade8033' : '#f8717133'}`,
          fontFamily: BODY, fontSize: 14,
          color: ok ? '#4ade80' : '#f87171',
        }}>
          {ok ? '✅ ¡Correcto!' : (
            <>
              {cercano ? '🤏 Casi... ' : '❌ Incorrecto. '}
              La respuesta era: <strong>{p.respuesta}</strong>
            </>
          )}
        </div>
      )}
    </div>
  );
}"""

new_rellenar = """// — Rellenar (con word bank) —
function RespuestaRellenar({ p, respondida, valor, onChange, onConfirmar, themeColor }:
  { p: PreguntaRellenar; respondida: boolean; valor: string; onChange: (v: string) => void; onConfirmar: () => void; themeColor: string }) {
  const [showBank, setShowBank] = useState(false);
  const ok = respondida && valor.trim().toLowerCase() === p.respuesta.toLowerCase();
  const cercano = respondida && !ok && (
    p.respuesta.toLowerCase().includes(valor.trim().toLowerCase()) ||
    valor.trim().toLowerCase().includes(p.respuesta.toLowerCase().substring(0, 4))
  );
  const wordBank: string[] = (p as any).wordBank || [];
  const tieneBank = wordBank.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 600 }}>
      {/* Input */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <input
          type="text"
          value={valor}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !respondida && valor.trim() && onConfirmar()}
          disabled={respondida}
          placeholder="Escribe la palabra..."
          autoFocus
          style={{
            flex: 1, padding: '14px 18px',
            background: respondida
              ? (ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)')
              : 'rgba(255,255,255,0.04)',
            border: `2px solid ${respondida ? (ok ? '#4ade8044' : '#f8717144') : 'rgba(255,255,255,0.12)'}`,
            borderRadius: 12, color: '#fff',
            fontFamily: BODY, fontSize: 16, fontWeight: 500,
            outline: 'none', transition: 'all 0.2s',
          }}
        />
        {!respondida && (
          <button onClick={onConfirmar} disabled={!valor.trim()} style={{
            padding: '14px 20px', borderRadius: 12,
            background: valor.trim() ? themeColor : 'rgba(255,255,255,0.04)',
            color: valor.trim() ? '#000' : 'rgba(255,255,255,0.2)',
            border: 'none', fontFamily: BODY, fontSize: 14, fontWeight: 700,
            cursor: valor.trim() ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
          }}>Confirmar</button>
        )}
      </div>

      {/* Word bank toggle */}
      {tieneBank && !respondida && (
        <div>
          <button onClick={() => setShowBank(prev => !prev)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: BODY, fontSize: 13, fontWeight: 600,
            color: showBank ? themeColor : 'rgba(255,255,255,0.4)',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 0', transition: 'color 0.15s',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: 5,
              background: showBank ? `${themeColor}22` : 'rgba(255,255,255,0.06)',
              border: `1px solid ${showBank ? `${themeColor}55` : 'rgba(255,255,255,0.1)'}`,
              fontSize: 10, transition: 'all 0.15s',
              transform: showBank ? 'rotate(90deg)' : 'rotate(0deg)',
            }}>▶</span>
            {showBank ? 'Ocultar banco de palabras' : 'Banco de palabras (ayuda)'}
          </button>
          {showBank && (
            <div style={{
              display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8,
              padding: '12px 14px', borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: '1px dashed rgba(255,255,255,0.12)',
              animation: 'fadeUp 0.2s ease',
            }}>
              {wordBank.map((word, i) => (
                <button key={i} onClick={() => { onChange(word); }}
                  style={{
                    padding: '6px 14px', borderRadius: 8,
                    background: valor.toLowerCase() === word.toLowerCase() ? `${themeColor}22` : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${valor.toLowerCase() === word.toLowerCase() ? `${themeColor}55` : 'rgba(255,255,255,0.1)'}`,
                    color: valor.toLowerCase() === word.toLowerCase() ? themeColor : 'rgba(255,255,255,0.7)',
                    fontFamily: BODY, fontSize: 14, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  {word}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resultado */}
      {respondida && (
        <div style={{
          padding: '10px 16px', borderRadius: 10,
          background: ok ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.07)',
          border: `1px solid ${ok ? '#4ade8030' : '#f8717130'}`,
          fontFamily: BODY, fontSize: 14,
          color: ok ? '#4ade80' : '#f87171',
        }}>
          {ok ? '✅ ¡Correcto!' : (
            <>
              {cercano ? '🤏 Casi... ' : '❌ Incorrecto. '}
              La respuesta era: <strong>{p.respuesta}</strong>
            </>
          )}
        </div>
      )}
    </div>
  );
}"""

if old_rellenar in text:
    text = text.replace(old_rellenar, new_rellenar)
    print("✅ RespuestaRellenar con word bank colapsable")
else:
    print("❌ No matcheó RespuestaRellenar")

# También actualizar la interfaz PreguntaRellenar para incluir wordBank
text = text.replace(
    "interface PreguntaRellenar    extends PreguntaBase { tipo: 'rellenar';    respuesta: string; pistas?: string[]; }",
    "interface PreguntaRellenar    extends PreguntaBase { tipo: 'rellenar';    respuesta: string; pistas?: string[]; wordBank?: string[]; }"
)
print("✅ Interface PreguntaRellenar con wordBank")

quiz_path.write_text(text, encoding='utf-8')

print("\n🎉 Listo:")
print("  · API: cada tipo se genera en llamada SEPARADA en paralelo")
print("  · No más dependencia de chunks — un prompt por tipo")
print("  · Rellenar: word bank colapsable a la derecha")
print("  · Tipos forzados: el LLM no puede 'escapar' a otro tipo")
print("  · Shuffle final para mezclar todos los tipos")
