import { supabase } from './supabase';
import { Materia, PerfilEstudio } from './storage';
import { Asignacion, ObjetivoAgenda } from './agenda';

export interface ClaseHorario {
  id: string;
  nombre: string;
  profesor?: string;
  aula?: string;
  color: string;
  horaInicio: string;
  horaFin: string;
}

export interface Horario {
  lunes: ClaseHorario[];
  martes: ClaseHorario[];
  miercoles: ClaseHorario[];
  jueves: ClaseHorario[];
  viernes: ClaseHorario[];
}

const HORARIO_VACIO: Horario = {
  lunes: [], martes: [], miercoles: [], jueves: [], viernes: [],
};

// ===== MATERIAS =====
export async function getMateriasDB(userId: string): Promise<Materia[]> {
  try {
    const { data, error } = await supabase
      .from('materias')
      .select('datos')
      .eq('user_id', userId)
      .single();
    if (error || !data) return [];
    return data.datos || [];
  } catch { return []; }
}

export async function saveMateriasDB(userId: string, materias: Materia[]): Promise<void> {
  try {
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
  } catch (err) { console.error('Error guardando materias:', err); }
}

// ===== PERFIL =====
export async function getPerfilDB(userId: string): Promise<PerfilEstudio> {
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
  } catch { return empty; }
}

export async function savePerfilDB(userId: string, perfil: PerfilEstudio): Promise<void> {
  try {
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
  } catch (err) { console.error('Error guardando perfil:', err); }
}

// ===== AGENDA =====
export async function getAgendaDB(userId: string): Promise<{ asignaciones: Asignacion[]; objetivos: ObjetivoAgenda[] }> {
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
  } catch { return { asignaciones: [], objetivos: [] }; }
}

export async function saveAgendaDB(
  userId: string,
  asignaciones: Asignacion[],
  objetivos: ObjetivoAgenda[],
): Promise<void> {
  try {
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
  } catch (err) { console.error('Error guardando agenda:', err); }
}

// ===== HORARIO =====
export async function getHorarioDB(userId: string): Promise<Horario> {
  try {
    const { data, error } = await supabase
      .from('horario')
      .select('datos')
      .eq('user_id', userId)
      .single();
    if (error || !data) return HORARIO_VACIO;
    return data.datos || HORARIO_VACIO;
  } catch { return HORARIO_VACIO; }
}

export async function saveHorarioDB(userId: string, horario: Horario): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('horario')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      await supabase
        .from('horario')
        .update({ datos: horario, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } else {
      await supabase
        .from('horario')
        .insert({ user_id: userId, datos: horario });
    }
  } catch (err) { console.error('Error guardando horario:', err); }
}

// ===== SETTINGS =====
export async function getSettingsDB(userId: string): Promise<any> {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('datos')
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    return data.datos;
  } catch { return null; }
}

export async function saveSettingsDB(userId: string, settings: any): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('user_settings')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      await supabase
        .from('user_settings')
        .update({ datos: settings, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } else {
      await supabase
        .from('user_settings')
        .insert({ user_id: userId, datos: settings });
    }
  } catch (err) { console.error('Error guardando settings:', err); }
}