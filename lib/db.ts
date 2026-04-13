import { supabase } from './supabase';
import { Materia, PerfilEstudio } from './storage';
import { Asignacion, ObjetivoAgenda } from './agenda';

// ===== MATERIAS =====
export const getMateriasDB = async (userId: string): Promise<Materia[]> => {
  const { data, error } = await supabase
    .from('materias')
    .select('datos')
    .eq('user_id', userId)
    .single();

  if (error || !data) return [];
  return data.datos || [];
};

export const saveMateriasDB = async (userId: string, materias: Materia[]) => {
  const { data: existing } = await supabase
    .from('materias')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    await supabase
      .from('materias')
      .update({ datos: materias, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } else {
    await supabase
      .from('materias')
      .insert({ user_id: userId, datos: materias });
  }
};

// ===== PERFIL =====
export const getPerfilDB = async (userId: string): Promise<PerfilEstudio> => {
  const empty: PerfilEstudio = {
    flashcardsFalladas: {},
    flashcardsAcertadas: {},
    materiasStats: {},
    sesiones: [],
  };

  const { data, error } = await supabase
    .from('perfil_estudio')
    .select('datos')
    .eq('user_id', userId)
    .single();

  if (error || !data) return empty;
  return data.datos || empty;
};

export const savePerfilDB = async (userId: string, perfil: PerfilEstudio) => {
  const { data: existing } = await supabase
    .from('perfil_estudio')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    await supabase
      .from('perfil_estudio')
      .update({ datos: perfil, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } else {
    await supabase
      .from('perfil_estudio')
      .insert({ user_id: userId, datos: perfil });
  }
};

// ===== AGENDA =====
export const getAgendaDB = async (userId: string) => {
  const { data, error } = await supabase
    .from('agenda')
    .select('asignaciones, objetivos')
    .eq('user_id', userId)
    .single();

  if (error || !data) return { asignaciones: [], objetivos: [] };
  return {
    asignaciones: data.asignaciones || [],
    objetivos: data.objetivos || [],
  };
};

export const saveAgendaDB = async (
  userId: string,
  asignaciones: Asignacion[],
  objetivos: ObjetivoAgenda[],
) => {
  const { data: existing } = await supabase
    .from('agenda')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    await supabase
      .from('agenda')
      .update({ asignaciones, objetivos, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } else {
    await supabase
      .from('agenda')
      .insert({ user_id: userId, asignaciones, objetivos });
  }
};