'use client';

import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('../PDFViewer'), {
  ssr: false,
  loading: () => <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>⏳ Cargando PDF...</div>,
});

interface Analysis {
  keywords: string[];
  important_phrases: string[];
  summary: string;
}

interface Props {
  documentContent: string;
  analysis: Analysis | null;
  flashcardsLength: number;
  pdfUrl: string;
  fileType: string;
  onGoUpload: () => void;
}

export default function DocumentScreen({ documentContent, analysis, flashcardsLength, pdfUrl, fileType, onGoUpload }: Props) {

  const highlightText = (text: string) => {
    if (!analysis) return <span style={{ color: 'var(--text-secondary)' }}>{text}</span>;
    let remaining = text;
    analysis.important_phrases?.forEach(p => { remaining = remaining.replace(new RegExp(`(${p})`, 'gi'), `|||PHRASE:$1|||`); });
    analysis.keywords?.forEach(k => { remaining = remaining.replace(new RegExp(`(${k})`, 'gi'), `|||KEYWORD:$1|||`); });
    const parts: { text: string; type: string }[] = [];
    remaining.split('|||').forEach(seg => {
      if (seg.startsWith('PHRASE:')) parts.push({ text: seg.replace('PHRASE:', ''), type: 'phrase' });
      else if (seg.startsWith('KEYWORD:')) parts.push({ text: seg.replace('KEYWORD:', ''), type: 'keyword' });
      else if (seg) parts.push({ text: seg, type: 'normal' });
    });
    return (
      <span>
        {parts.map((p, i) => {
          if (p.type === 'phrase') return <mark key={i} style={{ background: 'var(--gold)', color: '#000', borderRadius: '4px', padding: '1px 5px', fontWeight: 700 }}>{p.text}</mark>;
          if (p.type === 'keyword') return <mark key={i} style={{ background: 'var(--blue)', color: '#000', borderRadius: '4px', padding: '1px 5px', fontWeight: 600 }}>{p.text}</mark>;
          return <span key={i} style={{ color: 'var(--text-secondary)' }}>{p.text}</span>;
        })}
      </span>
    );
  };

  if (!documentContent) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <div style={{ fontSize: '72px', marginBottom: '16px' }}>📭</div>
        <p style={{ fontSize: '18px', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '24px' }}>Sube un documento primero</p>
        <button onClick={onGoUpload} style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          📤 Subir documento
        </button>
      </div>
    );
  }

  const paneles = [
    { title: 'Resumen', color: 'var(--pink)', content: <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{analysis?.summary}</p> },
    {
      title: 'Palabras Clave', color: 'var(--blue)', content: (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {analysis?.keywords?.map((k, i) => <span key={i} style={{ background: 'var(--blue)', color: '#000', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>{k}</span>)}
        </div>
      )
    },
    {
      title: 'Frases Importantes', color: 'var(--gold)', content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {analysis?.important_phrases?.map((p, i) => <div key={i} style={{ background: 'var(--gold)', color: '#000', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>{p}</div>)}
        </div>
      )
    },
    {
      title: 'Estadísticas', color: 'var(--red)', content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            { label: 'Palabras', val: documentContent.split(' ').length },
            { label: 'Keywords', val: analysis?.keywords?.length || 0 },
            { label: 'Flashcards', val: flashcardsLength },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{s.label}</span>
              <span style={{ background: 'var(--red)', color: '#000', padding: '2px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: 700 }}>{s.val}</span>
            </div>
          ))}
        </div>
      )
    },
  ];

  return (
    <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: 'var(--blue)' }} />
        <div style={{ padding: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '4px', height: '24px', background: 'var(--blue)', borderRadius: '2px' }} />
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Tu Documento</h2>
            </div>
            <span style={{ background: 'var(--blue)', color: '#000', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>
              {documentContent.split(' ').length} palabras
            </span>
          </div>

          {analysis && (
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '20px', height: '10px', borderRadius: '3px', background: 'var(--blue)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Palabras clave</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '20px', height: '10px', borderRadius: '3px', background: 'var(--gold)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Frases importantes</span>
              </div>
            </div>
          )}

          {fileType === 'pdf' && pdfUrl ? (
            <PDFViewer fileUrl={pdfUrl} keywords={analysis?.keywords || []} importantPhrases={analysis?.important_phrases || []} />
          ) : (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '24px', maxHeight: '580px', overflowY: 'auto', border: '1px solid var(--border-color)', lineHeight: 1.9, fontSize: '15px' }}>
              {documentContent.split('\n').map((p, i) => p.trim() && <p key={i} style={{ marginBottom: '16px' }}>{highlightText(p)}</p>)}
            </div>
          )}
        </div>
      </div>

      {analysis && (
        <div style={{ width: '260px', display: 'flex', flexDirection: 'column', gap: '16px', flexShrink: 0 }}>
          {paneles.map((panel, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: panel.color }} />
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <div style={{ width: '4px', height: '16px', background: panel.color, borderRadius: '2px' }} />
                  <h3 style={{ fontSize: '12px', fontWeight: 800, color: panel.color, textTransform: 'uppercase', letterSpacing: '1.5px', margin: 0 }}>{panel.title}</h3>
                </div>
                {panel.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}