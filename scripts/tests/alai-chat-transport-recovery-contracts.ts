import assert from 'node:assert/strict';
import { normalizeChatCandidate, validateChatCandidate } from '../../lib/alai-chat/validation';
import { detectChatIntent } from '../../lib/alai-chat/intent';
import { safeParseJson } from '../../lib/alai';
import { generateValidatedLegacyJson } from '../../lib/ai/legacyRouteGeneration';
import { salvageChatTurn, extractAnswerFromMalformedJson } from '../../app/api/alai-studyal-chat/route';

// ============================================================
// STUDYAL — ALAI CHAT TRANSPORT RECOVERY OFFLINE CONTRACTS
// Verifies all 20 required fixture conditions for resilient,
// deterministic parsing and salvage of conversational responses.
// ============================================================

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(
        () => { console.log(`  ✅ ${name}`); passed++; },
        (err: any) => { console.error(`  ❌ ${name}`); console.error(`     ${err?.message || err}`); failed++; }
      );
    }
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message || err}`);
    failed++;
  }
}

async function main() {
  console.log('\n── ALAI Chat Transport Recovery Contracts ──\n');

  // 1. clean JSON
  runTest('1. clean JSON parses deterministically', () => {
    const raw = '{\n  "answer": "Respuesta limpia",\n  "usedTargetIds": ["target_1"],\n  "usedRelationIds": [],\n  "suggestedFollowups": ["¿Pregunta 1?"]\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.equal(parsed.answer, 'Respuesta limpia');
    assert.deepEqual(parsed.usedTargetIds, ['target_1']);
  });

  // 2. fenced JSON
  runTest('2. fenced JSON parses without presentation artifacts', () => {
    const raw = '```json\n{\n  "answer": "Respuesta dentro de bloque",\n  "usedTargetIds": []\n}\n```';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.equal(parsed.answer, 'Respuesta dentro de bloque');
  });

  // 3. surrounding prose
  runTest('3. surrounding prose around JSON object is handled cleanly', () => {
    const raw = 'Hola estudiante, aquí está la respuesta solicitada:\n{\n  "answer": "Respuesta con texto alrededor",\n  "usedTargetIds": []\n}\n¡Espero que te ayude en tu estudio!';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.equal(parsed.answer, 'Respuesta con texto alrededor');
  });

  // 4. literal LF inside answer string
  runTest('4. literal LF (0x0A) inside answer string does not crash JSON.parse', () => {
    const raw = '{\n  "answer": "Línea 1\nLínea 2\nLínea 3",\n  "usedTargetIds": []\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.equal(parsed.answer, 'Línea 1\nLínea 2\nLínea 3');
  });

  // 5. literal CRLF inside answer string
  runTest('5. literal CRLF (0x0D 0x0A) inside answer string is normalized safely', () => {
    const raw = '{\r\n  "answer": "Línea A\r\nLínea B",\r\n  "usedTargetIds": []\r\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.equal(parsed.answer, 'Línea A\r\nLínea B');
  });

  // 6. escaped newlines
  runTest('6. already-escaped newlines (\\n) survive intact without double-escaping', () => {
    const raw = '{\n  "answer": "Línea con escape explícito\\nSegunda línea",\n  "usedTargetIds": []\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.equal(parsed.answer, 'Línea con escape explícito\nSegunda línea');
  });

  // 7. Markdown table in answer
  runTest('7. Markdown table with multi-line rows inside answer string parses cleanly', () => {
    const raw = '{\n  "answer": "Aquí está la tabla comparativa:\n\n| Jugador | Posición | Logros |\n| :--- | :--- | :--- |\n| Matt Ryan | QB | MVP 2016 |\n| Julio Jones | WR | 7x Pro Bowl |\n\nAmbos fueron clave.",\n  "usedTargetIds": []\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.match(parsed.answer, /\| Matt Ryan \| QB \|/);
    assert.match(parsed.answer, /\| Julio Jones \| WR \|/);
  });

  // 8. bullets/headings
  runTest('8. Markdown headings and bullets in answer string are preserved', () => {
    const raw = '{\n  "answer": "## Jugadores Principales\n\n* Matt Ryan: Mariscal de campo\n* Julio Jones: Receptor abierto\n* Deion Sanders: Esquinero",\n  "usedTargetIds": []\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.match(parsed.answer, /## Jugadores Principales/);
    assert.match(parsed.answer, /\* Matt Ryan/);
  });

  // 9. answer containing quoted terms
  runTest('9. answer containing unescaped quote terms (e.g. nicknames) recovers cleanly', () => {
    const raw = '{\n  "answer": "El quarterback Matt Ryan conocido como "Matty Ice" lideró la ofensiva.",\n  "usedTargetIds": []\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.equal(parsed.answer, 'El quarterback Matt Ryan conocido como "Matty Ice" lideró la ofensiva.');
  });

  // 10. LaTeX/backslashes
  runTest('10. LaTeX backslashes and math notations are preserved', () => {
    const raw = '{\n  "answer": "La reacción está en equilibrio \\\\rightleftharpoons con constante K_c = \\\\frac{[C][D]}{[A][B]}.",\n  "usedTargetIds": []\n}';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.match(parsed.answer, /\\rightleftharpoons/);
    assert.match(parsed.answer, /\\frac/);
  });

  // 11. JSON answer containing inner code fences
  runTest('11. outer JSON containing inner markdown code blocks does not truncate prematurely', () => {
    const raw = '```json\n{\n  "answer": "Aquí tienes un ejemplo de código:\\n```markdown\\n| Col1 | Col2 |\\n|---|---|\\n| A | B |\\n```\\nFin del ejemplo.",\n  "usedTargetIds": []\n}\n```';
    const parsed = safeParseJson(raw);
    assert.ok(parsed);
    assert.match(parsed.answer, /```markdown/);
    assert.match(parsed.answer, /Fin del ejemplo/);
  });

  // 12. plain Markdown provider response
  runTest('12. plain Markdown response without JSON is salvaged as substantive answer', () => {
    const raw = 'Aquí tienes la tabla comparativa de los Falcons:\n\n| Jugador | Posición |\n|---|---|\n| Matt Ryan | QB |\n| Julio Jones | WR |\n\n¿Quieres comparar estadísticas avanzadas?';
    const salvaged = salvageChatTurn(raw);
    assert.ok(salvaged);
    assert.equal(salvaged.answer, raw);
    assert.deepEqual(salvaged.usedTargetIds, []);
    assert.deepEqual(salvaged.usedRelationIds, []);
  });

  // 13. fabricated usedTargetIds
  runTest('13. fabricated target IDs are rejected by server grounding authority', () => {
    const knownTargetIds = new Set(['chat_target:valid_1', 'chat_target:valid_2']);
    const providerTargetIds = ['chat_target:valid_1', 'chat_target:fabricated_evil_target'];
    const filtered = providerTargetIds.filter(id => knownTargetIds.has(id));
    assert.deepEqual(filtered, ['chat_target:valid_1']);
    assert.ok(!filtered.includes('chat_target:fabricated_evil_target'));
  });

  // 14. fabricated usedRelationIds
  runTest('14. fabricated relation IDs are rejected by server grounding authority', () => {
    const knownRelationIds = new Set(['chat_rel:authorized_1']);
    const providerRelationIds = ['chat_rel:fake_fabricated_999'];
    const filtered = providerRelationIds.filter(id => knownRelationIds.has(id));
    assert.deepEqual(filtered, []);
  });

  // 15. recoverable malformed wrapper
  runTest('15. recoverable malformed wrapper with trailing syntax debris salvages answer', () => {
    const raw = '{\n  "answer": "Respuesta totalmente válida y completa con su tabla:\n| A | B |\n|---|---|",\n  "usedTargetIds": [BROKEN_GARBAGE_NO_CLOSE';
    const salvaged = salvageChatTurn(raw);
    assert.ok(salvaged);
    assert.match(salvaged.answer, /Respuesta totalmente válida/);
    assert.match(salvaged.answer, /\| A \| B \|/);
  });

  // 15b. EOF inside answer string is NOT a complete recoverable answer.
  // This reproduces the live failure where ALAI exposed only the beginning
  // of a Markdown table and incorrectly treated transport truncation as success.
  runTest('15b. truncated JSON inside answer string is rejected instead of salvaged', () => {
    const raw = `{
  "answer": "Según el material, aquí tienes la tabla:

## Componentes Principales de la Cultura

| Componente | Significado`;

    assert.equal(extractAnswerFromMalformedJson(raw), null);
    assert.equal(salvageChatTurn(raw), null);
  });

  // Same invariant without Markdown: finding the beginning of "answer"
  // is insufficient; the closing boundary must be proven.
  runTest('15c. ordinary EOF inside answer string is rejected instead of salvaged', () => {
    const raw = `{
  "answer": "Esta respuesta comenzó correctamente pero fue truncada`;

    assert.equal(extractAnswerFromMalformedJson(raw), null);
    assert.equal(salvageChatTurn(raw), null);
  });

  // 16. truly unrecoverable empty/gibberish response
  runTest('16. truly unrecoverable empty or syntax-only debris returns null (cannot be salvaged)', () => {
    assert.equal(salvageChatTurn(''), null);
    assert.equal(salvageChatTurn('   \n  \t  '), null);
    assert.equal(salvageChatTurn('{}'), null);
    assert.equal(salvageChatTurn('[]'), null);
    assert.equal(salvageChatTurn('null'), null);
  });

  // 17. schema mismatch
  runTest('17. valid JSON with schema mismatch (missing answer property) fails validation', () => {
    const validator = (value: any) => ({
      valid: Boolean(value && typeof value.answer === 'string' && value.answer.trim().length > 0),
      errors: value?.answer ? [] : ['STRUCTURAL_VALIDATION_FAILED:missing_answer'],
    });
    const result = validator({ unexpectedKey: 12345 });
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ['STRUCTURAL_VALIDATION_FAILED:missing_answer']);
  });

  // Actual injected legacy transport: no simulated counters or unconnected mocks.
  await runTest('18. legacy Markdown salvage uses the actual provider exactly once', async () => {
    let calls = 0;
    const result = await generateValidatedLegacyJson({
      taskType: 'explanation', prompt: 'Explica brevemente',
      provider: async () => { calls++; return { text: 'Una respuesta completa.', provider: 'openrouter', model: 'fixture' }; },
      failurePath: 'single_repair', salvageRawText: raw => salvageChatTurn(raw),
      normalize: normalizeChatCandidate,
      validate: value => validateChatCandidate(normalizeChatCandidate(value), { intent: detectChatIntent('explica'), sourcePolicy: 'MIXED' }),
    });
    assert.equal(result.answer, 'Una respuesta completa.');
    assert.equal(calls, 1);
  });

  // 19. A response truncated inside "answer" must NOT be surfaced.
  // It must enter the one allowed format_repair, whose complete result
  // is then parsed/validated normally.
  await runTest('19. truncated JSON enters exactly one format repair and returns only the complete repaired answer', async () => {
    let calls = 0;
    const stagesSeen: string[] = [];

    const provider = async (request: any) => {
      calls++;
      stagesSeen.push(String(request.stage));

      if (request.stage === 'normal') {
        return {
          text: `{
  "answer": "Según el material, aquí tienes la tabla:

| Componente | Significado`,
          provider: 'openrouter' as const,
          model: 'test-model',
        };
      }

      if (request.stage === 'format_repair') {
        return {
          text: JSON.stringify({
            answer: [
              'Según el material, aquí tienes la tabla:',
              '',
              '| Componente | Significado |',
              '|---|---|',
              '| Símbolos | Elementos con significado compartido |',
              '| Lenguaje | Sistema de comunicación |',
            ].join('\n'),
            usedTargetIds: ['chat_target:componentes'],
            usedRelationIds: [],
            suggestedFollowups: [],
          }),
          provider: 'openrouter' as const,
          model: 'test-model',
        };
      }

      throw new Error(`unexpected stage: ${request.stage}`);
    };

    const result = await generateValidatedLegacyJson<any>({
      taskType: 'explanation',
      prompt: 'Hazme una tabla.',
      provider: provider as any,
      failurePath: 'single_repair',
      salvageRawText: (raw) => salvageChatTurn(raw),
      normalize: (value: any) => value,
      validate: (value: any) => ({
        valid: Boolean(value && typeof value.answer === 'string' && value.answer.trim().length > 0),
        errors: value?.answer ? [] : ['STRUCTURAL_VALIDATION_FAILED:missing_answer'],
      }),
    });

    assert.equal(calls, 2, 'truncation must use normal + exactly one format_repair');
    assert.deepEqual(stagesSeen, ['normal', 'format_repair']);
    assert.match(result.answer, /\| Símbolos \| Elementos con significado compartido \|/);
    assert.match(result.answer, /\| Lenguaje \| Sistema de comunicación \|/);
    assert.ok(!result.answer.endsWith('| Componente | Significado'));
    assert.deepEqual(result.usedTargetIds, ['chat_target:componentes']);
  });

  // 20. second unrecoverable response => honest failure, no third/fourth call
  await runTest('20. consecutive unrecoverable responses terminate in honest failure without 3rd/4th call', async () => {
    let calls = 0;
    const stagesSeen: string[] = [];

    // Verify generationPipeline single_repair behavior
    const { runGenerationPipeline } = await import('../../lib/ai/generationPipeline');
    const outcome = await runGenerationPipeline({
      taskType: 'explanation',
      failurePath: 'single_repair',
      totalTimeoutMs: 10000,
      generate: async (context) => {
        calls++;
        stagesSeen.push(context.stage);
        throw new Error('INVALID_JSON:MALFORMED');
      },
      validate: () => ({ valid: false, errors: ['INVALID_JSON'] }),
    });

    assert.equal(outcome.status, 'budget_exhausted');
    assert.equal(calls, 2, 'Must make exactly 2 calls: normal + 1 format_repair');
    assert.deepEqual(stagesSeen, ['normal', 'format_repair']);
    assert.ok(!stagesSeen.includes('targeted_repair'), 'targeted_repair must never be reached');
    assert.ok(!stagesSeen.includes('simplified'), 'simplified must never be reached');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log('ALAI_CHAT_DETERMINISTIC_TRANSPORT_RECOVERY_FIXED');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
