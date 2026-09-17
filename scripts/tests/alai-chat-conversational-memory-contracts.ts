import assert from "node:assert/strict"
import { detectChatIntent } from "../../lib/alai-chat/intent"
import { resolveConversation, readConversationContext, extractSemanticFocusFromTurn, type ChatConversationContext } from "../../lib/alai-chat/conversation"
import { extractGraphSpec } from "../../lib/adaptive/visual/engines/graphEngine"

// ---------------------------------------------------------------------------
// TEST 1: Sequence 1 (Math multi-turn continuity & working memory)
// ---------------------------------------------------------------------------
function testSequence1MathMultiTurn() {
  // Turn 1: Initial worked solution
  const t1Msg = "Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso."
  const t1Intent = detectChatIntent(t1Msg)
  assert.equal(t1Intent.followup, false, "Turn 1 must NOT be a follow-up")
  assert.equal(t1Intent.shape, "numbered_steps", "Turn 1 shape must be numbered_steps")

  const t1Resolved = resolveConversation(t1Msg, null)
  assert.equal(t1Resolved.context.activeProblem, "2x² - 8x + 6 = 0", "Active problem must be extracted")
  assert.ok(t1Resolved.context.subject.includes("2x² - 8x + 6 = 0"))

  // Turn 1 completes and adds working memory
  const t1Context: ChatConversationContext = {
    ...t1Resolved.context,
    workingMemory: "Problema activo: 2x² - 8x + 6 = 0 | Elementos: x² - 4x + 3 = 0; x = 1; x = 3",
  }

  // Turn 2: "ahora grafícala"
  const t2Msg = "ahora grafícala"
  const t2Intent = detectChatIntent(t2Msg)
  assert.equal(t2Intent.followup, true, "Turn 2 must be follow-up")
  assert.equal(t2Intent.shape, "graph", "Turn 2 shape must be graph")

  const t2Resolved = resolveConversation(t2Msg, t1Context)
  assert.equal(t2Resolved.context.activeProblem, "2x² - 8x + 6 = 0", "Active problem must be preserved")
  assert.equal(t2Resolved.context.operation, "graph", "Operation must be graph")
  assert.ok(t2Resolved.context.workingMemory?.includes("2x² - 8x + 6 = 0"), "Working memory preserved")

  // Turn 2 completes with graph details
  const t2Context: ChatConversationContext = {
    ...t2Resolved.context,
    workingMemory: "Problema activo: 2x² - 8x + 6 = 0 | Elementos: y = x² - 4x + 3; a = 1; b = -4; c = 3; Vértice (2,-1)",
  }

  // Turn 3: "que es la b?"
  const t3Msg = "que es la b?"
  const t3Intent = detectChatIntent(t3Msg)
  assert.equal(t3Intent.followup, true, "Turn 3 'que es la b?' must be recognized as follow-up")
  assert.equal(t3Intent.shape, "prose", "Turn 3 shape must be prose")

  const t3Resolved = resolveConversation(t3Msg, t2Context)
  assert.equal(t3Resolved.context.activeProblem, "2x² - 8x + 6 = 0", "Active problem must carry into Turn 3")
  assert.equal(t3Resolved.context.operation, "prose", "Turn 3 MUST NOT inherit 'graph' operation")
  assert.ok(t3Resolved.retrievalQuery.includes("2x² - 8x + 6 = 0"), "Retrieval query must include inherited problem")
  assert.ok(t3Resolved.context.workingMemory?.includes("b = -4"), "Working memory must retain known variables")

  // Turn 3 completes
  const t3Context: ChatConversationContext = {
    ...t3Resolved.context,
    workingMemory: "Problema activo: 2x² - 8x + 6 = 0 | Elementos: y = x² - 4x + 3; a = 1; b = -4 (coeficiente lineal); c = 3",
  }

  // Turn 4: "y la c?"
  const t4Msg = "y la c?"
  const t4Intent = detectChatIntent(t4Msg)
  assert.equal(t4Intent.followup, true, "Turn 4 'y la c?' must be recognized as follow-up")

  const t4Resolved = resolveConversation(t4Msg, t3Context)
  assert.equal(t4Resolved.context.activeProblem, "2x² - 8x + 6 = 0", "Active problem must carry into Turn 4")
  assert.equal(t4Resolved.context.operation, "prose")

  // Turn 5: "por que es negativa?"
  const t5Msg = "por que es negativa?"
  const t5Intent = detectChatIntent(t5Msg)
  assert.equal(t5Intent.followup, true, "Turn 5 'por que es negativa?' must be follow-up")

  const t5Resolved = resolveConversation(t5Msg, t4Resolved.context)
  assert.equal(t5Resolved.context.activeProblem, "2x² - 8x + 6 = 0")

  // Turn 6: "ponme otro parecido"
  const t6Msg = "ponme otro parecido"
  const t6Intent = detectChatIntent(t6Msg)
  assert.equal(t6Intent.followup, true, "Turn 6 'ponme otro parecido' must be follow-up")
  assert.equal(t6Intent.shape, "worked_solution", "Turn 6 shape must be worked_solution")

  const t6Resolved = resolveConversation(t6Msg, t5Resolved.context)
  assert.equal(t6Resolved.intent.shape, "worked_solution")

  // Turn 7: "ahora uno más difícil"
  const t7Msg = "ahora uno más difícil"
  const t7Intent = detectChatIntent(t7Msg)
  assert.equal(t7Intent.followup, true, "Turn 7 'ahora uno más difícil' must be follow-up")
  assert.equal(t7Intent.shape, "worked_solution", "Turn 7 shape must be worked_solution")

  console.log("PASS 1: Sequence 1 Math 7-turn continuity, working memory, and operation resolution passed")
}

