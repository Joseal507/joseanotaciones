// ===== HORARIO =====
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

export const getHorarioDB = async (userId: string): Promise<Horario> => {
  try {
    const { data, error } = await supabase
      .from('horario')
      .select('datos')
      .eq('user_id', userId)
      .single();
    if (error || !data) return HORARIO_VACIO;
    return data.datos || HORARIO_VACIO;
  } catch {
    return HORARIO_VACIO;
  }
};

export const saveHorarioDB = async (userId: string, horario: Horario) => {
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
  } catch (err) {
    console.error('Error guardando horario:', err);
  }
};