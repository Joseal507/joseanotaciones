import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { generateValidatedLegacyJson } from '../../lib/ai/legacyRouteGeneration'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { StoredChatTurn, ChatTurnResult } from '../../lib/alai-chat/turnStore'

const selection = buildSourceSelectionSnapshot(['math-fixture'], { 'math-fixture': [1] })
const material = {
  sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages,
  topicsIndex: [{ id: 'math', title: 'Álgebra cuadrática' }],
  globalOrderedAnalysis: [],
  uniqueConceptsIndex: [], relations: [],
}

const turns = [
  {
    msg: "Resuelve 4x² + 12x + 8 = 0 y dime qué representan a, b y c.",
    answer: "Para resolver 4x² + 12x + 8 = 0, identificamos a = 4, b = 12 y c = 8. Dividiendo entre 4 queda x² + 3x + 2 = 0. Factorizando: (x + 1)(x + 2) = 0, por lo que x = -1 y x = -2.",
  },
  {
    msg: "cuánto era la b?",
    answer: "b = 12. En la ecuación 4x² + 12x + 8 = 0, b representa el coeficiente del término lineal (12x).",
  },
  {
    msg: "y la c?",
    answer: "c = 8. En la ecuación 4x² + 12x + 8 = 0, c es el término constante o independiente.",
  },
  {
    msg: "por qué esa es positiva?",
    answer: "c = 8 es positiva porque el término independiente es +8, lo que indica que la parábola corta al eje vertical Y en (0, 8).",
  },
  {
    msg: "ponme una parecida pero no la resuelvas",
    answer: "Aquí tienes una parecida para que la resuelvas tú: 2x² - 7x + 3 = 0. ¿Qué método te gustaría intentar primero?",
  },
  {
    msg: "solo una pista",
    answer: "Pista: Aquí a = 2, b = -7 y c = 3. Busca dos números que multiplicados den a*c = 6 y sumados den b = -7.",
  },
  {
    msg: "otra",
    answer: "Segunda pista: Los números que buscas son -6 y -1, porque (-6)*(-1) = 6 y (-6) + (-1) = -7. Reescribe el término del medio como -6x - x.",
  },
  {
    msg: "ahora sí resuélvela",
    answer: "Resolución de 2x² - 7x + 3 = 0:\n1. 2x² - 6x - x + 3 = 0\n2. 2x(x - 3) - 1(x - 3) = 0\n3. (2x - 1)(x - 3) = 0\nLas soluciones son x = 1/2 y x = 3.",
  },
  {
    msg: "ponme otra más difícil",
    answer: "Aquí tienes una más difícil: 6x² + 11x - 10 = 0. ¡Intenta resolverla!",
  },
]