// ---------------------------------------------------------------------------
// TEST 2: Sequence 2 (Material continuity & deictic pronoun resolution)
// ---------------------------------------------------------------------------
function testSequence2MaterialContinuity() {
  const initialMaterialContext: ChatConversationContext = {
    version: 1,
    subject: "Principios de la termodinámica",
    operation: "numbered_steps",
    sourcePolicy: "MATERIAL_ONLY",
    usedTargetIds: ["target:termo_1", "target:termo_2"],
    usedRelationIds: ["rel:1"],
    activeProblem: "Principios de la termodinámica",
  }

  // Turn 2: "explícame el segundo punto"
  const t2Msg = "explícame el segundo punto"
  const t2Intent = detectChatIntent(t2Msg)
  assert.equal(t2Intent.followup, true)
  assert.equal(t2Intent.ordinal, 2, "Ordinal must be 2")

  const t2Resolved = resolveConversation(t2Msg, initialMaterialContext)
  assert.equal(t2Resolved.context.ordinal, 2)
  assert.equal(t2Resolved.context.sourcePolicy, "MATERIAL_ONLY", "Source policy must be inherited")
  assert.deepEqual(t2Resolved.context.usedTargetIds, ["target:termo_1", "target:termo_2"], "Target IDs must be inherited")

  // Turn 3: "eso no lo entendí"
  const t3Msg = "eso no lo entendí"
  const t3Intent = detectChatIntent(t3Msg)
  assert.equal(t3Intent.followup, true, "Deictic 'eso no lo entendí' must be follow-up")

  const t3Resolved = resolveConversation(t3Msg, t2Resolved.context)
  assert.equal(t3Resolved.context.sourcePolicy, "MATERIAL_ONLY")
  assert.ok(t3Resolved.retrievalQuery.includes("Principios de la termodinámica"))

  console.log("PASS 2: Sequence 2 Material continuity and deictic resolution passed")
}

// ---------------------------------------------------------------------------
// TEST 3: Sequence 3 (Topic switch clean isolation - WWI vs Quadratic)
// ---------------------------------------------------------------------------
function testSequence3TopicSwitchIsolation() {
  const quadraticContext: ChatConversationContext = {
    version: 1,
    subject: "2x² - 8x + 6 = 0",
    operation: "graph",
    sourcePolicy: "GENERAL_ONLY",
    usedTargetIds: [],
    usedRelationIds: [],
    activeProblem: "2x² - 8x + 6 = 0",
    workingMemory: "Problema activo: 2x² - 8x + 6 = 0 | Elementos: a=1; b=-4; c=3",
  }

  // User abruptly asks about WWI
  const ww1Msg = "¿Qué causó la Primera Guerra Mundial?"
  const ww1Intent = detectChatIntent(ww1Msg)
  assert.equal(ww1Intent.followup, false, "WWI MUST NOT be classified as follow-up")
  assert.equal(ww1Intent.ordinal, undefined, "'Primera Guerra Mundial' MUST NOT trigger ordinal=1")

  const ww1Resolved = resolveConversation(ww1Msg, quadraticContext)
  assert.equal(ww1Resolved.context.subject, "¿Qué causó la Primera Guerra Mundial?")
  assert.equal(ww1Resolved.context.activeProblem, "¿Qué causó la Primera Guerra Mundial?", "Active problem must reset to WWI")
  assert.equal(ww1Resolved.context.workingMemory, undefined, "Working memory must NOT retain quadratic data")
  assert.equal(ww1Resolved.context.operation, "prose", "Operation must reset to prose")
  assert.ok(!ww1Resolved.retrievalQuery.includes("2x²"), "Retrieval query must be free of quadratic contamination")

  // Other topic switches
  const photoIntent = detectChatIntent("Explícame la fotosíntesis y sus fases")
  assert.equal(photoIntent.followup, false)

  const newEqIntent = detectChatIntent("Resuelve 5x + 3 = 18 paso a paso")
  assert.equal(newEqIntent.followup, false, "New standalone equation problem must not be follow-up")

  const newtonIntent = detectChatIntent("Define la segunda ley de Newton")
  assert.equal(newtonIntent.followup, false)
  assert.equal(newtonIntent.ordinal, undefined, "'segunda ley' must NOT trigger ordinal=2")

  // Spanish prepositions ('a') and conjunctions ('y') in topic switches must NOT trigger math follow-up
  const cesarResolved = resolveConversation("¿Quién mató a Julio César?", quadraticContext)
  assert.equal(cesarResolved.intent.followup, false, "'¿Quién mató a Julio César?' must NOT be follow-up due to preposition 'a'")
  assert.equal(cesarResolved.context.workingMemory, undefined)

  const waterlooResolved = resolveConversation("¿Quién derrotó a Napoleón en Waterloo?", quadraticContext)
  assert.equal(waterlooResolved.intent.followup, false, "'¿Quién derrotó a Napoleón?' must NOT be follow-up")
  assert.equal(waterlooResolved.context.workingMemory, undefined)

  const napoleonAndResolved = resolveConversation("¿Quién fue Napoleón y qué hizo?", quadraticContext)
  assert.equal(napoleonAndResolved.intent.followup, false, "'¿Quién fue Napoleón y qué hizo?' must NOT be follow-up due to conjunction 'y'")
  assert.equal(napoleonAndResolved.context.workingMemory, undefined)

  const paisResolved = resolveConversation("¿Quién gobernó en este país en 1810?", quadraticContext)
  assert.equal(paisResolved.intent.followup, false, "'¿Quién gobernó en este país en 1810?' must NOT be follow-up")
  assert.equal(paisResolved.context.workingMemory, undefined)

  console.log("PASS 3: Sequence 3 Topic switch isolation and false-positive guards passed")
}

