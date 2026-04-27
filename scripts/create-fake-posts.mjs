import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pmnmxwdriluiwieankuh.supabase.co',
  'sb_publishable_7xKTuk8vr3XA07fpzzCp6A_p9An3W87'
);

// ← PON TU USER_ID AQUI (el que aparece en los logs: 445e1eca-...)
const MI_USER_ID = '445e1eca-a7e4-48f2-9732-33f76efc50d1';
const FAKE_PREFIX = 'pruebafake';

const avatars = [
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake1',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake2',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake3',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake4',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake5',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake6',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake7',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake8',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake9',
  'https://api.dicebear.com/7.x/avataaars/png?seed=fake10',
];

const portadas = [
  'https://images.unsplash.com/photo-1501504905252-473c47e087f8?w=600&fit=crop',
  'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=600&fit=crop',
  'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=600&fit=crop',
  'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&fit=crop',
  'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=600&fit=crop',
  null,
  'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600&fit=crop',
  'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=600&fit=crop',
  'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=600&fit=crop',
  null,
  'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&fit=crop',
  'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=600&fit=crop',
  null,
  'https://images.unsplash.com/photo-1471107340929-a87cd0f5b5f3?w=600&fit=crop',
  'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=600&fit=crop',
  null,
  'https://images.unsplash.com/photo-1517842645767-c639042777db?w=600&fit=crop',
  'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?w=600&fit=crop',
  null,
  'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=600&fit=crop',
];

