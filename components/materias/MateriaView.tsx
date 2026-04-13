'use client';

import { Materia, Tema } from '../../lib/storage';

interface Props {
  materia: Materia;
  onBack: () => void;
  onAbrirTema: (t: Tema) => void;
  onEliminarTema: (id: string) => void;
  onNuevoTema: () => void;
}

export default function MateriaView({ materia, onBack, onAbrirTema, onEliminarTema, onNuevoTema }: Props) {
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>
          📚 Materias
        </button>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <span style={{ color: materia.color, fontWeight: 700, fontSize: '14px' }}>{materia.emoji} {materia.nombre}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '60px', height: '60px', borderRadius: '16px', background: materia.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>
            {materia.emoji}
          </div>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{materia.nombre}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>{materia.temas.length} temas</p>
          </div>
        </div>
        <button onClick={onNuevoTema}
          style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: materia.color, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
          + Nuevo Tema
        </button>
      </div>

      {materia.temas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: '60px', marginBottom: '16px' }}>📁</div>
          <p style={{ fontSize: '18px', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '24px' }}>No hay temas todavía</p>
          <button onClick={onNuevoTema}
            style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: materia.color, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
            + Crear primer tema
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
          {materia.temas.map(tema => (
            <div key={tema.id}
              style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', transition: 'all 0.2s ease' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLDivElement).style.borderColor = tema.color; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color)'; }}
            >
              <div style={{ height: '4px', background: tema.color }} />
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div onClick={() => onAbrirTema(tema)} style={{ cursor: 'pointer', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: tema.color }} />
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tema.nombre}</h3>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>✏️ {tema.apuntes.length} apuntes</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>📄 {tema.documentos.length} docs</span>
                    </div>
                  </div>
                  <button onClick={() => onEliminarTema(tema.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '16px' }}>
                    🗑️
                  </button>
                </div>
                <button onClick={() => onAbrirTema(tema)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                  Abrir →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}