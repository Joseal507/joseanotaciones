// Test del session copy writer con todas las combinaciones
// Prueba que la IA genera títulos para cada setup

const BASE_URL = 'http://localhost:3000';

const SETUPS = [
  { name: 'HOY + nunca lo he visto',        examDateType: 'today',         knowledgeLevel: 'never_seen'   },
  { name: 'HOY + ya lo conozco',            examDateType: 'today',         knowledgeLevel: 'already_know' },
  { name: 'MAÑANA + nunca lo he visto',     examDateType: 'tomorrow',      knowledgeLevel: 'never_seen'   },
  { name: 'MAÑANA + quiero repasar',        examDateType: 'tomorrow',      knowledgeLevel: 'want_review'  },
  { name: 'ESTA SEMANA + nunca lo he visto',examDateType: 'this_week',     knowledgeLevel: 'never_seen'   },
  { name: 'ESTA SEMANA + lo conozco poco',  examDateType: 'this_week',     knowledgeLevel: 'know_little'  },
  { name: 'SIN EXAMEN + nunca lo he visto', examDateType: 'just_studying', knowledgeLevel: 'never_seen'   },
  { name: 'SIN EXAMEN + ya lo conozco',     examDateType: 'just_studying', knowledgeLevel: 'already_know' },
];

const SESSIONS_BOHR = [
  { sessionNumber: 2, role: 'foundation', topicLabel: 'Vida y formación', concepts: ['Biografía', 'Educación'], previousSessionTopic: null, nextSessionTopic: 'El problema del átomo', blockCount: 3 },
  { sessionNumber: 3, role: 'problem', topicLabel: 'El problema del átomo', concepts: ['Rutherford', 'Limitaciones'], previousSessionTopic: 'Vida y formación', nextSessionTopic: 'Modelo atómico de Bohr', blockCount: 2 },
  { sessionNumber: 4, role: 'mechanism', topicLabel: 'Modelo atómico de Bohr', concepts: ['Niveles de energía', 'Espectro hidrógeno', 'Ecuación energética'], previousSessionTopic: 'El problema del átomo', nextSessionTopic: 'Mecánica cuántica', blockCount: 4 },
  { sessionNumber: 5, role: 'integration', topicLabel: 'Mecánica cuántica e interpretación de Copenhague', concepts: ['Copenhagen', 'Realidad cuántica', 'Implicaciones filosóficas'], previousSessionTopic: 'Modelo atómico de Bohr', nextSessionTopic: 'Legado', blockCount: 3 },
  { sessionNumber: 6, role: 'final_review', topicLabel: 'Evaluación final', concepts: ['Todos los temas'], previousSessionTopic: 'Mecánica cuántica', nextSessionTopic: null, blockCount: 0 },
];

function validate(copies: any[], setupName: string): string[] {
  const errors: string[] = [];

  if (!copies || copies.length === 0) {
    errors.push('No copies returned');
    return errors;
  }

  const titles = copies.map((c: any) => c.title);

  // 1. Sin títulos duplicados
  const titleSet = new Set(titles);
  if (titleSet.size !== titles.length) {
    const dupes = titles.filter((t: string, i: number) => titles.indexOf(t) !== i);
    errors.push(`TÍTULOS DUPLICADOS: ${[...new Set(dupes)].join(', ')}`);
  }

  // 2. Sin títulos vacíos
  copies.forEach((c: any, i: number) => {
    if (!c.title || c.title.trim().length < 3) {
      errors.push(`Título vacío en posición ${i}`);
    }
    if (!c.intro || c.intro.trim().length < 10) {
      errors.push(`Intro vacía en posición ${i}`);
    }
  });

  // 3. Sin "Conquista final" hardcoded (debe venir de IA)
  if (titles.some((t: string) => t === 'Conquista final')) {
    errors.push('Título genérico "Conquista final" no reemplazado por IA');
  }

  // 4. Sin títulos en inglés
  const englishPatterns = /^(The |A |An |Bohr's |Understanding |Introduction to )/i;
  copies.forEach((c: any) => {
    if (englishPatterns.test(c.title)) {
      errors.push(`Título en inglés: "${c.title}"`);
    }
  });

  return errors;
}

async function testSetup(setup: typeof SETUPS[0]) {
  const fullSetup = {
    knowledgeLevel: setup.knowledgeLevel,
    examDateType: setup.examDateType,
    examDateCustom: '',
    targetScore: 100,
    mainConcern: '',
    professorExamStyle: [],
    evalPreference: 'quick_test',
    planView: 'book',
    completedAt: Date.now(),
  };

  try {
    const res = await fetch(`${BASE_URL}/api/adaptive/session-copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessions: SESSIONS_BOHR,
        materialTitle: 'Niels Bohr',
        setup: fullSetup,
      }),
    });

    const data = await res.json();

    if (!data.success) {
      return { ok: false, error: 'API returned success=false', copies: [] };
    }

    const errors = validate(data.copies, setup.name);
    return { ok: errors.length === 0, errors, copies: data.copies };

  } catch (e: any) {
    return { ok: false, error: e.message, copies: [] };
  }
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('TEST: Session Copy Writer — todas las combinaciones');
  console.log('Material: Niels Bohr | Sesiones: 5');
  console.log('═'.repeat(70));

  let totalErrors = 0;
  let totalOk = 0;

  for (const setup of SETUPS) {
    process.stdout.write(`\n⏳ ${setup.name}...`);
    const result = await testSetup(setup);

    if (result.ok) {
      totalOk++;
      console.log(` ✅ OK`);
      result.copies.forEach((c: any) => {
        console.log(`   [${c.n}] "${c.title}"`);
      });
    } else {
      totalErrors += (result.errors?.length || 1);
      console.log(` ❌ FALLO`);
      if (result.error) console.log(`   Error: ${result.error}`);
      result.errors?.forEach((e: string) => console.log(`   ⚠️  ${e}`));
      if (result.copies?.length) {
        result.copies.forEach((c: any) => {
          console.log(`   [${c.n}] "${c.title}"`);
        });
      }
    }

    // Esperar un poco entre llamadas para no saturar las keys
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`RESULTADO: ${totalOk}/${SETUPS.length} OK | ${totalErrors} errores`);
  if (totalErrors === 0) {
    console.log('✅ TODOS LOS TESTS PASARON');
  } else {
    console.log('❌ HAY ERRORES');
  }
  console.log('═'.repeat(70) + '\n');
}

main().catch(console.error);