const posts = [
  { tipo: 'apunte', titulo: 'Estructura de Lewis completa', descripcion: 'Apuntes completos de quimica organica sobre enlaces y estructuras moleculares.', materia: 'Quimica', emoji: '🔬', color: '#4ade80' },
  { tipo: 'flashcards', titulo: '50 flashcards de Calculo I', descripcion: 'Derivadas, integrales y limites. Cobertura completa del primer parcial.', materia: 'Calculo', emoji: '📐', color: '#f472b6' },
  { tipo: 'quiz', titulo: 'Quiz de Biologia Celular', descripcion: '25 preguntas sobre mitosis, meiosis y organelos celulares.', materia: 'Biologia', emoji: '🧬', color: '#38bdf8' },
  { tipo: 'apunte', titulo: 'Fisica II - Electromagnetismo', descripcion: 'Ley de Coulomb, campo electrico, potencial y circuitos con formulas.', materia: 'Fisica', emoji: '⚡', color: '#f5c842' },
  { tipo: 'flashcards', titulo: 'Vocabulario ingles avanzado', descripcion: '80 palabras de nivel C1 con ejemplos. Perfecto para el TOEFL.', materia: 'Ingles', emoji: '📚', color: '#a78bfa' },
  { tipo: 'quiz', titulo: 'Examen de Historia de Panama', descripcion: 'Desde la epoca precolombina hasta la devolucion del Canal.', materia: 'Historia', emoji: '📜', color: '#ef4444' },
  { tipo: 'apunte', titulo: 'Programacion en Python - POO', descripcion: 'Clases, herencia, polimorfismo y encapsulamiento con ejemplos.', materia: 'Programacion', emoji: '💻', color: '#34d399' },
  { tipo: 'flashcards', titulo: 'Anatomia del sistema nervioso', descripcion: 'Nervios craneales, medula espinal y sistema autonomo. 60 tarjetas.', materia: 'Anatomia', emoji: '🧠', color: '#fb923c' },
  { tipo: 'quiz', titulo: 'Parcial de Derecho Constitucional', descripcion: '30 preguntas sobre garantias fundamentales y estructura del Estado.', materia: 'Derecho', emoji: '⚖️', color: '#6366f1' },
  { tipo: 'apunte', titulo: 'Contabilidad - Asientos contables', descripcion: 'Debe, haber, balance general y estado de resultados con ejercicios.', materia: 'Contabilidad', emoji: '📊', color: '#14b8a6' },
  { tipo: 'flashcards', titulo: 'Farmacologia - Antibioticos', descripcion: 'Mecanismos de accion, espectro y efectos adversos de cada familia.', materia: 'Farmacologia', emoji: '💊', color: '#e879f9' },
  { tipo: 'apunte', titulo: 'Ecuaciones diferenciales', descripcion: 'Separacion de variables, factor integrante y Laplace con ejercicios.', materia: 'Matematicas', emoji: '🔢', color: '#fbbf24' },
  { tipo: 'quiz', titulo: 'Quiz de Microeconomia', descripcion: 'Oferta, demanda, elasticidad y estructuras de mercado.', materia: 'Economia', emoji: '💰', color: '#22d3ee' },
  { tipo: 'apunte', titulo: 'Psicologia del desarrollo', descripcion: 'Teorias de Piaget, Vygotsky y Erikson con ejemplos practicos.', materia: 'Psicologia', emoji: '🧩', color: '#f43f5e' },
  { tipo: 'flashcards', titulo: 'Tabla periodica interactiva', descripcion: 'Propiedades de los elementos y configuracion electronica. 118 elementos.', materia: 'Quimica', emoji: '🔬', color: '#4ade80' },
  { tipo: 'apunte', titulo: 'Marketing Digital - SEO y SEM', descripcion: 'Estrategias de posicionamiento, Google Ads y metricas clave.', materia: 'Marketing', emoji: '📱', color: '#8b5cf6' },
  { tipo: 'quiz', titulo: 'Parcial de Estadistica', descripcion: 'Distribuciones, pruebas de hipotesis y regresion lineal.', materia: 'Estadistica', emoji: '📈', color: '#06b6d4' },
  { tipo: 'flashcards', titulo: 'Verbos irregulares en frances', descripcion: '60 verbos conjugados en presente, pasado y futuro.', materia: 'Frances', emoji: '📖', color: '#ec4899' },
  { tipo: 'apunte', titulo: 'Resistencia de materiales', descripcion: 'Esfuerzo, deformacion, flexion y torsion en vigas y columnas.', materia: 'Ingenieria Civil', emoji: '🏗️', color: '#78716c' },
  { tipo: 'quiz', titulo: 'Final de Filosofia - Etica', descripcion: 'Kant, utilitarismo, Aristoteles y dilemas morales contemporaneos.', materia: 'Filosofia', emoji: '🤔', color: '#a3a3a3' },
];

async function createFakePosts() {
  console.log('🤖 Creando 20 posts fake...\n');

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const fakeNum = i + 1;

    const { data, error } = await supabase
      .from('comunidad_posts')
      .insert({
        user_id: MI_USER_ID,
        user_nombre: `${FAKE_PREFIX}${fakeNum}`,
        user_avatar: avatars[i % avatars.length],
        tipo: p.tipo,
        titulo: p.titulo,
        descripcion: p.descripcion,
        portada_url: portadas[i] || null,
        contenido: JSON.stringify({ texto: p.descripcion }),
        materia_nombre: p.materia,
        materia_color: p.color,
        materia_emoji: p.emoji,
        es_partner: i % 5 === 0,
        comments_activos: true,
      })
      .select('id')
      .single();

    if (error) {
      console.log(`  ❌ ${FAKE_PREFIX}${fakeNum}: ${error.message}`);
    } else {
      console.log(`  ✅ ${FAKE_PREFIX}${fakeNum} → ${p.titulo}`);
      await supabase
        .from('comunidad_posts')
        .update({
          views: Math.floor(Math.random() * 500) + 20,
          estudiados: Math.floor(Math.random() * 100) + 5,
        })
        .eq('id', data.id);
    }
  }

  console.log('\n✅ Posts fake creados');
  console.log('🗑️  Para eliminarlos: node scripts/delete-fake-posts.mjs');
}

createFakePosts();
