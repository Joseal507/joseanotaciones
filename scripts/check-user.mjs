import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pmnmxwdriluiwieankuh.supabase.co',
  'sb_publishable_7xKTuk8vr3XA07fpzzCp6A_p9An3W87'
);

const USER_ID = '445e1eca-a7e4-48f2-9732-33f76efc50d1';

async function check() {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('nombre, xp_total, racha_actual, flashcards_estudiadas, precision_global, genero, tipo_estudiante, onboarding_completo, user_agreement, visible_leaderboard')
    .eq('user_id', USER_ID)
    .single();

  if (error) {
    console.log('❌ Error:', error.message);
  } else {
    console.log('📊 Tu perfil en leaderboard:\n');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n--- Diagnóstico ---');
    console.log('Onboarding completo:', data.genero && data.tipo_estudiante ? '✅ SÍ' : '❌ NO');
    console.log('Genero:', data.genero || '❌ VACÍO');
    console.log('Tipo estudiante:', data.tipo_estudiante || '❌ VACÍO');
    console.log('User agreement:', data.user_agreement ? '✅' : '❌');
    console.log('XP:', data.xp_total);
    console.log('Racha:', data.racha_actual);
    console.log('Flashcards:', data.flashcards_estudiadas);
  }
}

check();