// ---------------------------------------------------------------------------
// TEST 4: Pronouns and deictic queries
// ---------------------------------------------------------------------------
function testDeicticQueries() {
  const deictics = [
    "eso no lo entendí",
    "no entendí esa parte",
    "explica esa",
    "grafica esa",
    "ese valor de donde salio?",
    "¿por qué usaste esa fórmula?",
    "¿cuál de las dos?",
    "¿y entonces?",
    "de donde salio ese 4?",
    "hazlo otra vez",
    "explícame el segundo paso",
    "por que es negativo?",
  ]

  for (const q of deictics) {
    const intent = detectChatIntent(q)
    assert.equal(intent.followup, true, `Deictic query '${q}' should have followup=true`)
  }

  console.log("PASS 4: All deictic and pronoun queries recognized as followups")
}

// ---------------------------------------------------------------------------
// TEST 5: Client-side VisualSpec derivation for restored turns
// ---------------------------------------------------------------------------
function testClientSideVisualSpecDerivation() {
  const assistantMsgWithParabola = [
    "La función cuadrática \\(y = x^2 - 4x + 3\\) representa una parábola.",
    "Tiene vértice en (2, -1), raíces en (1, 0) y (3, 0), e intersección con el eje Y en (0, 3).",
  ].join("\n")

  const extracted = extractGraphSpec(assistantMsgWithParabola, [], "turn_123")
  assert.ok(extracted, "Must extract graph spec from text")
  assert.equal(extracted.data.expression, "x^2 - 4x + 3")
  assert.ok(extracted.data.points.some(p => p.label?.includes("Vértice")), "Must detect vertex")
  assert.ok(extracted.data.points.some(p => p.label?.includes("Raíz")), "Must detect roots")
  assert.ok(extracted.data.points.some(p => p.label?.includes("Corte Y")), "Must detect Y intercept")

  console.log("PASS 5: Client-side VisualSpec derivation succeeds with all critical points")
}

// ---------------------------------------------------------------------------
// TEST 6: Real User Flow Exact ("cuál era la b ahí?")
// ---------------------------------------------------------------------------
function testRealUserFlowExact() {
  const t1Msg = "Resuelve x² - 6x + 8 = 0 y explícame cómo lo hiciste."
  const t1Resolved = resolveConversation(t1Msg, null)
  assert.equal(t1Resolved.context.activeProblem, "x² - 6x + 8 = 0", "Must extract activeProblem x² - 6x + 8 = 0")

  // ALAI produces response stating a=1, b=-6, c=8
  const t1Answer = "Para resolver x² - 6x + 8 = 0, identificamos los coeficientes a = 1, b = -6 y c = 8. Factorizando: (x - 2)(x - 4) = 0, luego x = 2 y x = 4."
  const t1Context: ChatConversationContext = {
    ...t1Resolved.context,
    workingMemory: `Problema activo: x² - 6x + 8 = 0 | Elementos: a = 1; b = -6; c = 8 | Resumen previo: ${t1Answer.slice(0, 200)}`,
  }

  // Turn 2: User asks "cuál era la b ahí?"
  const t2Msg = "cuál era la b ahí?"
  const t2Resolved = resolveConversation(t2Msg, t1Context)

  assert.equal(t2Resolved.intent.followup, true, "cuál era la b ahí? MUST be classified as follow-up")
  assert.equal(t2Resolved.context.activeProblem, "x² - 6x + 8 = 0", "activeProblem must be preserved into Turn 2")
  assert.ok(t2Resolved.context.workingMemory?.includes("b = -6"), "workingMemory must retain b = -6")
  assert.ok(t2Resolved.retrievalQuery.includes("x² - 6x + 8 = 0"), "retrievalQuery must retain the active problem")

  console.log("PASS 6: Real user flow exact ('cuál era la b ahí?') resolves activeProblem and workingMemory")
}

