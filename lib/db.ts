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

async function apiGet(path: string) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed`);
  return res.json();
}

async function apiPost(path: string, body: any) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed`);
  return res.json();
}

const limpiarMaterias = (materias: Materia[]): any[] => {
  return materias.map(m => ({
    ...m,
    temas: m.temas.map(t => ({
      ...t,
      apuntes: t.apuntes.map(a => ({
        ...a,
        contenido: limpiarContenidoApunte(a.contenido),
      })),
      documentos: t.documentos.map(d => {
        const { archivoBase64, archivoUrl, ...resto } = d as any;
        return resto;
      }),
    })),
  }));
};

const limpiarContenidoApunte = (contenido: string): string => {
  if (!contenido) return contenido;
  try {
    const parsed = JSON.parse(contenido);
    if (parsed?.paginas) {
      parsed.paginas = parsed.paginas.map((pg: any) => ({
        ...pg,
        canvasData: pg.canvasData ? '[canvas]' : null,
        backgroundImage: pg.backgroundImage?.startsWith('data:') ? '[image]' : pg.backgroundImage,
      }));
      return JSON.stringify(parsed);
    }
  } catch {}
  return contenido;
};

// ===== MATERIAS =====
export async function getMateriasDB(_userId: string): Promise<Materia[]> {
  try {
    const data = await apiGet('/api/materias');
    return data?.materias || [];
  } catch {
    return [];
  }
}

export async function saveMateriasDB(_userId: string, materias: Materia[]): Promise<void> {
  try {
    await apiPost('/api/materias', { materias: limpiarMaterias(materias) });
  } catch (err) {
    console.error('Error guardando materias D1:', err);
  }
}

// ===== PERFIL ESTUDIO =====
const PERFIL_EMPTY: PerfilEstudio = {
  flashcardsFalladas: {},
  flashcardsAcertadas: {},
  materiasStats: {},
  sesiones: [],
};

export async function getPerfilDB(userId: string): Promise<PerfilEstudio> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return PERFIL_EMPTY;

    const res = await fetch(`${api}/study-profiles/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    if (!res.ok) return PERFIL_EMPTY;
    const data = await res.json();
    return data?.profile || PERFIL_EMPTY;
  } catch {
    return PERFIL_EMPTY;
  }
}

export async function savePerfilDB(userId: string, perfil: PerfilEstudio): Promise<void> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return;

    const perfilLimpio = {
      ...perfil,
      sesiones: (perfil.sesiones || []).slice(-500),
    };

    await fetch(`${api}/study-profiles/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, profile: perfilLimpio }),
    });
  } catch (err) {
    console.error('Error guardando perfil D1:', err);
  }
}

// ===== AGENDA =====
export async function getAgendaDB(userId: string): Promise<{ asignaciones: Asignacion[]; objetivos: ObjetivoAgenda[] }> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return { asignaciones: [], objetivos: [] };

    const res = await fetch(`${api}/agenda/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    if (!res.ok) return { asignaciones: [], objetivos: [] };
    const data = await res.json();

    return {
      asignaciones: data?.asignaciones || [],
      objetivos: data?.objetivos || [],
    };
  } catch {
    return { asignaciones: [], objetivos: [] };
  }
}

export async function saveAgendaDB(
  userId: string,
  asignaciones: Asignacion[],
  objetivos: ObjetivoAgenda[],
): Promise<void> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return;

    await fetch(`${api}/agenda/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, asignaciones, objetivos }),
    });
  } catch (err) {
    console.error('Error guardando agenda D1:', err);
  }
}

// ===== HORARIO =====
export async function getHorarioDB(userId: string): Promise<Horario> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return HORARIO_VACIO;

    const res = await fetch(`${api}/horario/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    if (!res.ok) return HORARIO_VACIO;
    const data = await res.json();

    return data?.horario || HORARIO_VACIO;
  } catch {
    return HORARIO_VACIO;
  }
}

export async function saveHorarioDB(userId: string, horario: Horario): Promise<void> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return;

    await fetch(`${api}/horario/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, horario }),
    });
  } catch (err) {
    console.error('Error guardando horario D1:', err);
  }
}

// ===== SETTINGS =====
export async function getSettingsDB(userId: string): Promise<any> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return null;

    const res = await fetch(`${api}/settings/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();

    return data?.settings || null;
  } catch {
    return null;
  }
}

export async function saveSettingsDB(userId: string, settings: any): Promise<void> {
  try {
    const api = process.env.NEXT_PUBLIC_STUDYAL_API_URL || process.env.STUDYAL_API_URL;
    if (!api) return;

    const settingsLimpios = {
      ...settings,
      fotoPerfil: settings.fotoPerfil?.startsWith('data:') && settings.fotoPerfil.length > 500_000 ? '' : settings.fotoPerfil,
    };

    await fetch(`${api}/settings/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, settings: settingsLimpios }),
    });
  } catch (err) {
    console.error('Error guardando settings D1:', err);
  }
}

// ===== STORAGE TEMPORAL =====
// Los archivos físicos se migran a R2 en otra fase.
export async function subirArchivoStorage(): Promise<string | null> {
  console.warn('subirArchivoStorage pendiente de migrar a R2');
  return null;
}

export async function borrarArchivoStorage(): Promise<void> {
  console.warn('borrarArchivoStorage pendiente de migrar a R2');
}
