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

// ✅ Limpiar base64 e imágenes pesadas antes de guardar
const limpiarMaterias = (materias: Materia[]): any[] => {
  return materias.map(m => ({
    ...m,
    temas: m.temas.map(t => ({
      ...t,
      apuntes: t.apuntes.map(a => ({
        ...a,
        // ✅ Limpiar canvasData base64 de los apuntes (se guarda por separado)
        contenido: limpiarContenidoApunte(a.contenido),
      })),
      documentos: t.documentos.map(d => {
        const { archivoBase64, archivoUrl, ...resto } = d as any;
        return resto;
      }),
    })),
  }));
};

// ✅ Limpiar base64 de canvas y fondos PDF del contenido JSON de apuntes
const limpiarContenidoApunte = (contenido: string): string => {
  if (!contenido) return contenido;
  try {
    const parsed = JSON.parse(contenido);
    if (parsed?.paginas) {
      parsed.paginas = parsed.paginas.map((pg: any) => ({
        ...pg,
        // ✅ Eliminar canvasData base64 pesado
        canvasData: pg.canvasData ? '[canvas]' : null,
        // ✅ Eliminar backgroundImage base64 pesado
        backgroundImage: pg.backgroundImage?.startsWith('data:')
          ? '[image]'
          : pg.backgroundImage,
      }));
      return JSON.stringify(parsed);
    }
  } catch {}
  return contenido;
};

// ✅ Helper UPSERT genérico - 1 sola query en vez de 2
async function upsertDB(
  tabla: string,
  userId: string,
  datos: Record<string, any>,
): Promise<void> {
  await supabase.from(tabla).upsert(
    { user_id: userId, ...datos, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
}

// ===== MATERIAS =====
export async function getMateriasDB(userId: string): Promise<Materia[]> {
  try {
    const { data } = await supabase
      .from('materias')
      .select('datos')
      .eq('user_id', userId)
      .single();
    return data?.datos || [];
  } catch { return []; }
}

export async function saveMateriasDB(userId: string, materias: Materia[]): Promise<void> {
  try {
    const materiasLimpias = limpiarMaterias(materias);
    await upsertDB('materias', userId, { datos: materiasLimpias });
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
    const { data } = await supabase
      .from('perfil_estudio')
      .select('datos')
      .eq('user_id', userId)
      .single();
    return data?.datos || empty;
  } catch { return empty; }
}

export async function savePerfilDB(userId: string, perfil: PerfilEstudio): Promise<void> {
  try {
    // ✅ Limitar sesiones a las últimas 100 para no crecer infinito
    const perfilLimpio = {
      ...perfil,
      sesiones: (perfil.sesiones || []).slice(-100),
    };
    await upsertDB('perfil_estudio', userId, { datos: perfilLimpio });
  } catch (err) { console.error('Error guardando perfil:', err); }
}

// ===== AGENDA =====
export async function getAgendaDB(userId: string): Promise<{ asignaciones: Asignacion[]; objetivos: ObjetivoAgenda[] }> {
  try {
    const { data } = await supabase
      .from('agenda')
      .select('asignaciones, objetivos')
      .eq('user_id', userId)
      .single();
    return {
      asignaciones: data?.asignaciones || [],
      objetivos: data?.objetivos || [],
    };
  } catch { return { asignaciones: [], objetivos: [] }; }
}

export async function saveAgendaDB(
  userId: string,
  asignaciones: Asignacion[],
  objetivos: ObjetivoAgenda[],
): Promise<void> {
  try {
    await upsertDB('agenda', userId, { asignaciones, objetivos });
  } catch (err) { console.error('Error guardando agenda:', err); }
}

// ===== HORARIO =====
export async function getHorarioDB(userId: string): Promise<Horario> {
  try {
    const { data } = await supabase
      .from('horario')
      .select('datos')
      .eq('user_id', userId)
      .single();
    return data?.datos || HORARIO_VACIO;
  } catch { return HORARIO_VACIO; }
}

export async function saveHorarioDB(userId: string, horario: Horario): Promise<void> {
  try {
    await upsertDB('horario', userId, { datos: horario });
  } catch (err) { console.error('Error guardando horario:', err); }
}

// ===== SETTINGS =====
export async function getSettingsDB(userId: string): Promise<any> {
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('datos')
      .eq('user_id', userId)
      .single();
    return data?.datos || null;
  } catch { return null; }
}

export async function saveSettingsDB(userId: string, settings: any): Promise<void> {
  try {
    // ✅ No guardar fotoPerfil base64 si es muy pesada
    const settingsLimpios = {
      ...settings,
      fotoPerfil: settings.fotoPerfil?.startsWith('data:')
        && settings.fotoPerfil.length > 500_000
        ? '' // si pesa más de 500KB no guardar
        : settings.fotoPerfil,
    };
    await upsertDB('user_settings', userId, { datos: settingsLimpios });
  } catch (err) { console.error('Error guardando settings:', err); }
}

// ===== STORAGE - Subir archivos pesados =====
export async function subirArchivoStorage(
  userId: string,
  base64: string,
  nombre: string,
  tipo: 'canvas' | 'fondo' | 'imagen' = 'imagen',
): Promise<string | null> {
  try {
    // Convertir base64 a blob
    const response = await fetch(base64);
    const blob = await response.blob();

    const extension = blob.type.includes('png') ? 'png' : 'jpg';
    const filePath = `${userId}/${tipo}_${nombre}_${Date.now()}.${extension}`;

    const { error } = await supabase.storage
      .from('archivos_estudio')
      .upload(filePath, blob, {
        contentType: blob.type,
        upsert: true,
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('archivos_estudio')
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (err) {
    console.error('Error subiendo archivo:', err);
    return null;
  }
}

export async function borrarArchivoStorage(url: string): Promise<void> {
  try {
    const path = url.split('/archivos_estudio/')[1];
    if (!path) return;
    await supabase.storage.from('archivos_estudio').remove([path]);
  } catch {}
}