// ---------------------------------------------------------------------------
// TEST 7: Dynamic Equation Separation across different runs (No fixture cache)
// ---------------------------------------------------------------------------
function testDynamicEquationsDifferentRuns() {
  // Run A: x² - 10x + 21 = 0
  const runAMsg = "Resuelve x² - 10x + 21 = 0 y dime a, b y c."
  const runA1 = resolveConversation(runAMsg, null)
  assert.equal(runA1.context.activeProblem, "x² - 10x + 21 = 0")
  const runAContext: ChatConversationContext = {
    ...runA1.context,
    workingMemory: "Problema activo: x² - 10x + 21 = 0 | Elementos: a = 1; b = -10; c = 21",
  }

  // Turn 2 in Run A: "cuál era la b ahí?"
  const runA2 = resolveConversation("cuál era la b ahí?", runAContext)
  assert.equal(runA2.intent.followup, true)
  assert.equal(runA2.context.activeProblem, "x² - 10x + 21 = 0")
  assert.ok(runA2.context.workingMemory?.includes("b = -10"))

  // Turn 3 in Run A: "y la c?"
  const runA3 = resolveConversation("y la c?", runA2.context)
  assert.equal(runA3.intent.followup, true)
  assert.equal(runA3.context.activeProblem, "x² - 10x + 21 = 0")
  assert.ok(runA3.context.workingMemory?.includes("c = 21"))

  // Run B: x² + 7x + 12 = 0 (completely different numbers)
  const runBMsg = "Resuelve x² + 7x + 12 = 0 y dime a, b y c."
  const runB1 = resolveConversation(runBMsg, null)
  assert.equal(runB1.context.activeProblem, "x² + 7x + 12 = 0")
  const runBContext: ChatConversationContext = {
    ...runB1.context,
    workingMemory: "Problema activo: x² + 7x + 12 = 0 | Elementos: a = 1; b = 7; c = 12",
  }

  // Turn 2 in Run B: EXACTLY the same phrase "cuál era la b ahí?"
  const runB2 = resolveConversation("cuál era la b ahí?", runBContext)
  assert.equal(runB2.intent.followup, true)
  assert.equal(runB2.context.activeProblem, "x² + 7x + 12 = 0")
  assert.ok(runB2.context.workingMemory?.includes("b = 7"))
  assert.ok(!runB2.context.workingMemory?.includes("-10"), "Run B must NOT contain Run A data")

  // Turn 3 in Run B: EXACTLY the same phrase "y la c?"
  const runB3 = resolveConversation("y la c?", runB2.context)
  assert.equal(runB3.intent.followup, true)
  assert.equal(runB3.context.activeProblem, "x² + 7x + 12 = 0")
  assert.ok(runB3.context.workingMemory?.includes("c = 12"))
  assert.ok(!runB3.context.workingMemory?.includes("21"), "Run B must NOT contain Run A data")

  console.log("PASS 7: Dynamic equations in separate runs resolve independently without cross-contamination")
}

// ---------------------------------------------------------------------------
// TEST 8: Topic Switch to Napoleon Bonaparte clears working memory and activeProblem
// ---------------------------------------------------------------------------
function testTopicSwitchNapoleon() {
  const mathContext: ChatConversationContext = {
    version: 1,
    subject: "Resuelve x² - 6x + 8 = 0",
    operation: "numbered_steps",
    sourcePolicy: "GENERAL_ONLY",
    usedTargetIds: [],
    usedRelationIds: [],
    activeProblem: "x² - 6x + 8 = 0",
    workingMemory: "Problema activo: x² - 6x + 8 = 0 | Elementos: a=1; b=-6; c=8",
  }

  const napoleonMsg = "¿Quién fue Napoleón Bonaparte?"
  const napoleonResolved = resolveConversation(napoleonMsg, mathContext)

  assert.equal(napoleonResolved.intent.followup, false, "Napoleon question must NOT be follow-up")
  assert.equal(napoleonResolved.context.subject, "¿Quién fue Napoleón Bonaparte?")
  assert.equal(napoleonResolved.context.activeProblem, "¿Quién fue Napoleón Bonaparte?", "Active problem must reset")
  assert.equal(napoleonResolved.context.workingMemory, undefined, "Working memory must be CLEARED")
  assert.ok(!napoleonResolved.retrievalQuery.includes("x²"), "Retrieval query must NOT mention quadratic equations")

  console.log("PASS 8: Topic switch to Napoleon Bonaparte cleans context and memory completely")
}

