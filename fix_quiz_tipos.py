from pathlib import Path

# ══════════════════════════════════════════════
# 1) API route — soporte para 6 tipos
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

// Tipos de pregunta disponibles
type TipoPregunta = 'multiple' | 'multiselect' | 'truefalse' | 'rellenar' | 'relacionar' | 'corta';

const TIPO_PROMPTS: Record<TipoPregunta, { es: string; en: string }> = {
  multiple: {
    es: `OPCION MULTIPLE: 4 opciones, solo 1 correcta.
Formato: {"tipo":"multiple","pregunta":"...","opciones":["a","b","c","d"],"correcta":0,"explicacion":"..."}`,
    en: `MULTIPLE CHOICE: 4 options, only 1 correct.
Format: {"tipo":"multiple","pregunta":"...","opciones":["a","b","c","d"],"correcta":0,"explicacion":"..."}`,
  },
  multiselect: {
    es: `SELECCION MULTIPLE: 4-5 opciones, 2 o mas correctas. El campo "correctas" es array de indices.
Formato: {"tipo":"multiselect","pregunta":"Selecciona TODAS las opciones correctas: ...","opciones":["a","b","c","d"],"correctas":[0,2],"explicacion":"..."}`,
    en: `MULTI-SELECT: 4-5 options, 2+ correct. "correctas" is array of indices.
Format: {"tipo":"multiselect","pregunta":"Select ALL correct options: ...","opciones":["a","b","c","d"],"correctas":[0,2],"explicacion":"..."}`,
  },
  truefalse: {
    es: `VERDADERO O FALSO: Afirmacion que puede ser verdadera o falsa. "correcta": 0=Verdadero, 1=Falso.
Formato: {"tipo":"truefalse","pregunta":"...","opciones":["Verdadero","Falso"],"correcta":0,"explicacion":"..."}`,
    en: `TRUE OR FALSE: Statement that is true or false. "correcta": 0=True, 1=False.
Format: {"tipo":"truefalse","pregunta":"...","opciones":["True","False"],"correcta":0,"explicacion":"..."}`,
  },
  rellenar: {
    es: `RELLENAR EL ESPACIO: Oracion con una palabra/frase clave reemplazada por "___". "respuesta" es la palabra correcta.
Formato: {"tipo":"rellenar","pregunta":"La ___ es el proceso por el cual...","respuesta":"fotosintesis","pistas":["empieza con F","proceso de plantas"],"explicacion":"..."}`,
    en: `FILL IN THE BLANK: Sentence with key word replaced by "___". "respuesta" is the correct word.
Format: {"tipo":"rellenar","pregunta":"The ___ is the process by which...","respuesta":"photosynthesis","pistas":["starts with P","plant process"],"explicacion":"..."}`,
  },
  relacionar: {
    es: `RELACIONAR COLUMNAS: 4 pares de conceptos relacionados. "pares" son los pares correctos en orden.
Formato: {"tipo":"relacionar","pregunta":"Relaciona cada concepto con su definicion:","izquierda":["Concepto A","Concepto B","Concepto C","Concepto D"],"derecha":["Def 1","Def 2","Def 3","Def 4"],"pares":[0,1,2,3],"explicacion":"..."}
IMPORTANTE: "derecha" debe estar MEZCLADA (no en el mismo orden que izquierda). "pares[i]" indica que izquierda[i] corresponde a derecha[pares[i]].`,
    en: `MATCHING: 4 pairs of related concepts. "pares" are the correct pairs in order.
Format: {"tipo":"relacionar","pregunta":"Match each concept with its definition:","izquierda":["Concept A","Concept B","Concept C","Concept D"],"derecha":["Def 1","Def 2","Def 3","Def 4"],"pares":[0,1,2,3],"explicacion":"..."}
IMPORTANT: "derecha" must be SHUFFLED. "pares[i]" means izquierda[i] matches derecha[pares[i]].`,
  },
  corta: {
    es: `RESPUESTA CORTA: Pregunta abierta. "palabrasClave" son 3-5 terminos que DEBEN aparecer en la respuesta correcta.
Formato: {"tipo":"corta","pregunta":"Explica brevemente...","palabrasClave":["termino1","termino2","termino3"],"respuestaModelo":"Respuesta completa de referencia...","explicacion":"..."}`,
    en: `SHORT ANSWER: Open question. "palabrasClave" are 3-5 terms that MUST appear in a correct answer.
Format: {"tipo":"corta","pregunta":"Briefly explain...","palabrasClave":["term1","term2","term3"],"respuestaModelo":"Full reference answer...","explicacion":"..."}`,
  },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, count = 10, idioma, nivel = 'intermedio', tipos = ['multiple'] } = body;

    const lang = detectContentLanguage(content, idioma === 'en' ? 'en' : 'es');
    const cfg = NIVEL_CONFIG[nivel as keyof typeof NIVEL_CONFIG] || NIVEL_CONFIG.intermedio;
    const desc = lang === 'en' ? cfg.en : cfg.es;
    const nivelLabel = { facil: 'EASY/FACIL', intermedio: 'INTERMEDIATE/INTERMEDIO', dificil: 'HARD/DIFICIL' }[nivel as string] || 'INTERMEDIO';

    // Distribución de tipos
    const tiposValidos = (tipos as TipoPregunta[]).filter(t => TIPO_PROMPTS[t]);
    const tiposActivos = tiposValidos.length > 0 ? tiposValidos : ['multiple' as TipoPregunta];
    
    // Distribuir preguntas entre tipos
    const distribucion: Record<string, number> = {};
    const base = Math.floor(count / tiposActivos.length);
    let resto = count - base * tiposActivos.length;
    tiposActivos.forEach(t => {
      distribucion[t] = base + (resto-- > 0 ? 1 : 0);
    });

    // Instrucciones de tipos
    const tiposInstrucciones = tiposActivos.map(t => TIPO_PROMPTS[t][lang]).join('\n\n');

    // Chunks
    const chunkSize = 4000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }
    const questionsPerChunk = Math.ceil(count / chunks.length);

    const systemPrompt = (chunkIdx: number) => `${lang === 'en' ? 'Expert quiz creator' : 'Experto en quizzes educativos'}. ${lang === 'en' ? 'Level' : 'Nivel'}: ${nivelLabel}. ${desc}

${lang === 'en' ? 'Create exactly' : 'Crea exactamente'} ${questionsPerChunk} ${lang === 'en' ? 'questions from fragment' : 'preguntas del fragmento'} ${chunkIdx + 1}/${chunks.length}.

${lang === 'en' ? 'QUESTION TYPES TO USE' : 'TIPOS DE PREGUNTA A USAR'}:
${tiposInstrucciones}

${lang === 'en' 
  ? `Distribute the ${questionsPerChunk} questions among the types: ${JSON.stringify(distribucion)}`
  : `Distribuye las ${questionsPerChunk} preguntas entre los tipos: ${JSON.stringify(distribucion)}`}

${lang === 'en' ? 'ONLY return a valid JSON array, no extra text:' : 'Devuelve SOLO un array JSON valido, sin texto extra:'}
[...preguntas...]`;

    const todasPreguntas: any[] = [];
    const batchSize = 3;

    for (let b = 0; b < chunks.length; b += batchSize) {
      const batch = chunks.slice(b, b + batchSize);
      const results = await Promise.allSettled(
        batch.map((chunk, i) =>
          groqRequest(async (client, model) => {
            const r = await client.chat.completions.create({
              model: model('llama-3.3-70b-versatile'),
              messages: [
                { role: 'system', content: systemPrompt(b + i) },
                { role: 'user', content: `${lang === 'en' ? 'Fragment' : 'Fragmento'}:\n\n${chunk}` },
              ],
              temperature: cfg.temp,
              max_tokens: 4000,
            });
            const text = r.choices[0].message.content || '[]';
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) return [];
            const parsed = JSON.parse(match[0]);
            // Validar cada tipo
            return parsed.filter((q: any) => {
              if (!q.tipo || !q.pregunta || !q.explicacion) return false;
              if (q.tipo === 'multiple' || q.tipo === 'truefalse') {
                return Array.isArray(q.opciones) && typeof q.correcta === 'number';
              }
              if (q.tipo === 'multiselect') {
                return Array.isArray(q.opciones) && Array.isArray(q.correctas);
              }
              if (q.tipo === 'rellenar') {
                return typeof q.respuesta === 'string';
              }
              if (q.tipo === 'relacionar') {
                return Array.isArray(q.izquierda) && Array.isArray(q.derecha) && Array.isArray(q.pares);
              }
              if (q.tipo === 'corta') {
                return Array.isArray(q.palabrasClave) && typeof q.respuestaModelo === 'string';
              }
              return false;
            });
          })
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') todasPreguntas.push(...r.value);
      }
    }

    const quiz = todasPreguntas.slice(0, count);
    if (quiz.length === 0) {
      return NextResponse.json({ success: false, error: 'No se generaron preguntas' }, { status: 500 });
    }

    return NextResponse.json({ success: true, quiz, nivel });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