async function runRegression() {
  const records = new Map<string, StoredChatTurn>()
  __routeDeps.chatTurnStore = {
    async read(id) { return records.get(id) ?? null },
    async compareAndSet(id, expected, revision, record) {
      if ((records.get(id)?.revision ?? null) !== expected) return false
      records.set(id, { revision, record })
      return true
    },
  }
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'math-test-user' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'math-test', userId: 'math-test-user', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'math-fixture', nombre: 'Álgebra cuadrática' }),
    lookupStudyalMaterialEnjoyer: async () => material,
  })

  let currentTurn = 0
  __routeDeps.generateValidatedLegacyJson = input => generateValidatedLegacyJson({
    ...input,
    provider: async () => {
      return {
        text: JSON.stringify({
          answer: turns[currentTurn].answer,
          usedTargetIds: [],
          usedRelationIds: [],
          suggestedFollowups: [],
          externalKnowledgeUsed: true,
        }),
        provider: 'offline',
        model: 'fixture',
        completion: {
          finishReason: 'stop',
          transportComplete: true,
          provider: 'offline',
          model: 'fixture',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, reasoningTokens: 0 },
        },
      }
    },
  })

  let previousResult: ChatTurnResult | undefined
  const history: { role: string; content: string }[] = []

  for (currentTurn = 0; currentTurn < turns.length; currentTurn++) {
    const turn = turns[currentTurn]
    console.log(`\n--- TURN ${currentTurn + 1}: "${turn.msg}" ---`)
    const body = {
      sessionId: 'math-test',
      turnId: `turn-${currentTurn}`,
      attempt: 1,
      message: turn.msg,
      history: [...history],
      conversationContext: previousResult?.conversationContext,
    }

    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }))

    const result = await response.json()
    console.log(`Response Status: ${response.status}`)
    console.log('Result context:', {
      activeProblem: result.conversationContext?.activeProblem,
      focusedEntity: result.conversationContext?.focusedEntity,
      lastReferent: result.conversationContext?.lastReferent,
      lastAssistantAction: result.conversationContext?.lastAssistantAction,
      operation: result.conversationContext?.operation,
    })

    assert.equal(response.status, 200, `Turn ${currentTurn + 1} failed: ${JSON.stringify(result)}`)

    if (currentTurn === 0) {
      assert.equal(result.conversationContext?.activeProblem, "4x² + 12x + 8 = 0")
    } else if (currentTurn === 1) {
      assert.equal(result.conversationContext?.activeProblem, "4x² + 12x + 8 = 0")
      assert.equal(result.conversationContext?.focusedEntity, "b")
    } else if (currentTurn === 2) {
      assert.equal(result.conversationContext?.activeProblem, "4x² + 12x + 8 = 0")
      assert.equal(result.conversationContext?.focusedEntity, "c")
    } else if (currentTurn === 3) {
      assert.equal(result.conversationContext?.activeProblem, "4x² + 12x + 8 = 0")
      assert.equal(result.conversationContext?.focusedEntity, "c")
    } else if (currentTurn === 4) {
      // Turn 5: "ponme una parecida pero no la resuelvas"
      console.log("Turn 5 check - activeProblem should be 2x² - 7x + 3 = 0, got:", result.conversationContext?.activeProblem)
      assert.equal(result.conversationContext?.activeProblem, "2x² - 7x + 3 = 0", "Turn 5 MUST update activeProblem to 2x² - 7x + 3 = 0")
      assert.equal(result.conversationContext?.lastAssistantAction, "generated_exercise")
    } else if (currentTurn === 5) {
      // Turn 6: "solo una pista"
      console.log("Turn 6 check - activeProblem should be 2x² - 7x + 3 = 0, got:", result.conversationContext?.activeProblem)
      assert.equal(result.conversationContext?.activeProblem, "2x² - 7x + 3 = 0", "Turn 6 MUST maintain activeProblem as 2x² - 7x + 3 = 0")
      assert.equal(result.conversationContext?.lastAssistantAction, "hint")
    } else if (currentTurn === 6) {
      // Turn 7: "otra"
      console.log("Turn 7 check - activeProblem should be 2x² - 7x + 3 = 0, got:", result.conversationContext?.activeProblem)
      assert.equal(result.conversationContext?.activeProblem, "2x² - 7x + 3 = 0", "Turn 7 MUST maintain activeProblem as 2x² - 7x + 3 = 0")
      assert.equal(result.conversationContext?.lastAssistantAction, "hint")
    } else if (currentTurn === 7) {
      // Turn 8: "ahora sí resuélvela"
      console.log("Turn 8 check - activeProblem should be 2x² - 7x + 3 = 0, got:", result.conversationContext?.activeProblem)
      assert.equal(result.conversationContext?.activeProblem, "2x² - 7x + 3 = 0")
      assert.equal(result.conversationContext?.lastAssistantAction, "answered")
    } else if (currentTurn === 8) {
      // Turn 9: "ponme otra más difícil"
      console.log("Turn 9 check - activeProblem should be 6x² + 11x - 10 = 0, got:", result.conversationContext?.activeProblem)
      assert.equal(result.conversationContext?.activeProblem, "6x² + 11x - 10 = 0")
      assert.equal(result.conversationContext?.lastAssistantAction, "generated_exercise")
    }

    history.push({ role: 'user', content: turn.msg })
    history.push({ role: 'assistant', content: result.answer })
    previousResult = result
  }

  console.log("\nALL 9 REAL TURNS PASSED IN REAL PIPELINE!")
}

runRegression().catch(err => {
  console.error("\nREPRODUCTION ERROR:", err)
  process.exit(1)
})