// ---------------------------------------------------------------------------
// TEST 9: Exact Real Bug Flow (Falcons -> Quadratic -> b -> a -> por qué es positiva -> raíces -> Imperio Romano)
// ---------------------------------------------------------------------------
function testFalconsToQuadraticSequence() {
  // Initial context: User was asking about Atlanta Falcons
  const falconsContext: ChatConversationContext = {
    version: 1,
    subject: "hazme una tabla comparando a los jugadores de los Falcons",
    operation: "comparison_table",
    sourcePolicy: "MIXED",
    usedTargetIds: [],
    usedRelationIds: [],
    activeProblem: "hazme una tabla comparando a los jugadores de los Falcons",
    workingMemory: "Problema activo: hazme una tabla comparando a los jugadores de los Falcons | Tabla con jugadores, posiciones y estadísticas",
  }

  // Turn 1: User enters brand new quadratic equation
  const t1Msg = "Resuelve 3x² + 15x + 12 = 0 y explícame qué son a, b y c."
  const t1Resolved = resolveConversation(t1Msg, falconsContext)

  assert.equal(t1Resolved.intent.followup, false, "Turn 1 with explicit equation MUST NOT be follow-up of Falcons")
  assert.equal(t1Resolved.context.activeProblem, "3x² + 15x + 12 = 0", "Active problem MUST be extracted as the quadratic equation")
  assert.equal(t1Resolved.context.subject, t1Msg, "Subject MUST be updated to the new prompt, NOT Falcons")
  assert.equal(t1Resolved.context.workingMemory, undefined, "Working memory MUST be wiped on new explicit problem")
  assert.equal(t1Resolved.context.operation, "worked_solution", "Operation MUST be worked_solution")

  // Simulate Turn 1 completion
  const t1Answer = "Dividiendo entre 3: x² + 5x + 4 = 0. Aquí a = 1, b = 5, c = 4. Factorizando: (x + 1)(x + 4) = 0. Raíces: x = -1 y x = -4."
  const t1Context: ChatConversationContext = {
    ...t1Resolved.context,
    sourcePolicy: "GENERAL_ONLY",
    workingMemory: `Problema activo: 3x² + 15x + 12 = 0 | Elementos: a = 1; b = 5; c = 4; x = -1; x = -4 | Resumen previo: ${t1Answer}`,
  }

  // Turn 2: "cuánto valía la b?"
  const t2Msg = "cuánto valía la b?"
  const t2Resolved = resolveConversation(t2Msg, t1Context)
  assert.equal(t2Resolved.intent.followup, true, "Turn 2 'cuánto valía la b?' MUST be a follow-up")
  assert.equal(t2Resolved.context.activeProblem, "3x² + 15x + 12 = 0", "Active problem MUST remain quadratic")
  assert.equal(t2Resolved.context.operation, "prose", "Follow-up question MUST resolve to prose, NOT inherit worked_solution")
  assert.ok(t2Resolved.context.workingMemory?.includes("b = 5"))

  const t2Context: ChatConversationContext = {
    ...t2Resolved.context,
    sourcePolicy: "GENERAL_ONLY",
    workingMemory: t1Context.workingMemory,
  }

  // Turn 3: "y la a?"
  const t3Msg = "y la a?"
  const t3Resolved = resolveConversation(t3Msg, t2Context)
  assert.equal(t3Resolved.intent.followup, true, "Turn 3 'y la a?' MUST be a follow-up")
  assert.equal(t3Resolved.context.activeProblem, "3x² + 15x + 12 = 0")
  assert.equal(t3Resolved.context.operation, "prose")
  assert.ok(t3Resolved.context.workingMemory?.includes("a = 1"))

  const t3Context: ChatConversationContext = {
    ...t3Resolved.context,
    sourcePolicy: "GENERAL_ONLY",
    workingMemory: t1Context.workingMemory,
  }

  // Turn 4: "por qué esa es positiva?"
  const t4Msg = "por qué esa es positiva?"
  const t4Resolved = resolveConversation(t4Msg, t3Context)
  assert.equal(t4Resolved.intent.followup, true, "Turn 4 'por qué esa es positiva?' MUST be a follow-up")
  assert.equal(t4Resolved.context.activeProblem, "3x² + 15x + 12 = 0")
  assert.equal(t4Resolved.context.operation, "prose", "Turn 4 clarification MUST resolve to prose, NOT worked_solution")
  assert.equal(t4Resolved.intent.shape, "prose")

  const t4Context: ChatConversationContext = {
    ...t4Resolved.context,
    sourcePolicy: "GENERAL_ONLY",
    workingMemory: t1Context.workingMemory,
  }

  // Turn 5: "qué raíces habíamos sacado?"
  const t5Msg = "qué raíces habíamos sacado?"
  const t5Resolved = resolveConversation(t5Msg, t4Context)
  assert.equal(t5Resolved.intent.followup, true, "Turn 5 'qué raíces habíamos sacado?' MUST be a follow-up")
  assert.equal(t5Resolved.context.activeProblem, "3x² + 15x + 12 = 0")
  assert.equal(t5Resolved.context.operation, "prose")
  assert.ok(t5Resolved.context.workingMemory?.includes("x = -1"))
  assert.ok(t5Resolved.context.workingMemory?.includes("x = -4"))

  const t5Context: ChatConversationContext = {
    ...t5Resolved.context,
    sourcePolicy: "GENERAL_ONLY",
    workingMemory: t1Context.workingMemory,
  }

  // Turn 6: Abrupt topic switch to Roman Empire
  const t6Msg = "¿Por qué cayó el Imperio romano de Occidente?"
  const t6Resolved = resolveConversation(t6Msg, t5Context)
  assert.equal(t6Resolved.intent.followup, false, "Roman Empire question MUST NOT be follow-up of quadratic")
  assert.equal(t6Resolved.context.subject, t6Msg)
  assert.equal(t6Resolved.context.activeProblem, t6Msg, "Active problem must reset to Roman Empire")
  assert.equal(t6Resolved.context.workingMemory, undefined, "Working memory MUST be cleared")
  assert.ok(!t6Resolved.retrievalQuery.includes("3x²"), "Retrieval query MUST NOT contain quadratic equation")

  console.log("PASS 9: Falcons -> Quadratic (T1-T5) -> Roman Empire full sequence verified")
}

