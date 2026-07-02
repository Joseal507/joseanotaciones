import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const blueprint = body.blueprint
    const setup = body.setup || {}
    const userProfile = body.userProfile || null
    const mastery = body.mastery || null
    const learningMemory = body.learningMemory || null

    if (!blueprint || !Array.isArray(blueprint.topics) || blueprint.topics.length === 0) {
      return NextResponse.json({ success: false, error: 'Blueprint inválido o sin topics' }, { status: 400 })
    }

    const sessionLength = setup.sessionLength || 'medium'
    const targetScore = setup.targetScore || 80
    const examDate = setup.examDate || null
    const initialKnowledge = setup.initialKnowledgeLevel || 'some'

    // ── Calcular días al examen ──
    const examDateMap: Record<string, number> = {
      today: 0, tomorrow: 1, in_3_days: 3, in_1_week: 7,
      in_2_weeks: 14, in_1_month: 30, no_exam: 999,
    }
    const daysToExam = examDateMap[examDate] ?? null

    // ── Analizar el material profundamente ──
    const topics = blueprint.topics
    const totalConcepts = topics.reduce((sum: number, t: any) => sum + (t.concepts || []).length, 0)
    const criticalConcepts = topics.reduce((sum: number, t: any) =>
      sum + (t.concepts || []).filter((c: any) => c.importance === 'critical').length, 0)
    const avgDifficulty = topics.length > 0
      ? Math.round(topics.reduce((sum: number, t: any) => sum + (t.difficulty || 50), 0) / topics.length)
      : 50
    const maxDifficulty = Math.max(...topics.map((t: any) => t.difficulty || 50))

    // ── Calcular sesiones necesarias según material + estudiante ──
    let baseSessions = topics.length

    // Material difícil → más sesiones
    if (avgDifficulty > 70) baseSessions = Math.ceil(baseSessions * 1.3)
    else if (avgDifficulty > 50) baseSessions = Math.ceil(baseSessions * 1.1)

    // Muchos conceptos críticos → más sesiones
    baseSessions += Math.floor(criticalConcepts / 3)

    // Siempre 1 sesión de síntesis final si hay más de 3 topics
    if (topics.length >= 3) baseSessions += 1

    // Ajustar por conocimiento inicial
    const knowledgeMultiplier: Record<string, number> = {
      zero: 1.4,    // No sabe nada → 40% más sesiones
      some: 1.0,    // Conocimiento parcial → base
      review: 0.75, // Repaso → 25% menos
      mastered: 0.5, // Ya domina → la mitad
    }
    baseSessions = Math.ceil(baseSessions * (knowledgeMultiplier[initialKnowledge] || 1.0))

    // Ajustar por fecha de examen (urgencia)
    if (daysToExam !== null && daysToExam !== 999) {
      if (daysToExam <= 1) baseSessions = Math.min(baseSessions, 3)
      else if (daysToExam <= 3) baseSessions = Math.min(baseSessions, 6)
      else if (daysToExam <= 7) baseSessions = Math.min(baseSessions, 10)
      else if (daysToExam <= 14) baseSessions = Math.min(baseSessions, 15)
    }

    // Ajustar por targetScore alto
    if (targetScore >= 90) baseSessions = Math.ceil(baseSessions * 1.1)

    const totalSessions = Math.max(2, Math.min(20, baseSessions))

    // ── Duración por sesión según sessionLength ──
    const lengthConfig = {
      short:  { targetMin: 12, label: 'corta (12 min)', maxConcepts: 2 },
      medium: { targetMin: 22, label: 'media (22 min)', maxConcepts: 4 },
      long:   { targetMin: 35, label: 'larga (35 min)', maxConcepts: 6 },
    }[sessionLength as string] || { targetMin: 22, label: 'media', maxConcepts: 4 }

    // ── Perfil del estudiante ──
    const profileSection = userProfile ? `
PERFIL DEL ESTUDIANTE:
- Tipo: ${userProfile.tipoEstudiante || 'no especificado'}
- Carrera: ${userProfile.carrera || 'no especificada'}
- Universidad: ${userProfile.universidad || userProfile.escuela || 'no especificada'}
- Nivel académico: ${userProfile.academicLevel || 'intermedio'}
- Objetivo: ${userProfile.objetivo || 'aprender el material'}
- Contexto: ${userProfile.studyContext || 'learning'}
` : ''

    const knowledgeLabel: Record<string, string> = {
      zero: 'NUNCA ha visto este tema — empieza desde CERO ABSOLUTO',
      some: 'Conocimiento parcial — vio algo pero no tiene claridad',
      review: 'Ya lo estudió antes — necesita repasar y consolidar',
      mastered: 'Ya domina el tema — solo necesita consolidar y practicar',
    }

    const urgencyLabel = daysToExam === null ? 'Sin fecha de examen (dominio a largo plazo)'
      : daysToExam === 0 ? '🚨 EXAMEN HOY — modo rescate, solo lo esencial'
      : daysToExam === 1 ? '🔴 EXAMEN MAÑANA — modo intensivo'
      : daysToExam <= 3 ? `🟡 EXAMEN EN ${daysToExam} DÍAS — modo rápido`
      : daysToExam <= 7 ? `🟢 EXAMEN EN ${daysToExam} DÍAS — ritmo normal`
      : `✅ EXAMEN EN ${daysToExam} DÍAS — tiempo suficiente`

    // ── Resumen de topics con dificultad real ──
    const topicsSummary = topics.map((t: any, i: number) => {
      const conceptCount = (t.concepts || []).length
      const criticalCount = (t.concepts || []).filter((c: any) => c.importance === 'critical').length
      const conceptNames = (t.concepts || []).map((c: any) => c.name).slice(0, 5).join(', ')
      const diffLabel = t.difficulty >= 75 ? 'DIFÍCIL'
        : t.difficulty >= 50 ? 'MODERADO' : 'FÁCIL'
      return `Topic ${i + 1}:
  - ID EXACTO (usa este en topicIds): "${t.id}"
  - Título: "${t.title}"
  - Dificultad: ${diffLabel} (${t.difficulty || 50}/100)
  - Importancia: ${t.importance || 50}/100
  - Conceptos (${conceptCount}): ${conceptNames}
  - Conceptos críticos: ${criticalCount}
  - Tiempo estimado: ${t.estimatedMinutes || 15} min`
    }).join('\n\n')

    const memorySection = learningMemory?.learningStyle && learningMemory.learningStyle !== 'unknown'
      ? `\nESTILO DE APRENDIZAJE DETECTADO: ${learningMemory.learningStyle}`
      : ''

    const prompt = `Eres ALAI, diseñador pedagógico experto. Diseña un programa de estudio PERSONALIZADO.

═══ ANÁLISIS DEL MATERIAL ═══
Total de topics: ${topics.length}
Total de conceptos: ${totalConcepts}
Conceptos críticos: ${criticalConcepts}
Dificultad promedio: ${avgDifficulty}/100
Dificultad máxima: ${maxDifficulty}/100

═══ ESTUDIANTE ═══
Conocimiento inicial: ${knowledgeLabel[initialKnowledge] || 'Parcial'}
Meta de dominio: ${targetScore}%
Urgencia: ${urgencyLabel}
Duración de sesión elegida: ${lengthConfig.label}
${profileSection}${memorySection}

═══ SESIONES A DISEÑAR: ${totalSessions} ═══

═══ TOPICS DEL MATERIAL ═══
${topicsSummary}

═══ REGLAS DE DISEÑO ═══

1. **Sesiones = ${totalSessions}** (calculadas según material + estudiante). Respeta este número exacto.

2. **Agrupación inteligente:**
   - Topics fáciles + relacionados → una sesión
   - Topics difíciles (≥70) → una sesión cada uno, o dividir en 2 si son complejos
   - Nunca más de ${lengthConfig.maxConcepts} conceptos por sesión

3. **Progresión obligatoria:**
   - Sesiones 1-${Math.ceil(totalSessions * 0.4)}: INTRODUCCIÓN (understand) — conceptos base, sin asumir conocimiento
   - Sesiones ${Math.ceil(totalSessions * 0.4) + 1}-${Math.ceil(totalSessions * 0.75)}: PROFUNDIZACIÓN (deepen/apply) — conectar y aplicar
   - Sesiones ${Math.ceil(totalSessions * 0.75) + 1}-${totalSessions}: CONSOLIDACIÓN (simulate/integrate) — verificar dominio real

4. **Adaptación al estudiante:**
   ${initialKnowledge === 'zero' ? '- CERO: Cada sesión DEBE empezar explicando desde la base. Sin asumir nada.' : ''}
   ${initialKnowledge === 'review' ? '- REPASO: Ir directo a práctica y verificación, menos explicación.' : ''}
   ${userProfile?.academicLevel === 'basico' ? '- NIVEL BÁSICO: Sesiones más simples, conceptos de a uno.' : ''}
   ${userProfile?.academicLevel === 'avanzado' ? '- NIVEL AVANZADO: Más densidad, conectar con aplicaciones profesionales.' : ''}
   ${daysToExam !== null && daysToExam <= 3 ? '- URGENTE: Priorizar conceptos críticos. Agrupar agresivamente.' : ''}

5. **Última sesión:** SIEMPRE simulación o integración total. Nunca introducción.

6. **CRÍTICO — topicIds:** Usa EXACTAMENTE los IDs que aparecen como "ID EXACTO" en la lista de topics.
   NO uses "Topic 1", "Topic 2" — usa el id real como "t1", "abc123", etc.
   Si un topic tiene id "t3", escribe "t3" en topicIds, no "Topic 3".

6. **expectedDomainGain:** Realista según dificultad del topic:
   - Topic fácil: 12-18 puntos
   - Topic moderado: 8-14 puntos
   - Topic difícil: 5-10 puntos

═══ FORMATO — SOLO JSON ═══
{
  "totalSessions": ${totalSessions},
  "rationale": "Explicación breve de por qué este programa para ESTE estudiante con ESTE material",
  "sessions": [
    {
      "sessionNumber": 1,
      "title": "Título concreto (no genérico)",
      "objective": "Qué dominará al terminar esta sesión específica",
      "purpose": "understand|deepen|memorize|apply|integrate|simulate|repair|consolidate",
      "topicIds": ["id exacto del topic"],
      "topicTitles": ["Título del topic"],
      "estimatedMinutes": ${lengthConfig.targetMin},
      "expectedDomainGain": 12,
      "rationale": "Por qué esta sesión en este momento del programa",
      "difficulty": "easy|medium|hard"
    }
  ]
}`

    const rawText = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn('llama-3.3-70b-versatile'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.35,
        max_tokens: 4000,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let parsed: any = null
    try { parsed = JSON.parse(String(rawText).trim()) } catch {}
    if (!parsed) {
      const match = String(rawText).match(/\{[\s\S]*\}/)
      if (match) try { parsed = JSON.parse(match[0]) } catch {}
    }

    if (!parsed?.sessions?.length) {
      const raw = String(rawText || '').slice(0, 800)
      console.error('[plan-program] FALLO — rawText:', raw)
      console.error('[plan-program] FALLO — parsed:', JSON.stringify(parsed)?.slice(0, 300))
      // Intentar extraer array de sessions si viene en formato diferente
      const arrMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/)
      if (arrMatch) {
        try {
          const sessions = JSON.parse(arrMatch[0])
          if (Array.isArray(sessions) && sessions.length > 0) {
            parsed = { sessions }
            console.log('[plan-program] ✅ sessions extraídas del array directo')
          }
        } catch {}
      }
      if (!parsed?.sessions?.length) {
        return NextResponse.json({ success: false, error: 'ALAI no devolvió un programa válido' }, { status: 503 })
      }
    }

    const sessions = parsed.sessions.map((s: any, i: number) => ({
      sessionNumber: i + 1,
      title: String(s.title || `Sesión ${i + 1}`).slice(0, 80),
      objective: String(s.objective || 'Avanzar en el dominio del tema').slice(0, 200),
      purpose: String(s.purpose || 'understand'),
      topicIds: Array.isArray(s.topicIds) ? s.topicIds.map(String) : [],
      topicTitles: Array.isArray(s.topicTitles) ? s.topicTitles.map(String) : [],
      estimatedMinutes: Number(s.estimatedMinutes) || lengthConfig.targetMin,
      expectedDomainGain: Number(s.expectedDomainGain) || 10,
      rationale: String(s.rationale || '').slice(0, 200),
      difficulty: String(s.difficulty || 'medium'),
    }))

    console.log(`[plan-program] ✅ ${sessions.length} sesiones | material: ${avgDifficulty}/100 dif | ${initialKnowledge} | ${daysToExam ?? 'sin'} días`)

    return NextResponse.json({
      success: true,
      totalSessions: sessions.length,
      rationale: String(parsed.rationale || '').slice(0, 300),
      sessions,
      meta: {
        avgDifficulty,
        totalConcepts,
        criticalConcepts,
        daysToExam,
        initialKnowledge,
        sessionLength,
      },
    })

  } catch (err: any) {
    console.error('[plan-program] Error:', err?.message)
    return NextResponse.json({ success: false, error: 'ALAI está ocupado.' }, { status: 503 })
  }
}