""", encoding='utf-8')
print("✅ API quiz actualizada con 6 tipos")

# ══════════════════════════════════════════════
# 2) QuizPage.tsx — tipos de pregunta completo
# ══════════════════════════════════════════════
quiz_path = Path("components/materias/QuizPage.tsx")
quiz_path.write_text(r"""'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { detectContentLanguage } from '../../lib/detectLanguage';
import MathText from '../MathText';
import {
  guardarQuizTemporal, guardarQuiz, getQuizzesTemporales,
  getTiempoRestante, QuizGuardado, getQuizzesGuardados,
  cargarQuizzesDesdeDB, eliminarQuizGuardado,
} from '../../lib/quizStorage';

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";

// ── Tipos ──────────────────────────────────────
type TipoPregunta = 'multiple' | 'multiselect' | 'truefalse' | 'rellenar' | 'relacionar' | 'corta';
type NivelQuiz = 'facil' | 'intermedio' | 'dificil';
type Fase = 'config' | 'generando' | 'jugando' | 'resultado';

interface PreguntaBase { tipo: TipoPregunta; pregunta: string; explicacion: string; }
interface PreguntaMultiple    extends PreguntaBase { tipo: 'multiple';    opciones: string[]; correcta: number; }
interface PreguntaMultiselect extends PreguntaBase { tipo: 'multiselect'; opciones: string[]; correctas: number[]; }
interface PreguntaTrueFalse   extends PreguntaBase { tipo: 'truefalse';   opciones: string[]; correcta: number; }
interface PreguntaRellenar    extends PreguntaBase { tipo: 'rellenar';    respuesta: string; pistas?: string[]; }
interface PreguntaRelacionar  extends PreguntaBase { tipo: 'relacionar';  izquierda: string[]; derecha: string[]; pares: number[]; }
interface PreguntaCorta       extends PreguntaBase { tipo: 'corta';       palabrasClave: string[]; respuestaModelo: string; }
type Pregunta = PreguntaMultiple | PreguntaMultiselect | PreguntaTrueFalse | PreguntaRellenar | PreguntaRelacionar | PreguntaCorta;

interface SeleccionItem { materialId: string; materialIndex: number; pages: number[]; text?: string; }
interface Props { materiales: any[]; seleccion?: SeleccionItem[]; tema: any; materia: any; onBack: () => void; }

// ── Constantes ────────────────────────────────
const NIVELES = [
  { id: 'facil'      as NivelQuiz, emoji: '🟢', label: 'Fácil',      desc: 'Definiciones',  color: '#4ade80' },
  { id: 'intermedio' as NivelQuiz, emoji: '🟡', label: 'Intermedio', desc: 'Comprensión',   color: '#f5c842' },
  { id: 'dificil'    as NivelQuiz, emoji: '🔴', label: 'Difícil',    desc: 'Análisis',      color: '#ef4444' },
];

const TIPOS_CONFIG: Record<TipoPregunta, { label: string; emoji: string; desc: string; color: string }> = {
  multiple:    { label: 'Múltiple',     emoji: '🔘', desc: '1 respuesta correcta',    color: '#60a5fa' },
  multiselect: { label: 'Multi-select', emoji: '☑️', desc: 'Varias correctas',        color: '#a78bfa' },
  truefalse:   { label: 'V o F',        emoji: '⚖️', desc: 'Verdadero o Falso',       color: '#34d399' },
  rellenar:    { label: 'Rellenar',     emoji: '✏️', desc: 'Completar la palabra',    color: '#f59e0b' },
  relacionar:  { label: 'Relacionar',   emoji: '🔗', desc: 'Unir columnas',           color: '#f472b6' },
  corta:       { label: 'Respuesta',    emoji: '📝', desc: 'Escribir respuesta',      color: '#fb923c' },
};

function filterTextByPages(fullText: string, pages: number[]): string {
  if (!pages || pages.length === 0) return fullText;
  let parts: string[] = [];
  if (fullText.includes('\f')) parts = fullText.split('\f').map(t => t.trim()).filter(Boolean);
  if (parts.length <= 1 && (fullText.includes('[Página ') || fullText.includes('[Pagina ')))
    parts = fullText.split(/(?=\[P[áa]gina \d+\])/g).map(t => t.trim()).filter(Boolean);
  if (parts.length <= 1 && fullText.includes('[Page '))
    parts = fullText.split(/(?=\[Page \d+\])/gi).map(t => t.trim()).filter(Boolean);
  if (parts.length <= 1) return fullText;
  const selected = pages.map(p => parts[p - 1]).filter(Boolean);
  return selected.length > 0 ? selected.join('\n\n') : fullText;
}

// ── Badge de tipo ─────────────────────────────
function TipoBadge({ tipo }: { tipo: TipoPregunta }) {
  const cfg = TIPOS_CONFIG[tipo];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${cfg.color}18`, border: `1px solid ${cfg.color}44`,
      color: cfg.color, borderRadius: 6,
      padding: '2px 10px', fontSize: 12, fontFamily: BODY, fontWeight: 600,
    }}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}

// ══════════════════════════════════════════════
// Componentes de respuesta por tipo
// ══════════════════════════════════════════════

// — Multiple choice —
function RespuestaMultiple({ p, respondida, seleccionada, onResponder, themeColor }:
  { p: PreguntaMultiple; respondida: boolean; seleccionada: number | null; onResponder: (i: number) => void; themeColor: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 680 }}>
      {p.opciones.map((opcion, i) => {
        const esCorrecta = i === p.correcta;
        const esSeleccionada = i === seleccionada;
        let bg = 'rgba(255,255,255,0.03)', border = 'rgba(255,255,255,0.08)', color = 'rgba(255,255,255,0.8)';
        if (respondida) {
          if (esCorrecta) { bg = 'rgba(74,222,128,0.12)'; border = '#4ade8055'; color = '#4ade80'; }
          else if (esSeleccionada) { bg = 'rgba(248,113,113,0.12)'; border = '#f8717155'; color = '#f87171'; }
          else { color = 'rgba(255,255,255,0.25)'; }
        }
        return (
          <button key={i} onClick={() => onResponder(i)} disabled={respondida} style={{
            width: '100%', padding: '14px 18px',
            background: bg, border: `1.5px solid ${border}`,
            borderRadius: 14, cursor: respondida ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 14,
            transition: 'all 0.2s', textAlign: 'left',
          }}>
            <span style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: respondida && esCorrecta ? '#4ade80' : respondida && esSeleccionada ? '#f87171' : 'rgba(255,255,255,0.06)',
              border: `1.5px solid ${respondida && (esCorrecta || esSeleccionada) ? (esCorrecta ? '#4ade80' : '#f87171') : 'rgba(255,255,255,0.12)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: HAND, fontSize: 15, fontWeight: 900,
              color: respondida && (esCorrecta || esSeleccionada) ? '#000' : color,
              transition: 'all 0.2s', flexShrink: 0,
            }}>
              {respondida && esCorrecta ? '✓' : respondida && esSeleccionada ? '✗' : String.fromCharCode(65 + i)}
            </span>
            <span style={{ fontFamily: BODY, fontSize: 14, fontWeight: 400, color, lineHeight: 1.5, flex: 1 }}>
              <MathText text={opcion} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// — Multi-select —
