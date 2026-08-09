import type { EvaluableObjective } from './coverageExtractor'
import { alaiJson } from '../../alai'

export interface ReteachContext {
  materialTitle: string
  sessionTitle: string
}

export async function generateReteachContent(
  objective: EvaluableObjective,
  studentAnswer: any,
  correctAnswer: any,
  context: ReteachContext
): Promise<string | null> {

  const prompt = `
Eres un tutor experto.

El estudiante FALLÓ esta evaluación.

MATERIAL: "${context.materialTitle}"
SESIÓN: "${context.sessionTitle}"

CONCEPTO:
${objective.conceptLabel}

LO QUE SE ENSEÑÓ:
${objective.teachingContent}

IDEA CLAVE:
${objective.keyPoint || 'N/A'}

RESPUESTA DEL ESTUDIANTE:
${JSON.stringify(studentAnswer)}

RESPUESTA CORRECTA:
${JSON.stringify(correctAnswer)}

Tu tarea:
1. Explicar claramente en qué se equivocó.
2. Re-explicar el concepto usando un enfoque diferente.
3. Dar un ejemplo nuevo.
4. No repetir exactamente el texto original.
5. Ser claro, directo y personalizado (segunda persona singular).

Devuelve SOLO texto explicativo.
`

  try {
    const result = await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens: 1000
    })

    return typeof result === 'string'
      ? result
      : result?.content || null

  } catch (err) {
    console.error('Reteach error:', err)
    return null
  }
}
