'use client';

import { useState, useEffect } from 'react';
import { useIdioma } from '../hooks/useIdioma';
import { getMaterias, saveMaterias, Materia, Documento } from '../lib/storage';

export default function YoutubeAnalyzer() {
  const { idioma } = useIdioma();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'resumen' | 'flashcards' | 'quiz' | 'apuntes' | 'transcripcion'>('resumen');
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizDone, setQuizDone] = useState(false);
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [selectedMateria, setSelectedMateria] = useState('');
  const [selectedTema, setSelectedTema] = useState('');
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setMaterias(getMaterias());
  }, []);

  const guardarEnMateria = () => {
    if (!selectedMateria || !selectedTema || !result) return;
    setGuardando(true);
    try {
      const nuevasMaterias = getMaterias();
      const mIndex = nuevasMaterias.findIndex((m: Materia) => m.id === selectedMateria);
      if (mIndex === -1) return;
      const tIndex = nuevasMaterias[mIndex].temas.findIndex((t: any) => t.id === selectedTema);
      if (tIndex === -1) return;

      const nuevoDoc: Documento = {
        id: 'yt-' + Date.now(),
        nombre: result.metadata.title,
        tipo: 'youtube',
        fechaSubida: new Date().toLocaleDateString('es-PA'),
        contenido: result.transcriptFull || result.transcript || '',
        youtubeId: result.videoId,
        youtubeThumbnail: result.metadata.thumbnail,
        youtubeChannel: result.metadata.channel || result.metadata.author,
        youtubeWordCount: result.wordCount,
        analisis: {
          summary: result.analysis.summary || '',
          keywords: result.analysis.keywords || [],
          important_phrases: result.analysis.key_points || [],
          topics: result.analysis.topics || [],
          difficulty: result.analysis.difficulty || '',
        },
        flashcards: (result.analysis.flashcards || []).map((f: any) => ({
          question: f.question || f.pregunta || '',
          answer: f.answer || f.respuesta || '',
        })),
        quiz: result.analysis.quiz || [],
      };

      nuevasMaterias[mIndex].temas[tIndex].documentos.push(nuevoDoc);
      saveMaterias(nuevasMaterias);
      setMaterias(getMaterias());
      setGuardado(true);
      setTimeout(() => setGuardado(false), 3000);
    } catch (e) {
      console.error('Error guardando:', e);
    } finally {
      setGuardando(false);
    }
  };

  const steps = idioma === 'en'
    ? ['🔗 Fetching video info...', '📝 Extracting transcript...', '🧠 AI analyzing content...', '✅ Done!']
    : ['🔗 Obteniendo info del video...', '📝 Extrayendo transcripción...', '🧠 IA analizando contenido...', '✅ ¡Listo!'];

  const analizar = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setStep(1);

    const interval = setInterval(() => {
      setStep(prev => prev < 3 ? prev + 1 : prev);
    }, 3000);

    try {
      const res = await fetch('/api/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, idioma }),
      });
      const data = await res.json();
      clearInterval(interval);

      if (!data.success) {
        setError(data.error || 'Error procesando el video');
        setStep(0);
        setLoading(false);
        return;
      }

      setStep(4);
      setResult(data);
      setActiveTab('resumen');
      setFlashcardIndex(0);
      setFlipped(false);
      setQuizAnswers({});
      setQuizDone(false);
    } catch (e: any) {
      clearInterval(interval);
      setError(e.message);
      setStep(0);
    } finally {
      setLoading(false);
    }
  };

  const quizTotal = result?.analysis?.quiz?.length || 0;
  const quizScore = Object.entries(quizAnswers).filter(
    ([i, a]) => a === result?.analysis?.quiz?.[Number(i)]?.correcta
  ).length;

  const tabs = [
    { id: 'resumen', label: idioma === 'en' ? '📋 Summary' : '📋 Resumen' },
    { id: 'flashcards', label: `🎴 Flashcards (${result?.analysis?.flashcards?.length || 0})` },
    { id: 'quiz', label: `🤓 Quiz (${result?.analysis?.quiz?.length || 0})` },
    { id: 'apuntes', label: idioma === 'en' ? '📝 Notes' : '📝 Apuntes' },
    { id: 'transcripcion', label: idioma === 'en' ? '📜 Transcript' : '📜 Transcripción' },
  ];

  return (
    <div style={{ fontFamily: '-apple-system, sans-serif' }}>

      {/* INPUT */}
      {!result && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'linear-gradient(90deg, #ff0000, #ff6b6b)' }} />
          <div style={{ padding: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: '#ff0000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>
                ▶️
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  {idioma === 'en' ? 'Analyze YouTube Video' : 'Analizar Video de YouTube'}
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  {idioma === 'en'
                    ? 'Paste any YouTube link → AI generates flashcards, quiz & notes automatically'
                    : 'Pega cualquier link → IA genera flashcards, quiz y apuntes automáticamente'}
                </p>
              </div>
            </div>

            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && analizar()}
              placeholder="https://youtube.com/watch?v=... o https://youtu.be/..."
              style={{
                width: '100%', padding: '14px 16px', borderRadius: '12px',
                border: `2px solid ${url ? '#ff0000' : 'var(--border-color)'}`,
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                fontSize: '14px', outline: 'none', boxSizing: 'border-box',
                marginBottom: '16px',
              }}
            />

            <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
              💡 {idioma === 'en'
                ? 'The AI will automatically calculate the optimal number of flashcards based on video length'
                : 'La IA calculará automáticamente el número óptimo de flashcards según la duración del video'}
            </div>

            <button
              onClick={analizar}
              disabled={!url.trim() || loading}
              style={{
                width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
                background: url.trim() && !loading ? '#ff0000' : 'var(--bg-card2)',
                color: url.trim() && !loading ? '#fff' : 'var(--text-faint)',
                fontSize: '15px', fontWeight: 900,
                cursor: url.trim() && !loading ? 'pointer' : 'not-allowed',
              }}>
              {loading
                ? (idioma === 'en' ? '⏳ Processing...' : '⏳ Procesando...')
                : (idioma === 'en' ? '🚀 Analyze Video' : '🚀 Analizar Video')}
            </button>

            {/* Steps loading */}
            {loading && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {steps.map((s, i) => (
                  <div key={i} style={{
                    padding: '10px 14px', borderRadius: '10px',
                    background: step > i ? '#ff000015' : 'transparent',
                    border: `1px solid ${step > i ? '#ff0000' : 'var(--border-color)'}`,
                    color: step > i ? '#ff4444' : 'var(--text-faint)',
                    fontSize: '13px', fontWeight: step > i ? 700 : 400,
                    display: 'flex', alignItems: 'center', gap: '8px',
                    transition: 'all 0.4s ease',
                  }}>
                    <span>{step > i + 1 ? '✅' : step === i + 1 ? '⏳' : '⭕'}</span>
                    {s}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div style={{ marginTop: '14px', padding: '14px', borderRadius: '10px', background: 'var(--red-dim)', border: '1px solid var(--red-border)', color: 'var(--red)', fontSize: '13px', fontWeight: 600 }}>
                ❌ {error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* RESULTADO */}
      {result && (
        <div>
          {/* Video card */}
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ height: '3px', background: 'linear-gradient(90deg, #ff0000, #ff6b6b)' }} />
            <div style={{ display: 'flex', gap: '14px', padding: '14px', alignItems: 'center' }}>
              <img
                src={result.metadata.thumbnail}
                alt={result.metadata.title}
                style={{ width: '100px', height: '56px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }}
                onError={(e: any) => { e.target.src = `https://img.youtube.com/vi/${result.videoId}/hqdefault.jpg`; }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {result.metadata.title}
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 6px' }}>
                  📺 {result.metadata.channel} · {result.wordCount?.toLocaleString()} {idioma === 'en' ? 'words' : 'palabras'}
                </p>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: '#ff000020', color: '#ff4444' }}>
                    🎴 {result.analysis.flashcards?.length} flashcards
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--blue-dim)', color: 'var(--blue)' }}>
                    🤓 {result.analysis.quiz?.length} quiz
                  </span>
                  <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: 'var(--gold-dim)', color: 'var(--gold)' }}>
                    ✨ {result.analysis.difficulty}
                  </span>
                </div>
              </div>
              <button
                onClick={() => { setResult(null); setUrl(''); setStep(0); setError(''); }}
                style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                ← {idioma === 'en' ? 'New' : 'Nuevo'}
              </button>
            </div>
          </div>

          {/* GUARDAR EN MATERIA */}
          <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '2px solid var(--gold-border)', padding: '14px 16px', marginBottom: '14px' }}>
            <p style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              💾 {idioma === 'en' ? 'Save to my subjects' : 'Guardar en mis materias'}
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select
                value={selectedMateria}
                onChange={e => { setSelectedMateria(e.target.value); setSelectedTema(''); setGuardado(false); }}
                style={{ flex: 1, minWidth: '140px', padding: '9px 12px', borderRadius: '9px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, outline: 'none' }}>
                <option value="">{idioma === 'en' ? '📚 Select subject...' : '📚 Selecciona materia...'}</option>
                {materias.map((m: Materia) => (
                  <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>
                ))}
              </select>
              <select
                value={selectedTema}
                onChange={e => { setSelectedTema(e.target.value); setGuardado(false); }}
                disabled={!selectedMateria}
                style={{ flex: 1, minWidth: '140px', padding: '9px 12px', borderRadius: '9px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: selectedMateria ? 'var(--text-primary)' : 'var(--text-faint)', fontSize: '13px', fontWeight: 600, outline: 'none' }}>
                <option value="">{idioma === 'en' ? '📁 Select topic...' : '📁 Selecciona tema...'}</option>
                {(materias.find((m: Materia) => m.id === selectedMateria)?.temas || []).map((t: any) => (
                  <option key={t.id} value={t.id}>{t.nombre}</option>
                ))}
              </select>
              <button
                onClick={guardarEnMateria}
                disabled={!selectedTema || guardando || guardado}
                style={{
                  padding: '9px 18px', borderRadius: '9px', border: 'none', fontWeight: 800, fontSize: '13px', cursor: !selectedTema || guardando || guardado ? 'not-allowed' : 'pointer',
                  background: guardado ? '#4ade80' : !selectedTema ? 'var(--bg-card2)' : 'var(--gold)',
                  color: guardado ? '#000' : !selectedTema ? 'var(--text-faint)' : '#000',
                  transition: 'all 0.2s', whiteSpace: 'nowrap',
                }}>
                {guardado ? (idioma === 'en' ? '✅ Saved!' : '✅ ¡Guardado!') : guardando ? '⏳...' : (idioma === 'en' ? '💾 Save' : '💾 Guardar')}
              </button>
            </div>
            {materias.length === 0 && (
              <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px 0 0' }}>
                {idioma === 'en' ? '⚠️ You have no subjects yet. Create one first.' : '⚠️ No tienes materias aún. Crea una primero.'}
              </p>
            )}
          </div>

          {/* TABS */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', overflowX: 'auto', paddingBottom: '4px' }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: '8px 14px', borderRadius: '10px', border: 'none', whiteSpace: 'nowrap',
                  background: activeTab === tab.id ? '#ff0000' : 'var(--bg-card)',
                  color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
                  fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* RESUMEN */}
          {activeTab === 'resumen' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', padding: '20px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  📋 {idioma === 'en' ? 'Summary' : 'Resumen'}
                </h3>
                <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.7, margin: 0 }}>
                  {result.analysis.summary}
                </p>
              </div>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', padding: '20px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--blue)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  🔑 {idioma === 'en' ? 'Key Points' : 'Puntos Clave'}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(result.analysis.key_points || []).map((p: string, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <span style={{ background: 'var(--blue)', color: '#000', width: '20px', height: '20px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, flexShrink: 0, marginTop: '2px' }}>{i + 1}</span>
                      <span style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.6 }}>{p}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', padding: '20px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--pink)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  🏷️ {idioma === 'en' ? 'Keywords' : 'Palabras Clave'}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {(result.analysis.keywords || []).map((k: string, i: number) => (
                    <span key={i} style={{ padding: '5px 12px', borderRadius: '20px', background: 'var(--pink-dim)', border: '1px solid var(--pink-border)', color: 'var(--pink)', fontSize: '12px', fontWeight: 700 }}>
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FLASHCARDS */}
          {activeTab === 'flashcards' && (
            <div>
              {(result.analysis.flashcards || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-faint)' }}>
                  {idioma === 'en' ? 'No flashcards generated' : 'No se generaron flashcards'}
                </div>
              ) : (
                <div>
                  {/* Progreso */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 700 }}>
                      {flashcardIndex + 1} / {result.analysis.flashcards.length}
                    </span>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', height: '6px', width: '60%', overflow: 'hidden' }}>
                      <div style={{ width: `${((flashcardIndex + 1) / result.analysis.flashcards.length) * 100}%`, height: '100%', background: '#ff0000', borderRadius: '6px', transition: 'width 0.3s' }} />
                    </div>
                  </div>

                  {/* Card */}
                  <div
                    className="flip-card"
                    style={{ height: '200px', cursor: 'pointer', marginBottom: '14px' }}
                    onClick={() => setFlipped(!flipped)}
                  >
                    <div className={`flip-card-inner ${flipped ? 'flipped' : ''}`} style={{ width: '100%', height: '100%', position: 'relative' }}>
                      <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%', background: 'var(--bg-card)', borderRadius: '16px', border: '2px solid #ff0000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box' }}>
                        <div style={{ textAlign: 'center' }}>
                          <p style={{ fontSize: '10px', color: '#ff4444', fontWeight: 800, textTransform: 'uppercase', margin: '0 0 10px', letterSpacing: '2px' }}>
                            {idioma === 'en' ? 'QUESTION' : 'PREGUNTA'}
                          </p>
                          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                            {result.analysis.flashcards[flashcardIndex].pregunta}
                          </p>
                          <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '10px 0 0' }}>
                            👆 {idioma === 'en' ? 'Tap to flip' : 'Toca para voltear'}
                          </p>
                        </div>
                      </div>
                      <div className="flip-card-back" style={{ position: 'absolute', width: '100%', height: '100%', background: '#ff000015', borderRadius: '16px', border: '2px solid #ff0000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box' }}>
                        <div style={{ textAlign: 'center' }}>
                          <p style={{ fontSize: '10px', color: '#ff4444', fontWeight: 800, textTransform: 'uppercase', margin: '0 0 10px', letterSpacing: '2px' }}>
                            {idioma === 'en' ? 'ANSWER' : 'RESPUESTA'}
                          </p>
                          <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.6 }}>
                            {result.analysis.flashcards[flashcardIndex].respuesta}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button onClick={() => { setFlashcardIndex(Math.max(0, flashcardIndex - 1)); setFlipped(false); }}
                      disabled={flashcardIndex === 0}
                      style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: flashcardIndex === 0 ? 'var(--text-faint)' : 'var(--text-muted)', fontWeight: 700, cursor: flashcardIndex === 0 ? 'not-allowed' : 'pointer' }}>
                      ← {idioma === 'en' ? 'Prev' : 'Anterior'}
                    </button>
                    <button onClick={() => { setFlashcardIndex(Math.min(result.analysis.flashcards.length - 1, flashcardIndex + 1)); setFlipped(false); }}
                      disabled={flashcardIndex === result.analysis.flashcards.length - 1}
                      style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: flashcardIndex === result.analysis.flashcards.length - 1 ? 'var(--bg-card2)' : '#ff0000', color: flashcardIndex === result.analysis.flashcards.length - 1 ? 'var(--text-faint)' : '#fff', fontWeight: 700, cursor: flashcardIndex === result.analysis.flashcards.length - 1 ? 'not-allowed' : 'pointer' }}>
                      {idioma === 'en' ? 'Next' : 'Siguiente'} →
                    </button>
                  </div>

                  {/* Mini grid de todas las cards */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '14px', justifyContent: 'center' }}>
                    {result.analysis.flashcards.map((_: any, i: number) => (
                      <button key={i} onClick={() => { setFlashcardIndex(i); setFlipped(false); }}
                        style={{ width: '28px', height: '28px', borderRadius: '6px', border: 'none', background: i === flashcardIndex ? '#ff0000' : 'var(--bg-secondary)', color: i === flashcardIndex ? '#fff' : 'var(--text-muted)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* QUIZ */}
          {activeTab === 'quiz' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {quizDone ? (
                <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: `2px solid ${quizScore === quizTotal ? '#4ade80' : 'var(--gold)'}`, padding: '40px', textAlign: 'center' }}>
                  <div style={{ fontSize: '56px', marginBottom: '12px' }}>
                    {quizScore === quizTotal ? '🏆' : quizScore >= quizTotal / 2 ? '🎉' : '📚'}
                  </div>
                  <h2 style={{ fontSize: '32px', fontWeight: 900, color: quizScore === quizTotal ? '#4ade80' : 'var(--gold)', margin: '0 0 6px' }}>
                    {quizScore}/{quizTotal}
                  </h2>
                  <p style={{ color: 'var(--text-muted)', margin: '0 0 8px', fontSize: '16px' }}>
                    {Math.round((quizScore / quizTotal) * 100)}% {idioma === 'en' ? 'correct' : 'correcto'}
                  </p>
                  <p style={{ color: 'var(--text-faint)', margin: '0 0 24px', fontSize: '13px' }}>
                    {quizScore === quizTotal
                      ? (idioma === 'en' ? '🔥 Perfect score!' : '🔥 ¡Perfecto!')
                      : quizScore >= quizTotal / 2
                      ? (idioma === 'en' ? '👍 Good job!' : '👍 ¡Buen trabajo!')
                      : (idioma === 'en' ? '📖 Keep studying!' : '📖 ¡Sigue estudiando!')}
                  </p>
                  <button onClick={() => { setQuizAnswers({}); setQuizDone(false); }}
                    style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, cursor: 'pointer', fontSize: '14px' }}>
                    🔄 {idioma === 'en' ? 'Try again' : 'Intentar de nuevo'}
                  </button>
                </div>
              ) : (
                <>
                  {(result.analysis.quiz || []).map((q: any, i: number) => (
                    <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                      <div style={{ height: '3px', background: quizAnswers[i] !== undefined ? (quizAnswers[i] === q.correcta ? '#4ade80' : 'var(--red)') : 'var(--border-color)' }} />
                      <div style={{ padding: '16px' }}>
                        <p style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px' }}>
                          {i + 1}. {q.pregunta}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {(q.opciones || []).map((op: string, j: number) => {
                            const answered = quizAnswers[i] !== undefined;
                            const isSelected = quizAnswers[i] === j;
                            const isCorrect = j === q.correcta;
                            let bg = 'var(--bg-secondary)';
                            let border = 'var(--border-color)';
                            let color = 'var(--text-primary)';
                            if (answered && isCorrect) { bg = '#4ade8020'; border = '#4ade80'; color = '#4ade80'; }
                            else if (answered && isSelected) { bg = 'var(--red-dim)'; border = 'var(--red)'; color = 'var(--red)'; }
                            return (
                              <button key={j}
                                onClick={() => {
                                  if (quizAnswers[i] !== undefined) return;
                                  setQuizAnswers(prev => ({ ...prev, [i]: j }));
                                }}
                                style={{ padding: '10px 14px', borderRadius: '10px', border: `2px solid ${border}`, background: bg, color, fontSize: '13px', fontWeight: 600, cursor: answered ? 'default' : 'pointer', textAlign: 'left', transition: 'all 0.2s' }}>
                                <span style={{ fontWeight: 800, marginRight: '6px' }}>{['A', 'B', 'C', 'D'][j]}.</span> {op}
                                {answered && isCorrect && <span style={{ marginLeft: '8px' }}>✅</span>}
                                {answered && isSelected && !isCorrect && <span style={{ marginLeft: '8px' }}>❌</span>}
                              </button>
                            );
                          })}
                        </div>
                        {quizAnswers[i] !== undefined && q.explicacion && (
                          <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', background: 'var(--gold-dim)', border: '1px solid var(--gold-border)', fontSize: '12px', color: 'var(--gold)', fontWeight: 600 }}>
                            💡 {q.explicacion}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {Object.keys(quizAnswers).length === quizTotal && quizTotal > 0 && (
                    <button onClick={() => setQuizDone(true)}
                      style={{ padding: '14px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 900, cursor: 'pointer' }}>
                      🎉 {idioma === 'en' ? 'See results' : 'Ver resultados'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* APUNTES */}
          {activeTab === 'apuntes' && (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  📝 {idioma === 'en' ? 'Generated Notes' : 'Apuntes Generados'}
                </h3>
                <button
                  onClick={() => { navigator.clipboard.writeText(result.analysis.apuntes || ''); }}
                  style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  📋 {idioma === 'en' ? 'Copy' : 'Copiar'}
                </button>
              </div>
              <pre style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
                {result.analysis.apuntes}
              </pre>
            </div>
          )}

          {/* TRANSCRIPCIÓN */}
          {activeTab === 'transcripcion' && (
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  📜 {idioma === 'en' ? 'Transcript' : 'Transcripción'}
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                  {result.wordCount?.toLocaleString()} {idioma === 'en' ? 'words' : 'palabras'}
                </span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.8, margin: 0 }}>
                {result.transcript}
                {result.transcript?.endsWith('...') && (
                  <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>
                    {idioma === 'en' ? ' (preview only)' : ' (vista previa)'}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
