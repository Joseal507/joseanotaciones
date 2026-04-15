'use client';

import { Materia } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';

interface Props {
  materias: Materia[];
  onAbrir: (m: Materia) => void;
  onEliminar: (id: string) => void;
  onNueva: () => void;
}

export default function MateriasList({ materias, onAbrir, onEliminar, onNueva }: Props) {
  const { tr, idioma } = useIdioma();

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '6px', height: '40px', background: 'var(--gold)', borderRadius: '3px' }} />
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{tr('misMaterias')}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>{materias.length} {tr('materias').toLowerCase()}</p>
          </div>
        </div>
        <button onClick={onNueva}
          style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
          + {idioma === 'en' ? 'New Subject' : 'Nueva Materia'}
        </button>
      </div>

      {materias.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: '72px', marginBottom: '16px' }}>📚</div>
          <p style={{ fontSize: '20px', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '24px' }}>{tr('sinMaterias')}</p>
          <button onClick={onNueva}
            style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
            + {idioma === 'en' ? 'Create first subject' : 'Crear primera materia'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
          {materias.map(materia => (
            <div key={materia.id}
              style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden', transition: 'all 0.2s ease' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLDivElement).style.borderColor = materia.color; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color)'; }}
            >
              <div style={{ height: '5px', background: materia.color }} />
              <div style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div onClick={() => onAbrir(materia)} style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, cursor: 'pointer' }}>
                    <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: materia.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                      {materia.emoji}
                    </div>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>{materia.nombre}</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{materia.temas.length} {tr('temas')}</p>
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); onEliminar(materia.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '18px' }}>
                    🗑️
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { label: idioma === 'en' ? 'Topics' : 'Temas', val: materia.temas.length },
                    { label: idioma === 'en' ? 'Notes' : 'Apuntes', val: materia.temas.reduce((a, t) => a + t.apuntes.length, 0) },
                    { label: 'Docs', val: materia.temas.reduce((a, t) => a + t.documentos.length, 0) },
                  ].map((s, i) => (
                    <div key={i} style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: 900, color: materia.color }}>{s.val}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <button onClick={() => onAbrir(materia)}
                  style={{ width: '100%', marginTop: '16px', padding: '10px', borderRadius: '10px', border: `2px solid ${materia.color}`, background: 'transparent', color: materia.color, fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                  {idioma === 'en' ? 'Open subject →' : 'Abrir materia →'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}