function RespuestaMultiselect({ p, respondida, seleccionadas, onToggle, onConfirmar, themeColor }:
  { p: PreguntaMultiselect; respondida: boolean; seleccionadas: number[]; onToggle: (i: number) => void; onConfirmar: () => void; themeColor: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 680 }}>
      <div style={{ fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 2, fontStyle: 'italic' }}>
        Selecciona todas las correctas
      </div>
      {p.opciones.map((opcion, i) => {
        const esCorrecta = p.correctas.includes(i);
        const esSeleccionada = seleccionadas.includes(i);
        let bg = 'rgba(255,255,255,0.03)', border = 'rgba(255,255,255,0.08)', color = 'rgba(255,255,255,0.8)';
        if (respondida) {
          if (esCorrecta && esSeleccionada) { bg = 'rgba(74,222,128,0.12)'; border = '#4ade8055'; color = '#4ade80'; }
          else if (esCorrecta && !esSeleccionada) { bg = 'rgba(74,222,128,0.06)'; border = '#4ade8033'; color = '#4ade8099'; }
          else if (!esCorrecta && esSeleccionada) { bg = 'rgba(248,113,113,0.12)'; border = '#f8717155'; color = '#f87171'; }
          else { color = 'rgba(255,255,255,0.25)'; }
        } else if (esSeleccionada) {
          bg = `rgba(167,139,250,0.15)`; border = '#a78bfa66'; color = '#a78bfa';
        }
        return (
          <button key={i} onClick={() => !respondida && onToggle(i)} disabled={respondida} style={{
            width: '100%', padding: '14px 18px',
            background: bg, border: `1.5px solid ${border}`,
            borderRadius: 14, cursor: respondida ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 14,
            transition: 'all 0.2s', textAlign: 'left',
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: 6, flexShrink: 0,
              background: respondida
                ? (esCorrecta && esSeleccionada ? '#4ade80' : (!esCorrecta && esSeleccionada ? '#f87171' : 'transparent'))
                : (esSeleccionada ? '#a78bfa' : 'transparent'),
              border: `2px solid ${respondida
                ? (esCorrecta ? '#4ade80' : (!esCorrecta && esSeleccionada ? '#f87171' : 'rgba(255,255,255,0.15)'))
                : (esSeleccionada ? '#a78bfa' : 'rgba(255,255,255,0.2)')}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, color: '#000', fontWeight: 900,
              transition: 'all 0.15s',
            }}>
              {(esSeleccionada || (respondida && esCorrecta)) && '✓'}
            </span>
            <span style={{ fontFamily: BODY, fontSize: 14, fontWeight: 400, color, lineHeight: 1.5, flex: 1 }}>
              <MathText text={opcion} />
            </span>
          </button>
        );
      })}
      {!respondida && (
        <button onClick={onConfirmar} disabled={seleccionadas.length === 0} style={{
          marginTop: 4, padding: '12px', borderRadius: 12,
          background: seleccionadas.length > 0 ? '#a78bfa' : 'rgba(255,255,255,0.05)',
          color: seleccionadas.length > 0 ? '#000' : 'rgba(255,255,255,0.2)',
          border: 'none', fontFamily: BODY, fontSize: 14, fontWeight: 700,
          cursor: seleccionadas.length > 0 ? 'pointer' : 'not-allowed',
          transition: 'all 0.15s',
        }}>
          Confirmar selección ({seleccionadas.length} marcadas)
        </button>
      )}
    </div>
  );
}

// — True or False —
function RespuestaTrueFalse({ p, respondida, seleccionada, onResponder }:
  { p: PreguntaTrueFalse; respondida: boolean; seleccionada: number | null; onResponder: (i: number) => void }) {
  const opts = [
    { label: '✓ Verdadero', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
    { label: '✗ Falso',     color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
  ];
  return (
    <div style={{ display: 'flex', gap: 14, width: '100%', maxWidth: 500 }}>
      {opts.map((opt, i) => {
        const esCorrecta = i === p.correcta;
        const esSeleccionada = i === seleccionada;
        let bg = 'rgba(255,255,255,0.03)', border = 'rgba(255,255,255,0.1)';
        if (respondida) {
          if (esCorrecta) { bg = `${opt.bg}`; border = opt.color + '55'; }
          else if (esSeleccionada) { bg = 'rgba(248,113,113,0.08)'; border = '#f8717144'; }
        } else if (esSeleccionada) {
          bg = opt.bg; border = opt.color + '66';
        }
        return (
          <button key={i} onClick={() => onResponder(i)} disabled={respondida} style={{
            flex: 1, padding: '22px 16px',
            background: bg, border: `2px solid ${border}`,
            borderRadius: 16, cursor: respondida ? 'default' : 'pointer',
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            color: respondida ? (esCorrecta ? opt.color : 'rgba(255,255,255,0.3)') : opt.color,
            transition: 'all 0.2s', textAlign: 'center',
          }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// — Rellenar —
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
}

// — Relacionar —
function RespuestaRelacionar({ p, respondida, conexiones, onConectar, onConfirmar, themeColor }:
  { p: PreguntaRelacionar; respondida: boolean; conexiones: Record<number, number>; onConectar: (izq: number, der: number) => void; onConfirmar: () => void; themeColor: string }) {
  const [selIzq, setSelIzq] = useState<number | null>(null);

  const handleDer = (derIdx: number) => {
    if (respondida) return;
    if (selIzq === null) return;
    onConectar(selIzq, derIdx);
    setSelIzq(null);
  };

  const handleIzq = (izqIdx: number) => {
    if (respondida) return;
    setSelIzq(prev => prev === izqIdx ? null : izqIdx);
  };

  const getColorConexion = (izqIdx: number) => {
    if (!respondida) return themeColor;
    const esCorrecta = conexiones[izqIdx] === p.pares[izqIdx];
    return esCorrecta ? '#4ade80' : '#f87171';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 680 }}>
      {!respondida && (
        <div style={{ fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
          {selIzq !== null
            ? `"${p.izquierda[selIzq]}" seleccionado → elige su par de la derecha`
            : 'Selecciona un elemento de la izquierda, luego su par de la derecha'}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Columna izquierda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.izquierda.map((item, i) => {
            const tieneConexion = conexiones[i] !== undefined;
            const activo = selIzq === i;
            const color = respondida ? getColorConexion(i) : (activo ? themeColor : 'rgba(255,255,255,0.75)');
            return (
              <button key={i} onClick={() => handleIzq(i)} disabled={respondida} style={{
                padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                background: activo ? `${themeColor}18` : tieneConexion ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${activo ? themeColor : tieneConexion ? (respondida ? getColorConexion(i) + '55' : 'rgba(255,255,255,0.2)') : 'rgba(255,255,255,0.08)'}`,
                cursor: respondida ? 'default' : 'pointer',
                fontFamily: BODY, fontSize: 13, fontWeight: 500, color,
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
              }}>
                <span style={{ lineHeight: 1.4 }}>{item}</span>
                {tieneConexion && !respondida && <span style={{ fontSize: 10, color: themeColor, fontWeight: 700, whiteSpace: 'nowrap' }}>✓ unido</span>}
                {respondida && <span style={{ fontSize: 14 }}>{getColorConexion(i) === '#4ade80' ? '✓' : '✗'}</span>}
              </button>
            );
          })}
        </div>
        {/* Columna derecha */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.derecha.map((item, i) => {
            const izqConectado = Object.entries(conexiones).find(([, d]) => d === i);
            const estaUsado = izqConectado !== undefined;
            const color = 'rgba(255,255,255,0.75)';
            return (
              <button key={i} onClick={() => handleDer(i)} disabled={respondida || (estaUsado && selIzq === null)} style={{
                padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                background: estaUsado ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${estaUsado ? (selIzq !== null ? themeColor + '55' : 'rgba(255,255,255,0.2)') : (selIzq !== null ? themeColor + '33' : 'rgba(255,255,255,0.08)')}`,
                cursor: respondida ? 'default' : 'pointer',
                fontFamily: BODY, fontSize: 13, fontWeight: 400, color,
                transition: 'all 0.15s', lineHeight: 1.4,
              }}>
                {item}
              </button>
            );
          })}
        </div>
      </div>
      {/* Resumen de conexiones hechas */}
      {respondida && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {p.izquierda.map((item, i) => {
            const derIdx = conexiones[i];
            const esCorrecta = derIdx === p.pares[i];
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: BODY, fontSize: 13,
                color: esCorrecta ? '#4ade80' : '#f87171',
              }}>
                <span>{esCorrecta ? '✓' : '✗'}</span>
                <span style={{ fontWeight: 600 }}>{item}</span>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>→</span>
                <span>{p.derecha[p.pares[i]]}</span>
                {!esCorrecta && derIdx !== undefined && (
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                    (pusiste: {p.derecha[derIdx]})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!respondida && (
        <button
          onClick={onConfirmar}
          disabled={Object.keys(conexiones).length < p.izquierda.length}
          style={{
            padding: '12px', borderRadius: 12, border: 'none',
            background: Object.keys(conexiones).length >= p.izquierda.length ? themeColor : 'rgba(255,255,255,0.05)',
            color: Object.keys(conexiones).length >= p.izquierda.length ? '#000' : 'rgba(255,255,255,0.2)',
            fontFamily: BODY, fontSize: 14, fontWeight: 700,
            cursor: Object.keys(conexiones).length >= p.izquierda.length ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
          }}
        >
          Confirmar ({Object.keys(conexiones).length}/{p.izquierda.length} conectados)
        </button>
      )}
    </div>
  );
}

// — Respuesta corta —
function RespuestaCorta({ p, respondida, valor, onChange, onConfirmar, themeColor }:
  { p: PreguntaCorta; respondida: boolean; valor: string; onChange: (v: string) => void; onConfirmar: () => void; themeColor: string }) {
  const palabrasEncontradas = respondida
    ? p.palabrasClave.filter(kw => valor.toLowerCase().includes(kw.toLowerCase()))
    : [];
  const puntaje = palabrasEncontradas.length / p.palabrasClave.length;
  const ok = puntaje >= 0.6;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 680 }}>
      <textarea
        value={valor}
        onChange={e => onChange(e.target.value)}
        disabled={respondida}
        placeholder="Escribe tu respuesta aquí..."
        rows={4}
        style={{
          width: '100%', padding: '14px 18px',
          background: respondida
            ? (ok ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.07)')
            : 'rgba(255,255,255,0.04)',
          border: `1.5px solid ${respondida ? (ok ? '#4ade8044' : '#f8717144') : 'rgba(255,255,255,0.12)'}`,
          borderRadius: 12, color: '#fff',
          fontFamily: BODY, fontSize: 14, fontWeight: 400, lineHeight: 1.6,
          outline: 'none', resize: 'vertical', transition: 'all 0.2s',
        }}
      />
      {!respondida && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontFamily: BODY, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
            Conceptos clave: {p.palabrasClave.length} términos importantes
          </div>
          <button onClick={onConfirmar} disabled={valor.trim().length < 10} style={{
            padding: '10px 20px', borderRadius: 10,
            background: valor.trim().length >= 10 ? themeColor : 'rgba(255,255,255,0.05)',
            color: valor.trim().length >= 10 ? '#000' : 'rgba(255,255,255,0.2)',
            border: 'none', fontFamily: BODY, fontSize: 13, fontWeight: 700,
            cursor: valor.trim().length >= 10 ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
          }}>Enviar respuesta</button>
        </div>
      )}
      {respondida && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Score */}
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${ok ? '#4ade8033' : '#f8717133'}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 20 }}>{puntaje >= 0.8 ? '🏆' : puntaje >= 0.6 ? '✅' : puntaje >= 0.3 ? '🤏' : '❌'}</span>
            <div>
              <div style={{ fontFamily: BODY, fontSize: 14, fontWeight: 700, color: ok ? '#4ade80' : '#f87171' }}>
                {palabrasEncontradas.length}/{p.palabrasClave.length} conceptos clave mencionados
              </div>
              <div style={{ fontFamily: BODY, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                {ok ? 'Buena respuesta' : 'Faltan conceptos importantes'}
              </div>
            </div>
          </div>
          {/* Palabras clave */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {p.palabrasClave.map((kw, i) => {
              const encontrada = valor.toLowerCase().includes(kw.toLowerCase());
              return (
                <span key={i} style={{
                  padding: '3px 10px', borderRadius: 6,
                  background: encontrada ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.1)',
                  border: `1px solid ${encontrada ? '#4ade8033' : '#f8717133'}`,
                  color: encontrada ? '#4ade80' : '#f87171',
                  fontFamily: BODY, fontSize: 12, fontWeight: 500,
                }}>
                  {encontrada ? '✓' : '✗'} {kw}
                </span>
              );
            })}
          </div>
          {/* Respuesta modelo */}
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontFamily: BODY, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Respuesta modelo:
            </div>
            <div style={{ fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
              {p.respuestaModelo}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════
export default function QuizPage({ materiales, seleccion, tema, materia, onBack }: Props) {
  const themeColor = tema?.color || '#f5c842';
  const NIVELES_COLOR: Record<NivelQuiz, string> = { facil: '#4ade80', intermedio: '#f5c842', dificil: '#ef4444' };

  const [fase, setFase]   = useState<Fase>('config');
  const [nivel, setNivel] = useState<NivelQuiz>('intermedio');
  const [count, setCount] = useState(10);
  const [error, setError] = useState('');
  const [tiposSeleccionados, setTiposSeleccionados] = useState<TipoPregunta[]>(['multiple']);

  const [preguntas, setPreguntas]   = useState<Pregunta[]>([]);
  const [idx, setIdx]               = useState(0);
  const [respondida, setRespondida] = useState(false);
  const [puntos, setPuntos]         = useState(0);
  const [resultados, setResultados] = useState<boolean[]>([]);

  // Estado por tipo de respuesta
  const [seleccionada, setSeleccionada]     = useState<number | null>(null);       // multiple, truefalse
  const [multiSel, setMultiSel]             = useState<number[]>([]);              // multiselect
  const [rellenarVal, setRellenarVal]       = useState('');                        // rellenar
  const [cortaVal, setCortaVal]             = useState('');                        // corta
  const [conexiones, setConexiones]         = useState<Record<number, number>>({});// relacionar

  // Guardado / historial
  const [quizTempId, setQuizTempId]         = useState<string | null>(null);
  const [nombreGuardar, setNombreGuardar]   = useState('');
  const [guardadoOk, setGuardadoOk]         = useState(false);
  const [tiempoRestante, setTiempoRestante] = useState('');
  const [historialQuizzes, setHistorialQuizzes] = useState<any[]>([]);
  const [showHistorial, setShowHistorial]   = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const nivelActual = NIVELES.find(n => n.id === nivel) || NIVELES[1];
  const preguntaActual = preguntas[idx];
  const progreso = preguntas.length > 0 ? ((idx + 1) / preguntas.length) * 100 : 0;
  const porcentaje = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;
  const tieneSeleccion = Array.isArray(seleccion) && seleccion.length > 0;
  const totalPaginas = tieneSeleccion ? seleccion!.reduce((a, s) => a + (s.pages?.length || 0), 0) : 0;

  // Timer expiración
  useEffect(() => {
    if (!quizTempId) return;
    const temps = getQuizzesTemporales();
    const q = temps.find(t => t.id === quizTempId);
    if (!q?.expiraEn) return;
    const iv = setInterval(() => setTiempoRestante(getTiempoRestante(q.expiraEn!)), 1000);
    setTiempoRestante(getTiempoRestante(q.expiraEn));
    return () => clearInterval(iv);
  }, [quizTempId]);

  // Teclado
  useEffect(() => {
    if (fase !== 'jugando' || !preguntaActual) return;
    const h = (e: KeyboardEvent) => {
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (respondida && (e.key === 'Enter' || e.key === 'ArrowRight')) siguiente();
      if (!respondida && preguntaActual.tipo === 'multiple') {
        if (e.key === '1') confirmarRespuesta(0);
        if (e.key === '2') confirmarRespuesta(1);
        if (e.key === '3') confirmarRespuesta(2);
        if (e.key === '4') confirmarRespuesta(3);
      }
      if (!respondida && preguntaActual.tipo === 'truefalse') {
        if (e.key === '1') confirmarRespuesta(0);
        if (e.key === '2') confirmarRespuesta(1);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fase, respondida, idx, preguntas]);

  // Scroll al top
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [idx]);

  // Historial
  const recargarHistorial = async () => {
    try { await cargarQuizzesDesdeDB(); } catch {}
    const guardados = getQuizzesGuardados();
    const temporales = getQuizzesTemporales();
    const filtrar = (q: QuizGuardado) =>
      (q.materiaNombre && q.materiaNombre === materia.nombre) ||
      (q.nombre && q.nombre.toLowerCase().includes(tema.nombre.toLowerCase()));
    const todos = [
      ...guardados.filter(filtrar).map(q => ({ ...q, esTemporal: false })),
      ...temporales.filter(filtrar).map(q => ({ ...q, esTemporal: true })),
    ];
    setHistorialQuizzes(todos);
  };

  useEffect(() => { recargarHistorial(); }, [materia.nombre, tema.nombre, guardadoOk, fase]);

  // Toggle tipo de pregunta
  const toggleTipo = (t: TipoPregunta) => {
    setTiposSeleccionados(prev => {
      if (prev.includes(t)) {
        if (prev.length === 1) return prev; // mínimo 1
        return prev.filter(x => x !== t);
      }
      return [...prev, t];
    });
  };

  // Extraer texto
  const extractAllText = async (): Promise<string> => {
    const session = (await supabase.auth.getSession()).data.session;
    const texts: string[] = [];
    const mats = materiales.length > 0 ? materiales : [];
    const pendingIds: string[] = [];
    const idxMap: Record<string, number> = {};
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      const matId = String(mat?.materialId || mat?.material_id || mat?.id || '');
      const sel = tieneSeleccion ? seleccion!.find(s => s.materialIndex === i || s.materialId === matId) : null;
      if (sel?.text) { texts.push(`[Material ${i + 1}]\n${sel.text}`); continue; }
      const raw = mat?.contenido || mat?.content || '';
      if (raw.trim()) {
        const pages = sel?.pages || [];
        texts.push(`[Material ${i + 1}]\n${pages.length ? filterTextByPages(raw, pages) : raw}`);
        continue;
      }
      if (matId) { pendingIds.push(matId); idxMap[matId] = i; }
    }
    if (pendingIds.length > 0 && session) {
      const res = await fetch('/api/enfoques/teorico/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ materialIds: pendingIds }),
      });
      const data = await res.json();
      if (data.materials) {
        for (const matId of pendingIds) {
          const fullText = data.materials[matId]?.text || '';
          if (!fullText) continue;
          const i = idxMap[matId];
          const mat = mats[i];
          const sel = tieneSeleccion ? seleccion!.find(s => s.materialIndex === i || s.materialId === matId) : null;
          const pages = sel?.pages || [];
          texts.push(`[Material ${i + 1}]\n${pages.length ? filterTextByPages(fullText, pages) : fullText}`);
        }
      }
    }
    return texts.join('\n\n---\n\n');
  };

  const generate = async () => {
    setError(''); setFase('generando');
    try {
      const texto = await extractAllText();
      if (!texto.trim()) { setError('No se pudo extraer texto.'); setFase('config'); return; }
      const lang = detectContentLanguage(texto, 'es');
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: texto, count, idioma: lang, nivel, tipos: tiposSeleccionados }),
      });
      const data = await res.json();
      if (!data.success || !data.quiz?.length) { setError(data.error || 'Error generando quiz.'); setFase('config'); return; }
      setPreguntas(data.quiz);
      resetEstadoRespuesta();
      setIdx(0); setPuntos(0); setResultados([]);
      setGuardadoOk(false); setQuizTempId(null); setNombreGuardar('');
      setFase('jugando');
    } catch (e: any) { setError(e.message); setFase('config'); }
  };

  const resetEstadoRespuesta = () => {
    setSeleccionada(null); setRespondida(false);
    setMultiSel([]); setRellenarVal(''); setCortaVal(''); setConexiones({});
  };

  // Calcular si la respuesta es correcta según tipo
  const calcularOk = (): boolean => {
    if (!preguntaActual) return false;
    switch (preguntaActual.tipo) {
      case 'multiple':
      case 'truefalse':
        return seleccionada === (preguntaActual as PreguntaMultiple).correcta;
      case 'multiselect': {
        const p = preguntaActual as PreguntaMultiselect;
        return p.correctas.length === multiSel.length && p.correctas.every(c => multiSel.includes(c));
      }
      case 'rellenar': {
        const p = preguntaActual as PreguntaRellenar;
        return rellenarVal.trim().toLowerCase() === p.respuesta.toLowerCase();
      }
      case 'relacionar': {
        const p = preguntaActual as PreguntaRelacionar;
        return p.izquierda.every((_, i) => conexiones[i] === p.pares[i]);
      }
      case 'corta': {
        const p = preguntaActual as PreguntaCorta;
        const encontradas = p.palabrasClave.filter(kw => cortaVal.toLowerCase().includes(kw.toLowerCase()));
        return encontradas.length / p.palabrasClave.length >= 0.6;
      }
    }
  };

  const confirmarRespuesta = (opcion?: number) => {
    if (respondida) return;
    if (preguntaActual.tipo === 'multiple' || preguntaActual.tipo === 'truefalse') {
      if (opcion === undefined) return;
      setSeleccionada(opcion);
    }
    setRespondida(true);
    const ok = (() => {
      if (preguntaActual.tipo === 'multiple' || preguntaActual.tipo === 'truefalse') {
        return opcion === (preguntaActual as PreguntaMultiple).correcta;
      }
      return calcularOk();
    })();
    if (ok) setPuntos(p => p + 1);
    setResultados(prev => [...prev, ok]);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollTop + 200, behavior: 'smooth' });
    }, 100);
  };

  const siguiente = () => {
    if (idx + 1 >= preguntas.length) {
      const temp = guardarQuizTemporal({
        nombre: `Quiz ${nivelActual.label} · ${tema.nombre}`,
        preguntas: preguntas as any, nivel,
        materiaNombre: materia.nombre, materiaColor: tema.color,
      });
      setQuizTempId(temp.id);
      setFase('resultado');
    } else {
      setIdx(i => i + 1);
      resetEstadoRespuesta();
    }
  };

  const guardarPermanente = async () => {
    if (!nombreGuardar.trim() || guardadoOk) return;
    await guardarQuiz({
      nombre: nombreGuardar.trim(), preguntas: preguntas as any, nivel,
      materiaNombre: materia.nombre, materiaColor: tema.color,
    });
    setGuardadoOk(true);
  };

  const cargarQuizDelHistorial = (q: any) => {
    setPreguntas(q.preguntas);
    setNivel(q.nivel || 'intermedio');
    resetEstadoRespuesta();
    setIdx(0); setPuntos(0); setResultados([]);
    setGuardadoOk(true); setQuizTempId(null);
    setFase('jugando');
  };

  const borrarDelHistorial = async (id: string, esTemp: boolean = false) => {
    if (!confirm('¿Eliminar este quiz?')) return;
    if (esTemp) {
      const { eliminarQuizTemporal } = await import('../../lib/quizStorage');
      eliminarQuizTemporal(id);
    } else {
      await eliminarQuizGuardado(id);
    }
    setHistorialQuizzes(prev => prev.filter((q: any) => q.id !== id));
  };

  // ── BASE ──────────────────────────────────
  const Base = ({ children }: { children: React.ReactNode }) => (
    <div style={{
      position: 'fixed', inset: 0, background: '#0d0d11',
      display: 'flex', flexDirection: 'column', fontFamily: BODY, overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(to bottom, transparent 47px, rgba(255,255,255,0.03) 47px, rgba(255,255,255,0.03) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
      }}/>
      <div style={{ position: 'absolute', left: 60, top: 0, bottom: 0, width: 1.5, background: 'rgba(239,68,68,0.18)', pointerEvents: 'none' }}/>
      {children}
    </div>
  );

  // ── HEADER ────────────────────────────────
  const Header = ({ right, progress }: { right?: React.ReactNode; progress?: number }) => (
    <div style={{ flexShrink: 0, position: 'relative', zIndex: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(13,13,17,0.97)', backdropFilter: 'blur(10px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
            fontFamily: BODY, fontSize: 14, fontWeight: 500,
            color: 'rgba(255,255,255,0.6)', transition: 'all 0.15s',
          }}>← volver</button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>🎯</span>
              <span style={{ fontFamily: HAND, fontSize: 24, fontWeight: 900, color: '#fff' }}>Quiz</span>
              <span style={{
                padding: '2px 10px', borderRadius: 6,
                background: `${NIVELES_COLOR[nivel]}18`, border: `1px solid ${NIVELES_COLOR[nivel]}44`,
                color: NIVELES_COLOR[nivel], fontFamily: BODY, fontSize: 12, fontWeight: 600,
              }}>{nivelActual.emoji} {nivelActual.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: BODY, marginTop: 1 }}>
              {tema.nombre} · {materia.nombre}
              {totalPaginas > 0 && <span style={{ color: `${themeColor}88`, marginLeft: 6 }}>· {totalPaginas} págs</span>}
            </div>
          </div>
        </div>
        {right}
      </div>
      {progress !== undefined && (
        <div style={{ height: 3, background: 'rgba(255,255,255,0.05)' }}>
          <div style={{
            height: '100%', width: `${progress}%`,
            background: `linear-gradient(90deg, ${themeColor}88, ${themeColor})`,
            transition: 'width 0.4s ease', boxShadow: `0 0 8px ${themeColor}55`,
          }}/>
        </div>
      )}
    </div>
  );

  // ══════════════════════════════════════════
  // CONFIG
  // ══════════════════════════════════════════
  if (fase === 'config' || fase === 'generando') return (
    <Base>
      <Header/>
      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center',
        padding: '28px 20px', gap: 24,
      }}>
        <div style={{ width: '100%', maxWidth: 560 }}>

          {/* Materiales */}
          {materiales.length > 0 && (
            <div style={{
              marginBottom: 20, padding: '12px 16px',
              background: `${themeColor}0a`, border: `1px solid ${themeColor}28`,
              borderRadius: 12,
            }}>
              <div style={{ fontFamily: BODY, fontSize: 13, fontWeight: 700, color: themeColor, marginBottom: 6 }}>
                📂 {materiales.length} material{materiales.length > 1 ? 'es' : ''} seleccionado{materiales.length > 1 ? 's' : ''}
              </div>
              {materiales.map((m: any, i: number) => {
                const sel = tieneSeleccion ? seleccion!.find(s => s.materialIndex === i) : null;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>·</span>
                    <span style={{ fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                      {m.nombre || `Material ${i + 1}`}
                    </span>
                    {sel?.pages && sel.pages.length > 0 && (
                      <span style={{ fontSize: 11, color: themeColor, background: `${themeColor}15`, padding: '1px 6px', borderRadius: 4 }}>
                        {sel.pages.length} págs
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tipos de pregunta */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: BODY, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
              Tipos de pregunta
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {(Object.entries(TIPOS_CONFIG) as [TipoPregunta, typeof TIPOS_CONFIG[TipoPregunta]][]).map(([tipo, cfg]) => {
                const activo = tiposSeleccionados.includes(tipo);
                return (
                  <button key={tipo} onClick={() => toggleTipo(tipo)} style={{
                    padding: '12px 10px', borderRadius: 12, textAlign: 'center',
                    border: `1.5px solid ${activo ? cfg.color : 'rgba(255,255,255,0.07)'}`,
                    background: activo ? `${cfg.color}14` : 'rgba(255,255,255,0.02)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    position: 'relative',
                  }}>
                    {activo && (
                      <div style={{
                        position: 'absolute', top: 6, right: 8,
                        width: 8, height: 8, borderRadius: '50%',
                        background: cfg.color,
                      }}/>
                    )}
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{cfg.emoji}</div>
                    <div style={{ fontFamily: BODY, fontSize: 13, fontWeight: 700, color: activo ? cfg.color : 'rgba(255,255,255,0.7)' }}>
                      {cfg.label}
                    </div>
                    <div style={{ fontFamily: BODY, fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {cfg.desc}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontFamily: BODY, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
              {tiposSeleccionados.length} tipo{tiposSeleccionados.length > 1 ? 's' : ''} seleccionado{tiposSeleccionados.length > 1 ? 's' : ''} · se distribuirán equitativamente
            </div>
          </div>

          {/* Dificultad */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: BODY, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
              Dificultad
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              {NIVELES.map(n => {
                const active = nivel === n.id;
                return (
                  <button key={n.id} onClick={() => setNivel(n.id)} style={{
                    padding: '14px 10px', borderRadius: 12,
                    border: `1.5px solid ${active ? n.color : 'rgba(255,255,255,0.07)'}`,
                    background: active ? `${n.color}15` : 'rgba(255,255,255,0.02)',
                    cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                  }}>
                    <div style={{ fontSize: 26, marginBottom: 4 }}>{n.emoji}</div>
                    <div style={{ fontFamily: BODY, fontSize: 14, fontWeight: 700, color: active ? n.color : 'rgba(255,255,255,0.75)' }}>{n.label}</div>
                    <div style={{ fontFamily: BODY, fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{n.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cantidad */}
          <div style={{ marginBottom: 26 }}>
            <div style={{ fontFamily: BODY, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
              Cantidad de preguntas
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {[5, 10, 15, 20, 30].map(n => (
                <button key={n} onClick={() => setCount(n)} style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: `1.5px solid ${count === n ? themeColor : 'rgba(255,255,255,0.08)'}`,
                  background: count === n ? `${themeColor}18` : 'rgba(255,255,255,0.03)',
                  color: count === n ? themeColor : 'rgba(255,255,255,0.5)',
                  fontFamily: BODY, fontSize: 15, fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>{n}</button>
              ))}
              <input type="number" min={1} max={60} value={count}
                onChange={e => setCount(Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))}
                style={{
                  width: 60, padding: '8px 10px', borderRadius: 8,
                  border: '1.5px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)', color: '#fff',
                  fontFamily: BODY, fontSize: 15, fontWeight: 700, textAlign: 'center', outline: 'none',
                }}
              />
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', marginBottom: 14, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, color: '#f87171', fontFamily: BODY, fontSize: 13 }}>
              {error}
            </div>
          )}

          <button onClick={generate} disabled={fase === 'generando'} style={{
            width: '100%', padding: '16px',
            background: fase === 'generando' ? 'rgba(255,255,255,0.04)' : `linear-gradient(135deg, ${themeColor}cc, ${themeColor})`,
            color: fase === 'generando' ? 'rgba(255,255,255,0.25)' : '#000',
            border: 'none', borderRadius: 12,
            cursor: fase === 'generando' ? 'not-allowed' : 'pointer',
            fontFamily: BODY, fontSize: 16, fontWeight: 700,
            boxShadow: fase === 'generando' ? 'none' : `0 4px 20px ${themeColor}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            transition: 'all 0.2s',
          }}>
            {fase === 'generando' ? (
              <>
                <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
                Generando {count} preguntas...
              </>
            ) : `🚀 Generar · ${count} preguntas · ${tiposSeleccionados.length} tipo${tiposSeleccionados.length > 1 ? 's' : ''}`}
          </button>
        </div>

        {/* Post-it historial */}
        {showHistorial && (
          <div style={{
            width: 260, flexShrink: 0, alignSelf: 'flex-start',
            transform: 'rotate(1deg)',
            background: `${themeColor}14`,
            border: `1px solid ${themeColor}33`,
            borderRadius: 4, padding: '16px 14px 14px',
            boxShadow: `0 6px 20px rgba(0,0,0,0.35)`,
            position: 'relative', maxHeight: 'calc(100vh - 120px)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%) rotate(-2deg)', width: 60, height: 14, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)' }}/>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: HAND, fontSize: 17, fontWeight: 900, color: '#fff' }}>📌 Mis quizzes</span>
              <button onClick={() => setShowHistorial(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 16 }}>×</button>
            </div>
            <div style={{ fontFamily: BODY, fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10, fontStyle: 'italic' }}>
              {historialQuizzes.length} en {materia.nombre}
            </div>
            {historialQuizzes.length === 0 ? (
              <div style={{ fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '16px 0', fontStyle: 'italic', lineHeight: 1.5 }}>
                Genera un quiz y<br/>aparecerá aquí 📝
              </div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {historialQuizzes.map((q: any) => {
                  const esTemp = q.esTemporal;
                  const tiempoExp = esTemp && q.expiraEn ? getTiempoRestante(q.expiraEn) : null;
                  return (
                    <div key={q.id} style={{
                      background: esTemp ? 'rgba(245,200,66,0.07)' : 'rgba(0,0,0,0.2)',
                      border: esTemp ? '1px dashed rgba(245,200,66,0.3)' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8, padding: '10px 12px', position: 'relative',
                    }}>
                      {esTemp && tiempoExp && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5,
                          background: 'rgba(245,200,66,0.1)', border: '1px dashed rgba(245,200,66,0.4)',
                          borderRadius: 5, padding: '2px 8px', width: 'fit-content',
                        }}>
                          <span style={{ fontSize: 10 }}>⏳</span>
                          <span style={{ fontFamily: BODY, fontSize: 11, fontWeight: 700, color: '#f5c842' }}>
                            expira en {tiempoExp}
                          </span>
                        </div>
                      )}
                      <div style={{ fontFamily: BODY, fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {q.nombre}
                      </div>
                      <div style={{ fontFamily: BODY, fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>
                        {q.preguntas.length} preguntas · {q.fechaCreacion}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => cargarQuizDelHistorial(q)} style={{
                          flex: 1, padding: '5px 8px',
                          background: themeColor, color: '#000',
                          border: 'none', borderRadius: 6,
                          fontFamily: BODY, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}>▶ Jugar</button>
                        <button onClick={() => borrarDelHistorial(q.id, esTemp)} style={{
                          padding: '5px 8px', background: 'rgba(248,113,113,0.12)',
                          color: '#f87171', border: '1px solid rgba(248,113,113,0.25)',
                          borderRadius: 6, fontFamily: BODY, fontSize: 12, cursor: 'pointer',
                        }}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!showHistorial && historialQuizzes.length > 0 && (
          <button onClick={() => setShowHistorial(true)} style={{
            position: 'fixed', right: 20, top: 90,
            padding: '8px 14px', borderRadius: 8,
            background: `${themeColor}18`, border: `1px solid ${themeColor}44`,
            color: themeColor, fontFamily: BODY, fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
          }}>📌 {historialQuizzes.length}</button>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Base>
  );

  // ══════════════════════════════════════════
  // RESULTADO
  // ══════════════════════════════════════════
  if (fase === 'resultado') {
    const emoji = porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '💪' : porcentaje >= 40 ? '📚' : '😅';
    const msgColor = porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : porcentaje >= 40 ? '#fb923c' : '#f87171';
    return (
      <Base>
        <Header/>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 20px' }}>
          <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Score */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 18, padding: '24px', textAlign: 'center', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 0%, ${msgColor}10, transparent 65%)`, pointerEvents: 'none' }}/>
              <div style={{ fontSize: 48, marginBottom: 6 }}>{emoji}</div>
              <div style={{ fontFamily: HAND, fontSize: 64, fontWeight: 900, color: msgColor, lineHeight: 1 }}>{porcentaje}%</div>
              <div style={{ fontFamily: BODY, fontSize: 18, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>{puntos} de {preguntas.length} correctas</div>
              <div style={{ fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                {nivelActual.emoji} {nivelActual.label} · {tiposSeleccionados.map(t => TIPOS_CONFIG[t].emoji).join(' ')}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
                {resultados.map((ok, i) => (
                  <div key={i} style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: ok ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                    border: `1px solid ${ok ? '#4ade8044' : '#f8717144'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, color: ok ? '#4ade80' : '#f87171', fontWeight: 700,
                  }}>{ok ? '✓' : '✗'}</div>
                ))}
              </div>
            </div>

            {/* Expiración */}
            {!guardadoOk && quizTempId && (
              <div style={{
                background: 'rgba(245,200,66,0.07)', border: '1px solid rgba(245,200,66,0.2)',
                borderRadius: 12, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 20 }}>⏳</span>
                <div>
                  <div style={{ fontFamily: BODY, fontSize: 14, fontWeight: 700, color: '#f5c842' }}>
                    Guardado temporalmente · expira en {tiempoRestante || '24h'}
                  </div>
                  <div style={{ fontFamily: BODY, fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    Guárdalo antes de que expire
                  </div>
                </div>
              </div>
            )}

            {/* Guardar */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontFamily: BODY, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                💾 Guardar en {materia.nombre}
              </div>
              {guardadoOk ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)' }}>
                  <span>✅</span>
                  <span style={{ fontFamily: BODY, fontSize: 15, fontWeight: 700, color: '#4ade80' }}>¡Guardado!</span>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={nombreGuardar} onChange={e => setNombreGuardar(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && guardarPermanente()}
                    placeholder={`Quiz ${nivelActual.label} · ${tema.nombre}`}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                      color: '#fff', fontFamily: BODY, fontSize: 14, outline: 'none',
                    }}
                  />
                  <button onClick={guardarPermanente} disabled={!nombreGuardar.trim()} style={{
                    padding: '10px 16px', borderRadius: 8,
                    background: nombreGuardar.trim() ? themeColor : 'rgba(255,255,255,0.04)',
                    color: nombreGuardar.trim() ? '#000' : 'rgba(255,255,255,0.2)',
                    border: 'none', fontFamily: BODY, fontSize: 14, fontWeight: 700,
                    cursor: nombreGuardar.trim() ? 'pointer' : 'not-allowed',
                  }}>💾</button>
                </div>
              )}
            </div>

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setIdx(0); resetEstadoRespuesta(); setPuntos(0); setResultados([]); setFase('jugando'); }} style={{
                flex: 1, padding: '13px', borderRadius: 10,
                background: `${themeColor}18`, border: `1.5px solid ${themeColor}33`,
                color: themeColor, fontFamily: BODY, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}>🔄 Repetir</button>
              <button onClick={() => { setFase('config'); setPreguntas([]); setPuntos(0); setResultados([]); }} style={{
                flex: 1, padding: '13px', borderRadius: 10,
                background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.09)',
                color: 'rgba(255,255,255,0.65)', fontFamily: BODY, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}>⚙️ Nuevo quiz</button>
            </div>

            {/* Detalle */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontFamily: BODY, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Detalle
              </div>
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {preguntas.map((p, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 10, padding: '10px 16px',
                    borderBottom: i < preguntas.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{resultados[i] ? '✅' : '❌'}</span>
                    <div style={{ flex: 1 }}>
                      <TipoBadge tipo={p.tipo} />
                      <div style={{ fontFamily: BODY, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.45, marginTop: 4 }}>{p.pregunta}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Base>
    );
  }

  // ══════════════════════════════════════════
  // JUGANDO
  // ══════════════════════════════════════════
  if (!preguntaActual) return null;

  return (
    <Base>
      <Header
        progress={progreso}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 900, color: themeColor,
              background: `${themeColor}15`, padding: '3px 12px', borderRadius: 7,
              border: `1px solid ${themeColor}30`,
            }}>{puntos} pts</div>
            <div style={{ fontFamily: BODY, fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
              {idx + 1}/{preguntas.length}
            </div>
          </div>
        }
      />

      {/* Dots */}
      <div style={{
        padding: '8px 20px', display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        {preguntas.map((_, i) => (
          <div key={i} style={{
            height: 5, borderRadius: 3,
            width: i === idx ? 22 : 7,
            background: resultados[i] === true ? '#4ade80' : resultados[i] === false ? '#f87171' : i === idx ? themeColor : 'rgba(255,255,255,0.1)',
            transition: 'all 0.25s',
          }}/>
        ))}
      </div>

      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto', padding: '18px 20px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      }}>

        {/* Card pregunta */}
        <div style={{
          width: '100%', maxWidth: 700,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16, padding: '20px 22px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              fontFamily: BODY, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.05)', padding: '2px 10px', borderRadius: 5,
            }}>Pregunta {idx + 1}</span>
            <TipoBadge tipo={preguntaActual.tipo} />
          </div>
          <p style={{ fontFamily: BODY, fontSize: 16, fontWeight: 400, color: 'rgba(255,255,255,0.9)', margin: 0, lineHeight: 1.7 }}>
            <MathText text={preguntaActual.pregunta} />
          </p>
          {(preguntaActual.tipo === 'multiple' || preguntaActual.tipo === 'truefalse') && !respondida && (
            <div style={{ fontFamily: BODY, fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 10 }}>
              Teclas 1-{preguntaActual.tipo === 'truefalse' ? '2' : '4'} para responder · Enter para continuar
            </div>
          )}
        </div>

        {/* Respuesta según tipo */}
        {preguntaActual.tipo === 'multiple' && (
          <RespuestaMultiple
            p={preguntaActual as PreguntaMultiple}
            respondida={respondida} seleccionada={seleccionada}
            onResponder={confirmarRespuesta} themeColor={themeColor}
          />
        )}
        {preguntaActual.tipo === 'truefalse' && (
          <RespuestaTrueFalse
            p={preguntaActual as PreguntaTrueFalse}
            respondida={respondida} seleccionada={seleccionada}
            onResponder={confirmarRespuesta}
          />
        )}
        {preguntaActual.tipo === 'multiselect' && (
          <RespuestaMultiselect
            p={preguntaActual as PreguntaMultiselect}
            respondida={respondida} seleccionadas={multiSel}
            onToggle={i => setMultiSel(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}
            onConfirmar={() => confirmarRespuesta()}
            themeColor={themeColor}
          />
        )}
        {preguntaActual.tipo === 'rellenar' && (
          <RespuestaRellenar
            p={preguntaActual as PreguntaRellenar}
            respondida={respondida} valor={rellenarVal}
            onChange={setRellenarVal}
            onConfirmar={() => confirmarRespuesta()}
            themeColor={themeColor}
          />
        )}
        {preguntaActual.tipo === 'relacionar' && (
          <RespuestaRelacionar
            p={preguntaActual as PreguntaRelacionar}
            respondida={respondida} conexiones={conexiones}
            onConectar={(izq, der) => setConexiones(prev => ({ ...prev, [izq]: der }))}
            onConfirmar={() => confirmarRespuesta()}
            themeColor={themeColor}
          />
        )}
        {preguntaActual.tipo === 'corta' && (
          <RespuestaCorta
            p={preguntaActual as PreguntaCorta}
            respondida={respondida} valor={cortaVal}
            onChange={setCortaVal}
            onConfirmar={() => confirmarRespuesta()}
            themeColor={themeColor}
          />
        )}

        {/* Explicación */}
        {respondida && (
          <div style={{
            width: '100%', maxWidth: 700,
            background: calcularOk() ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.07)',
            border: `1px solid ${calcularOk() ? '#4ade8030' : '#f8717130'}`,
            borderRadius: 12, padding: '14px 18px',
            animation: 'fadeUp 0.3s ease',
          }}>
            <div style={{ fontFamily: BODY, fontSize: 15, fontWeight: 700, color: calcularOk() ? '#4ade80' : '#f87171', marginBottom: 6 }}>
              {calcularOk() ? '✅ ¡Correcto!' : '❌ Incorrecto'}
            </div>
            <p style={{ fontFamily: BODY, fontSize: 13, lineHeight: 1.7, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
              <MathText text={preguntaActual.explicacion} />
            </p>
          </div>
        )}

        <div style={{ height: 80 }}/>
      </div>

      {/* Botón siguiente fijo */}
      {respondida && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '12px 20px',
          background: 'rgba(13,13,17,0.97)', backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'center', zIndex: 20,
        }}>
          <button onClick={siguiente} style={{
            padding: '13px 56px', borderRadius: 10,
            background: `linear-gradient(135deg, ${themeColor}cc, ${themeColor})`,
            color: '#000', border: 'none',
            fontFamily: BODY, fontSize: 16, fontWeight: 700,
            cursor: 'pointer', boxShadow: `0 4px 16px ${themeColor}33`,
          }}>
            {idx + 1 >= preguntas.length ? '🏁 Ver resultado' : 'Siguiente →'}
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </Base>
  );
}
""", encoding='utf-8')
print("✅ QuizPage.tsx reescrito con 6 tipos de pregunta")
print("\n🎉 Listo:")
print("  · API: multiple, multiselect, truefalse, rellenar, relacionar, corta")
print("  · Config: selector de tipos visual (grid 3x2)")
print("  · Relacionar: click izq → click der para conectar")
print("  · Rellenar: input de texto con pistas")
print("  · Multi-select: checkboxes con confirmación")
print("  · Corta: textarea + evaluación por palabras clave")
print("  · Explicación en todos los tipos")
