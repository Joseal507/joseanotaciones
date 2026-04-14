'use client';

import { useState, useEffect, useRef } from 'react';

interface Analisis {
  keywords: string[];
  important_phrases: string[];
  summary: string;
}

interface Props {
  contenido: string;
  tipo: string;
  nombre: string;
  archivoUrl?: string;
  analisis?: Analisis;
  temaColor: string;
}

export default function VisorDocumento({ contenido, tipo, nombre, archivoUrl, analisis, temaColor }: Props) {
  const [vistaActiva, setVistaActiva] = useState<'original' | 'texto'>('original');
  const [fontSize, setFontSize] = useState(15);
  const [mostrarHighlights, setMostrarHighlights] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const tieneOriginal = !!archivoUrl;

  // Si no tiene original, mostrar texto
  useEffect(() => {
    if (!tieneOriginal) setVistaActiva('texto');
  }, [tieneOriginal]);

  const renderConHighlights = (texto: string) => {
    if (!analisis || !mostrarHighlights) {
      return <span style={{ color: '#333' }}>{texto}</span>;
    }

    let remaining = texto;
    const phrases = [...(analisis.important_phrases || [])];
    const keywords = [...(analisis.keywords || [])];
    phrases.sort((a, b) => b.length - a.length);

    phrases.forEach(p => {
      try {
        remaining = remaining.replace(
          new RegExp(`(${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
          `|||PHRASE:$1|||`
        );
      } catch {}
    });

    keywords.forEach(k => {
      try {
        remaining = remaining.replace(
          new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
          `|||KEYWORD:$1|||`
        );
      } catch {}
    });

    const parts: { text: string; type: string }[] = [];
    remaining.split('|||').forEach(seg => {
      if (seg.startsWith('PHRASE:')) parts.push({ text: seg.replace('PHRASE:', ''), type: 'phrase' });
      else if (seg.startsWith('KEYWORD:')) parts.push({ text: seg.replace('KEYWORD:', ''), type: 'keyword' });
      else if (seg) parts.push({ text: seg, type: 'normal' });
    });

    return (
      <span>
        {parts.map((p, i) => {
          if (p.type === 'phrase') return (
            <mark key={i} style={{ background: temaColor, color: '#000', borderRadius: '3px', padding: '1px 4px', fontWeight: 700, textDecoration: 'none' }}>
              {p.text}
            </mark>
          );
          if (p.type === 'keyword') return (
            <mark key={i} style={{ background: '#38bdf8', color: '#000', borderRadius: '3px', padding: '1px 4px', fontWeight: 600, textDecoration: 'none' }}>
              {p.text}
            </mark>
          );
          return <span key={i} style={{ color: '#333' }}>{p.text}</span>;
        })}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0', height: '100%' }}>

      {/* Toolbar */}
      <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>

        {/* Tabs original / texto */}
        {tieneOriginal && (
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-card)', borderRadius: '10px', padding: '4px' }}>
            {[
              { id: 'original', label: tipo === 'pdf' ? '📄 PDF' : tipo === 'word' ? '📝 Word' : '📄 Original' },
              { id: 'texto', label: '📖 Texto' },
            ].map(v => (
              <button key={v.id} onClick={() => setVistaActiva(v.id as any)}
                style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: vistaActiva === v.id ? temaColor : 'transparent', color: vistaActiva === v.id ? '#000' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
                {v.label}
              </button>
            ))}
          </div>
        )}

        {/* Controles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Highlights toggle */}
          {analisis && vistaActiva === 'texto' && (
            <button onClick={() => setMostrarHighlights(!mostrarHighlights)}
              style={{ padding: '6px 12px', borderRadius: '8px', border: `2px solid ${mostrarHighlights ? temaColor : 'var(--border-color)'}`, background: mostrarHighlights ? temaColor + '20' : 'transparent', color: mostrarHighlights ? temaColor : 'var(--text-muted)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
              ✨ {mostrarHighlights ? 'Highlights ON' : 'Highlights OFF'}
            </button>
          )}

          {/* Tamaño fuente - solo en vista texto */}
          {vistaActiva === 'texto' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button onClick={() => setFontSize(f => Math.max(11, f - 1))}
                style={{ padding: '4px 9px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontWeight: 700 }}>A−</button>
              <span style={{ fontSize: '11px', color: 'var(--text-faint)', minWidth: '28px', textAlign: 'center' }}>{fontSize}</span>
              <button onClick={() => setFontSize(f => Math.min(24, f + 1))}
                style={{ padding: '4px 9px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontWeight: 700 }}>A+</button>
            </div>
          )}

          <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
            {contenido.split(' ').length} palabras
          </span>
        </div>
      </div>

      {/* Leyenda highlights */}
      {analisis && mostrarHighlights && vistaActiva === 'texto' && (
        <div style={{ padding: '8px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '16px', height: '10px', borderRadius: '3px', background: temaColor }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Frases importantes</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '16px', height: '10px', borderRadius: '3px', background: '#38bdf8' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Palabras clave</span>
          </div>
        </div>
      )}

      {/* Visor PDF/Word */}
      {vistaActiva === 'original' && tieneOriginal && (
        <div style={{ flex: 1, minHeight: '500px', background: '#525659' }}>
          {tipo === 'pdf' ? (
            <iframe
              ref={iframeRef}
              src={archivoUrl}
              style={{ width: '100%', height: '100%', minHeight: '600px', border: 'none' }}
              title={nombre}
            />
          ) : tipo === 'word' ? (
            <div style={{ padding: '32px', background: '#fff', height: '100%', overflowY: 'auto' }}>
              <div style={{ maxWidth: '700px', margin: '0 auto', background: '#fff', padding: '40px', boxShadow: '0 2px 20px rgba(0,0,0,0.1)', minHeight: '500px' }}>
                <p style={{ fontSize: '13px', color: '#666', marginBottom: '24px', borderBottom: '1px solid #eee', paddingBottom: '12px' }}>
                  📝 {nombre}
                </p>
                {contenido.split('\n').map((p, i) => (
                  p.trim() && (
                    <p key={i} style={{ fontSize: '15px', lineHeight: 1.8, color: '#222', margin: '0 0 14px', fontFamily: 'Georgia, serif' }}>
                      {p}
                    </p>
                  )
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: '32px', background: '#fff', height: '100%', overflowY: 'auto', fontFamily: 'monospace', fontSize: '14px', color: '#333', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {contenido}
            </div>
          )}
        </div>
      )}

      {/* Vista texto con highlights */}
      {vistaActiva === 'texto' && (
        <div style={{ flex: 1, padding: '28px 36px', background: '#ffffff', overflowY: 'auto', minHeight: '500px' }}>
          {contenido.split('\n').map((parrafo, i) => (
            parrafo.trim() && (
              <p key={i} style={{ marginBottom: '16px', lineHeight: 1.9, fontSize: `${fontSize}px`, color: '#222', fontFamily: 'Georgia, serif' }}>
                {renderConHighlights(parrafo)}
              </p>
            )
          ))}
        </div>
      )}
    </div>
  );
}