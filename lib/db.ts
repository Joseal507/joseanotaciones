import { supabase } from './supabase';
import { Materia, PerfilEstudio } from './storage';
import { Asignacion, ObjetivoAgenda } from './agenda';

// ===== MATERIAS =====
export const getMateriasDB = async (userId: string): Promise<Materia[]> => {
  try {
    const { data, error } = await supabase
      .from('materias')
      .select('datos')
      .eq('user_id', userId)
      .single();

    if (error || !data) return [];
    return data.datos || [];
  } catch {
    return [];
  }
};

export const saveMateriasDB = async (userId: string, materias: Materia[]) => {
  try {
    const { data: existing } = await supabase
      .from('materias')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      await supabase
        .from('materias')
        .update({
          datos: materias,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } else {
      await supabase
        .from('materias')
        .insert({
          user_id: userId,
          datos: materias,
        });
    }
  } catch (err) {
    console.error('Error guardando materias:', err);
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

  try {
    const { data, error } = await supabase
      .from('perfil_estudio')
      .select('datos')
      .eq('user_id', userId)
      .single();

    if (error || !data) return empty;
    return data.datos || empty;
  } catch {
    return empty;
  }
};

export const savePerfilDB = async (userId: string, perfil: PerfilEstudio) => {
  try {
    const { data: existing } = await supabase
      .from('perfil_estudio')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      await supabase
        .from('perfil_estudio')
        .update({
          datos: perfil,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } else {
      await supabase
        .from('perfil_estudio')
        .insert({
          user_id: userId,
          datos: perfil,
        });
    }
  } catch (err) {
    console.error('Error guardando perfil:', err);
  }
};

// ===== AGENDA =====
export const getAgendaDB = async (userId: string) => {
  try {
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
  } catch {
    return { asignaciones: [], objetivos: [] };
  }
};

export const saveAgendaDB = async (
  userId: string,
  asignaciones: Asignacion[],
  objetivos: ObjetivoAgenda[],
) => {
  try {
    const { data: existing } = await supabase
      .from('agenda')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      await supabase
        .from('agenda')
        .update({
          asignaciones,
          objetivos,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    } else {
      await supabase
        .from('agenda')
        .insert({
          user_id: userId,
          asignaciones,
          objetivos,
        });
    }
  } catch (err) {
    console.error('Error guardando agenda:', err);
  }
};