// ---------------------------------------------------------------------------
// TEST 10: Mandatory 12-Step User Acceptance Journey
// ---------------------------------------------------------------------------
function testSequence10Mandatory12StepUserAcceptanceJourney() {
  // Step 1: Initial Quadratic Problem
  const s1Msg = "Resuelve 5x² + 20x + 15 = 0 y dime a,b,c"
  const s1Resolved = resolveConversation(s1Msg, null)
  assert.equal(s1Resolved.intent.followup, false, "Step 1: not followup")
  assert.equal(s1Resolved.context.activeProblem, "5x² + 20x + 15 = 0", "Step 1: activeProblem extracted")
  const s1Answer = "Para resolver 5x² + 20x + 15 = 0: identificamos los coeficientes a = 5, b = 20 y c = 15. Dividiendo entre 5 queda x² + 4x + 3 = 0, cuyas raíces son x = -1 y x = -3."
  const s1Focus = extractSemanticFocusFromTurn({
    userMessage: s1Msg,
    assistantAnswer: s1Answer,
    previousContext: s1Resolved.context,
  })
  const s1Context: ChatConversationContext = {
    ...s1Resolved.context,
    workingMemory: `Problema activo: 5x² + 20x + 15 = 0 | Elementos: a = 5; b = 20; c = 15; x = -1; x = -3 | Resumen: ${s1Answer.slice(0, 150)}`,
    ...(s1Focus.focusedEntity ? { focusedEntity: s1Focus.focusedEntity } : {}),
    ...(s1Focus.lastReferent ? { lastReferent: s1Focus.lastReferent } : {}),
    lastAssistantAction: 'answered',
  }

  // Step 2: "cuál era la b?"
  const s2Msg = "cuál era la b?"
  const s2Resolved = resolveConversation(s2Msg, s1Context)
  assert.equal(s2Resolved.intent.followup, true, "Step 2: followup")
  assert.equal(s2Resolved.context.activeProblem, "5x² + 20x + 15 = 0")
  assert.equal(s2Resolved.context.focusedEntity, "b", "Step 2: focusedEntity is b")
  assert.equal(s2Resolved.context.lastReferent, "b = 20", "Step 2: lastReferent resolves to b = 20 from workingMemory")
  const s2Answer = "El coeficiente b es 20, ya que acompaña al término lineal (20x) en 5x² + 20x + 15 = 0."
  const s2Focus = extractSemanticFocusFromTurn({
    userMessage: s2Msg,
    assistantAnswer: s2Answer,
    previousContext: s2Resolved.context,
  })
  assert.equal(s2Focus.focusedEntity, "b")
  assert.equal(s2Focus.lastReferent, "b = 20")
  assert.equal(s2Focus.lastAssistantAction, "clarification")
  const s2Context: ChatConversationContext = {
    ...s2Resolved.context,
    focusedEntity: s2Focus.focusedEntity,
    lastReferent: s2Focus.lastReferent,
    lastAssistantAction: s2Focus.lastAssistantAction,
  }

  // Step 3: "y la a?"
  const s3Msg = "y la a?"
  const s3Resolved = resolveConversation(s3Msg, s2Context)
  assert.equal(s3Resolved.intent.followup, true, "Step 3: followup")
  assert.equal(s3Resolved.context.activeProblem, "5x² + 20x + 15 = 0")
  assert.equal(s3Resolved.context.focusedEntity, "a", "Step 3: focusedEntity is a")
  assert.equal(s3Resolved.context.lastReferent, "a = 5", "Step 3: lastReferent resolves to a = 5 from workingMemory")
  const s3Answer = "El valor de a es 5, que corresponde al término cuadrático 5x²."
  const s3Focus = extractSemanticFocusFromTurn({
    userMessage: s3Msg,
    assistantAnswer: s3Answer,
    previousContext: s3Resolved.context,
  })
  assert.equal(s3Focus.focusedEntity, "a")
  assert.equal(s3Focus.lastReferent, "a = 5")
  const s3Context: ChatConversationContext = {
    ...s3Resolved.context,
    focusedEntity: s3Focus.focusedEntity,
    lastReferent: s3Focus.lastReferent,
    lastAssistantAction: s3Focus.lastAssistantAction,
  }

  // Step 4: "por qué esa es positiva?"
  const s4Msg = "por qué esa es positiva?"
  const s4Resolved = resolveConversation(s4Msg, s3Context)
  assert.equal(s4Resolved.intent.followup, true, "Step 4: followup")
  assert.equal(s4Resolved.context.activeProblem, "5x² + 20x + 15 = 0")
  assert.equal(s4Resolved.context.focusedEntity, "a", "Step 4: deictic 'esa' MUST resolve to previous focusedEntity 'a'")
  assert.equal(s4Resolved.context.lastReferent, "a = 5", "Step 4: deictic 'esa' MUST resolve to 'a = 5', NOT c=15 or b=20")
  const s4Answer = "a = 5 es positiva porque el término cuadrático 5x² tiene signo positivo (+5), lo que indica que la parábola abre hacia arriba."
  const s4Focus = extractSemanticFocusFromTurn({
    userMessage: s4Msg,
    assistantAnswer: s4Answer,
    previousContext: s4Resolved.context,
  })
  assert.equal(s4Focus.lastReferent, "a = 5")
  const s4Context: ChatConversationContext = {
    ...s4Resolved.context,
    focusedEntity: s4Focus.focusedEntity,
    lastReferent: s4Focus.lastReferent,
    lastAssistantAction: s4Focus.lastAssistantAction,
  }

  // Step 5: "ponme otra parecida sin resolverla"
  const s5Msg = "ponme otra parecida sin resolverla"
  const s5Resolved = resolveConversation(s5Msg, s4Context)
  assert.equal(s5Resolved.intent.followup, true, "Step 5: followup")
  const s5Answer = "Aquí tienes una ecuación cuadrática parecida para practicar: 2x² + 10x + 8 = 0. Identifica primero a, b y c."
  const s5Focus = extractSemanticFocusFromTurn({
    userMessage: s5Msg,
    assistantAnswer: s5Answer,
    previousContext: s5Resolved.context,
  })
  assert.equal(s5Focus.lastAssistantAction, "generated_exercise", "Step 5: assistant action must be generated_exercise")
  assert.equal(s5Focus.activeProblem, "2x² + 10x + 8 = 0", "Step 5: activeProblem MUST mutate to newly generated exercise")
  const s5Context: ChatConversationContext = {
    ...s5Resolved.context,
    activeProblem: s5Focus.activeProblem,
    focusedEntity: s5Focus.focusedEntity,
    lastReferent: s5Focus.lastReferent,
    lastAssistantAction: s5Focus.lastAssistantAction,
    workingMemory: `Problema activo: 2x² + 10x + 8 = 0 | Elementos: 2x² + 10x + 8 = 0 | Resumen: ${s5Answer.slice(0, 150)}`,
  }

  // Step 6: "dame una pista nada más"
  const s6Msg = "dame una pista nada más"
  const s6Resolved = resolveConversation(s6Msg, s5Context)
  assert.equal(s6Resolved.intent.followup, true, "Step 6: hint MUST be classified as followup")
  assert.equal(s6Resolved.context.activeProblem, "2x² + 10x + 8 = 0", "Step 6: activeProblem MUST be the generated exercise 2x² + 10x + 8 = 0")
  assert.ok(s6Resolved.retrievalQuery.includes("2x² + 10x + 8 = 0"), "Step 6: retrievalQuery must retain the generated exercise")
  const s6Answer = "Pista: Observa que todos los coeficientes (2, 10, 8) son múltiplos de 2. Prueba dividiendo toda la ecuación entre 2 para simplificarla."
  const s6Focus = extractSemanticFocusFromTurn({
    userMessage: s6Msg,
    assistantAnswer: s6Answer,
    previousContext: s6Resolved.context,
  })
  assert.equal(s6Focus.lastAssistantAction, "hint")
  assert.equal(s6Focus.activeProblem, "2x² + 10x + 8 = 0")
  const s6Context: ChatConversationContext = {
    ...s6Resolved.context,
    activeProblem: s6Focus.activeProblem,
    lastAssistantAction: s6Focus.lastAssistantAction,
  }

  // Step 7: "otra pista"
  const s7Msg = "otra pista"
  const s7Resolved = resolveConversation(s7Msg, s6Context)
  assert.equal(s7Resolved.intent.followup, true, "Step 7: followup")
  assert.equal(s7Resolved.context.activeProblem, "2x² + 10x + 8 = 0", "Step 7: maintains 2x² + 10x + 8 = 0")
  const s7Answer = "Segunda pista: Al simplificar obtienes x² + 5x + 4 = 0. Busca dos números que multiplicados den 4 y sumados den 5."
  const s7Focus = extractSemanticFocusFromTurn({
    userMessage: s7Msg,
    assistantAnswer: s7Answer,
    previousContext: s7Resolved.context,
  })
  assert.equal(s7Focus.lastAssistantAction, "hint")
  const s7Context: ChatConversationContext = {
    ...s7Resolved.context,
    activeProblem: s7Focus.activeProblem,
    lastAssistantAction: s7Focus.lastAssistantAction,
  }

  // Step 8: "ahora resuélvela"
  const s8Msg = "ahora resuélvela"
  const s8Resolved = resolveConversation(s8Msg, s7Context)
  assert.equal(s8Resolved.intent.followup, true, "Step 8: followup")
  assert.equal(s8Resolved.intent.shape, "worked_solution", "Step 8: shape is worked_solution")
  assert.equal(s8Resolved.context.activeProblem, "2x² + 10x + 8 = 0", "Step 8: solves 2x² + 10x + 8 = 0")
  const s8Answer = "Resolución de 2x² + 10x + 8 = 0: dividiendo entre 2 queda x² + 5x + 4 = 0. Factorizamos (x + 1)(x + 4) = 0. Las soluciones son x = -1 y x = -4."
  const s8Focus = extractSemanticFocusFromTurn({
    userMessage: s8Msg,
    assistantAnswer: s8Answer,
    previousContext: s8Resolved.context,
  })
  const s8Context: ChatConversationContext = {
    ...s8Resolved.context,
    activeProblem: "2x² + 10x + 8 = 0",
    workingMemory: `Problema activo: 2x² + 10x + 8 = 0 | Elementos: x = -1; x = -4; a = 2; b = 10; c = 8 | Resumen: ${s8Answer.slice(0, 150)}`,
    lastAssistantAction: "answered",
  }

  // Step 9: "ponme otra más difícil"
  const s9Msg = "ponme otra más difícil"
  const s9Resolved = resolveConversation(s9Msg, s8Context)
  assert.equal(s9Resolved.intent.followup, true, "Step 9: followup")
  assert.equal(s9Resolved.intent.shape, "worked_solution")
  const s9Answer = "Aquí tienes una más difícil: 3x² - 7x - 6 = 0. Intenta usar la fórmula cuadrática."
  const s9Focus = extractSemanticFocusFromTurn({
    userMessage: s9Msg,
    assistantAnswer: s9Answer,
    previousContext: s9Resolved.context,
  })
  assert.equal(s9Focus.lastAssistantAction, "generated_exercise")
  assert.equal(s9Focus.activeProblem, "3x² - 7x - 6 = 0", "Step 9: activeProblem MUST mutate to 3x² - 7x - 6 = 0")
  const s9Context: ChatConversationContext = {
    ...s9Resolved.context,
    activeProblem: s9Focus.activeProblem,
    focusedEntity: s9Focus.focusedEntity,
    lastReferent: s9Focus.lastReferent,
    lastAssistantAction: s9Focus.lastAssistantAction,
    workingMemory: `Problema activo: 3x² - 7x - 6 = 0 | Elementos: a = 3; b = -7; c = -6 | Resumen: ${s9Answer.slice(0, 150)}`,
  }

  // Step 10: "solo dime la b"
  const s10Msg = "solo dime la b"
  const s10Resolved = resolveConversation(s10Msg, s9Context)
  assert.equal(s10Resolved.intent.followup, true, "Step 10: 'solo dime la b' MUST be followup")
  assert.equal(s10Resolved.context.activeProblem, "3x² - 7x - 6 = 0", "Step 10: activeProblem MUST be 3x² - 7x - 6 = 0")
  assert.equal(s10Resolved.context.focusedEntity, "b", "Step 10: focusedEntity is b")
  assert.equal(s10Resolved.context.lastReferent, "b = -7", "Step 10: lastReferent resolves to b = -7 from workingMemory")
  const s10Context: ChatConversationContext = s10Resolved.context

  // Step 11: Topic switch: "¿Cómo funciona la fotosíntesis?"
  const s11Msg = "¿Cómo funciona la fotosíntesis?"
  const s11Resolved = resolveConversation(s11Msg, s10Context)
  assert.equal(s11Resolved.intent.followup, false, "Step 11: photosynthesis MUST NOT be followup")
  assert.equal(s11Resolved.context.subject, "¿Cómo funciona la fotosíntesis?")
  assert.equal(s11Resolved.context.activeProblem, "¿Cómo funciona la fotosíntesis?", "Step 11: activeProblem resets to photosynthesis")
  assert.equal(s11Resolved.context.workingMemory, undefined, "Step 11: workingMemory CLEARED")
  assert.ok(!s11Resolved.retrievalQuery.includes("3x²"), "Step 11: query has no math residue")

  // Step 12: Material Question (Explicit Material Only)
  const s12Msg = "Solo según mi material, ¿cuáles son los pasos del ciclo de Krebs?"
  const s12Resolved = resolveConversation(s12Msg, s11Resolved.context)
  assert.equal(s12Resolved.intent.explicitPolicy, "MATERIAL_ONLY", "Step 12: 'Solo según mi material' detects MATERIAL_ONLY")
  assert.equal(s12Resolved.context.sourcePolicy, "MATERIAL_ONLY")

  console.log("PASS 10: Mandatory 12-Step User Acceptance Journey verified with full state fidelity!")
}

function runAll() {
  testSequence1MathMultiTurn()
  testSequence2MaterialContinuity()
  testSequence3TopicSwitchIsolation()
  testDeicticQueries()
  testClientSideVisualSpecDerivation()
  testRealUserFlowExact()
  testDynamicEquationsDifferentRuns()
  testTopicSwitchNapoleon()
  testFalconsToQuadraticSequence()
  testSequence10Mandatory12StepUserAcceptanceJourney()
  console.log("\nALL 10 CONVERSATIONAL MEMORY CONTRACT SUITES PASSED!")
}

runAll()

