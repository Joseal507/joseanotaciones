'use client';

import { useState, useEffect } from 'react';
import {
  getMaterias, saveMaterias, generateId,
  Materia, Tema, Apunte, Documento,
} from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { getMateriasDB, saveMateriasDB, getAgendaDB, saveAgendaDB } from '../../lib/db';
import { savePerfil, getPerfil } from '../../lib/storage';
import MateriasList from '../../components/materias/MateriasList';
import MateriaView from '../../components/materias/MateriaView';
import TemaView from '../../components/materias/TemaView';
import ApunteEditor from '../../components/materias/ApunteEditor';
import DocumentoView from '../../components/materias/DocumentoView';
import { ModalMateria, ModalTema, ModalApunte } from '../../components/materias/Modales';

type Vista = 'materias' | 'materia' | 'tema' | 'apunte' | 'documento';

export default function MateriasPage() {
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [vista, setVista] = useState<Vista>('materias');
  const [materiaActual, setMateriaActual] = useState<Materia | null>(null);
  const [temaActual, setTemaActual] = useState<Tema | null>(null);
  const [apunteActual, setApunteActual] = useState<Apunte | null>(null);
  const [documentoActual, setDocumentoActual] = useState<Documento | null>(null);
  const [modalMateria, setModalMateria] = useState(false);
  const [modalTema, setModalTema] = useState(false);
  const [modalApunte, setModalApunte] = useState(false);
  const [subiendoDoc, setSubiendoDoc] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      try {
        const { data } = await supabase.auth.getUser();

        if (data.user) {
          setUserId(data.user.id);

          // Limpiar localStorage del usuario anterior
          const lastUserId = localStorage.getItem('josea_last_user');
          if (lastUserId !== data.user.id) {
            // Usuario diferente — limpiar todos los datos locales
            localStorage.setItem('josea_last_user', data.user.id);
            saveMaterias([]);
            localStorage.removeItem('josea_perfil');
            localStorage.removeItem('josea_asignaciones');
            localStorage.removeItem('josea_objetivos');
          }

          // Cargar materias desde Supabase
          const materiasDB = await getMateriasDB(data.user.id);
          setMaterias(materiasDB);
          saveMaterias(materiasDB);

        } else {
          window.location.href = '/auth';
        }
      } catch (err) {
        console.error(err);
        setMaterias([]);
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, []);

  const save = async (m: Materia[]) => {
    setMaterias(m);
    saveMaterias(m);
    if (userId) {
      await saveMateriasDB(userId, m);
    }
  };

  const actualizarMateria = (materia: Materia) => {
    const nuevas = materias.map(m => m.id === materia.id ? materia : m);
    save(nuevas);
    setMateriaActual(materia);
  };

  const actualizarTema = (tema: Tema) => {
    if (!materiaActual) return;
    const nuevaMateria = {
      ...materiaActual,
      temas: materiaActual.temas.map(t => t.id === tema.id ? tema : t),
    };
    actualizarMateria(nuevaMateria);
    setTemaActual(tema);
  };

  const actualizarApunte = (apunte: Apunte) => {
    if (!temaActual) return;
    const nuevoTema = {
      ...temaActual,
      apuntes: temaActual.apuntes.map(a => a.id === apunte.id ? apunte : a),
    };
    actualizarTema(nuevoTema);
    setApunteActual(apunte);
  };

  const actualizarDocumento = (doc: Documento) => {
    if (!temaActual) return;
    const nuevoTema = {
      ...temaActual,
      documentos: temaActual.documentos.map(d => d.id === doc.id ? doc : d),
    };
    actualizarTema(nuevoTema);
    setDocumentoActual(doc);
  };

  const crearMateria = (data: { nombre: string; color: string; emoji: string }) => {
    const nueva: Materia = {
      id: generateId(),
      nombre: data.nombre,
      color: data.color,
      emoji: data.emoji,
      temas: [],
    };
    save([...materias, nueva]);
    setModalMateria(false);
  };

  const eliminarMateria = (id: string) => {
    if (!confirm('¿Eliminar esta materia y todo su contenido?')) return;
    save(materias.filter(m => m.id !== id));
  };

  const crearTema = (data: { nombre: string; color: string }) => {
    if (!materiaActual) return;
    const nuevo: Tema = {
      id: generateId(),
      nombre: data.nombre,
      color: data.color,
      apuntes: [],
      documentos: [],
    };
    actualizarMateria({ ...materiaActual, temas: [...materiaActual.temas, nuevo] });
    setModalTema(false);
  };

  const eliminarTema = (id: string) => {
    if (!confirm('¿Eliminar este tema?')) return;
    if (!materiaActual) return;
    actualizarMateria({
      ...materiaActual,
      temas: materiaActual.temas.filter(t => t.id !== id),
    });
  };

  const crearApunte = (data: { titulo: string }) => {
    if (!temaActual) return;
    const nuevo: Apunte = {
      id: generateId(),
      titulo: data.titulo,
      contenido: '',
      fechaCreacion: new Date().toLocaleDateString('es-ES'),
      fechaModificacion: new Date().toLocaleDateString('es-ES'),
    };
    const nuevoTema = { ...temaActual, apuntes: [...temaActual.apuntes, nuevo] };
    actualizarTema(nuevoTema);
    setApunteActual(nuevo);
    setModalApunte(false);
    setVista('apunte');
  };

  const guardarApunte = (contenido: string) => {
    if (!apunteActual) return;
    actualizarApunte({
      ...apunteActual,
      contenido,
      fechaModificacion: new Date().toLocaleDateString('es-ES'),
    });
  };

  const eliminarApunte = (id: string) => {
    if (!confirm('¿Eliminar este apunte?')) return;
    if (!temaActual) return;
    actualizarTema({ ...temaActual, apuntes: temaActual.apuntes.filter(a => a.id !== id) });
    setVista('tema');
  };

  const subirDocumento = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !temaActual) return;
    const file = e.target.files[0];
    setSubiendoDoc(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      const nuevoDoc: Documento = {
        id: generateId(),
        nombre: file.name,
        contenido: data.content,
        tipo: file.name.endsWith('.pdf') ? 'pdf' : 'txt',
        fechaSubida: new Date().toLocaleDateString('es-ES'),
      };
      actualizarTema({ ...temaActual, documentos: [...temaActual.documentos, nuevoDoc] });
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSubiendoDoc(false);
      e.target.value = '';
    }
  };

  const eliminarDocumento = (id: string) => {
    if (!confirm('¿Eliminar este documento?')) return;
    if (!temaActual) return;
    actualizarTema({ ...temaActual, documentos: temaActual.documentos.filter(d => d.id !== id) });
    setVista('tema');
  };

  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '48px' }}>📚</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 600 }}>
          Cargando tus materias...
        </p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '32px 40px', fontFamily: '-apple-system, sans-serif' }}>

      <div style={{ maxWidth: '1100px', margin: '0 auto 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => window.location.href = '/'}
            style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ← Volver al inicio
          </button>
          {userId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-faint)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80' }} />
              Sincronizado en la nube ☁️
            </div>
          )}
        </div>
      </div>

      {vista === 'materias' && (
        <MateriasList
          materias={materias}
          onAbrir={m => { setMateriaActual(m); setVista('materia'); }}
          onEliminar={eliminarMateria}
          onNueva={() => setModalMateria(true)}
        />
      )}

      {vista === 'materia' && materiaActual && (
        <MateriaView
          materia={materiaActual}
          onBack={() => setVista('materias')}
          onAbrirTema={t => { setTemaActual(t); setVista('tema'); }}
          onEliminarTema={eliminarTema}
          onNuevoTema={() => setModalTema(true)}
        />
      )}

      {vista === 'tema' && temaActual && materiaActual && (
        <TemaView
          materia={materiaActual}
          tema={temaActual}
          onBack={() => setVista('materias')}
          onBackMateria={() => setVista('materia')}
          onAbrirApunte={a => { setApunteActual(a); setVista('apunte'); }}
          onAbrirDocumento={d => { setDocumentoActual(d); setVista('documento'); }}
          onEliminarApunte={eliminarApunte}
          onEliminarDocumento={eliminarDocumento}
          onNuevoApunte={() => setModalApunte(true)}
          onSubirDocumento={subirDocumento}
          subiendoDoc={subiendoDoc}
        />
      )}

      {vista === 'apunte' && apunteActual && materiaActual && temaActual && (
        <ApunteEditor
          apunte={apunteActual}
          materia={materiaActual}
          tema={temaActual}
          onBack={() => setVista('materias')}
          onBackMateria={() => setVista('materia')}
          onBackTema={() => setVista('tema')}
          onGuardar={guardarApunte}
        />
      )}

      {vista === 'documento' && documentoActual && materiaActual && temaActual && (
        <DocumentoView
          documento={documentoActual}
          materia={materiaActual}
          tema={temaActual}
          onBack={() => setVista('materias')}
          onBackMateria={() => setVista('materia')}
          onBackTema={() => setVista('tema')}
          onActualizar={actualizarDocumento}
        />
      )}

      {modalMateria && (
        <ModalMateria
          onClose={() => setModalMateria(false)}
          onConfirm={crearMateria}
        />
      )}
      {modalTema && materiaActual && (
        <ModalTema
          onClose={() => setModalTema(false)}
          onConfirm={crearTema}
          colorMateria={materiaActual.color}
        />
      )}
      {modalApunte && temaActual && (
        <ModalApunte
          onClose={() => setModalApunte(false)}
          onConfirm={crearApunte}
          colorTema={temaActual.color}
        />
      )}
    </div>
  );
}