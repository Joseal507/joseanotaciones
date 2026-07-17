'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import StudyALSessionV3 from '../../components/materias/adaptive/v3/StudyALSessionV3'
import IntroSession from '../../components/materias/adaptive/IntroSession'
import { normalizeInteractionForPreference, validateInteractionContract, validateNoAnswerLeak } from '../../lib/adaptive/v3/engine/interactionContract'
import { evaluateNumericShort } from '../../lib/adaptive/v3/engine/answerEvaluator'

const session = {
  id: 'e2e-session', sessionNumber: 1, title: 'Libro canónico de Bohr', objective: 'Comprender energía cuantizada', estimatedMinutes: 12, status: 'available' as const, steps: [], expectedDomainGain: 10, topicTitle: 'Modelo de Bohr',
  targetConcepts: ['Energía cuantizada'], assignedMicroIds: ['micro_bohr_energy'],
  evaluationPreference: 'quick_test' as const, purpose: 'understand' as const, sessionFormat: 'discovery',
}

export default function AdaptiveE2EFixture() {
  const params = useSearchParams()
  const mode = params.get('mode') || 'session'
  const evalPreference = params.get('preference') === 'mix' ? 'mix_everything' as const : 'quick_test' as const
  const [destination, setDestination] = useState<'session' | 'book' | 'progress' | 'program-complete'>('session')
  const [introDone, setIntroDone] = useState(false)
  if (mode === 'intro' && !introDone) return <IntroSession materialTitle="Bohr.pdf" materialText="Bohr propuso niveles discretos de energía para explicar el espectro atómico." topicsFound={['Energía cuantizada']} isReady={true} onReady={() => setIntroDone(true)} />
  if (mode === 'contracts') {
    const rapid = params.get('type') || 'open_response'
    const interaction = { interactionType: rapid, prompt: params.get('prompt') || 'Completa el nivel', data: rapid === 'fill_blank' ? { bank: ['uno', 'dos'], correctAnswers: ['uno'] } : {} }
    let normalized = interaction
    let error = ''
    try { normalized = normalizeInteractionForPreference(interaction, 'quick_test') as typeof interaction } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    const errors = error ? [error] : validateInteractionContract(normalized, 'quick_test')
    const leaks = validateNoAnswerLeak({ ...interaction, data: { ...interaction.data, correctAnswer: params.get('answer') || undefined } })
    return <main data-testid="contract-result" data-type={normalized.interactionType} data-valid={String(errors.length === 0)} data-leak={String(leaks.length > 0)}>{errors.join('|') || 'valid'}</main>
  }
  if (mode === 'numeric') {
    const result = evaluateNumericShort({ data: { correctAnswer: '-3.4 eV', answerField: 'energy', tolerance: 1e-6 } }, params.get('answer') || '')
    return <main data-testid="numeric-result" data-outcome={result.outcome} data-semantic-outcome={result.semanticOutcome}>{result.whatWasCorrect}{result.whatWasMissing}</main>
  }
  if (destination === 'program-complete') return <main data-testid="program-complete"><h1>Programa completado</h1></main>
  if (destination !== 'session' || introDone) return <main data-testid="canonical-book"><h1>Libro canónico de Bohr</h1><button onClick={() => setDestination('session')}>Volver a estudiar</button><button onClick={() => setDestination('session')}>Ver mi programa</button></main>
  return <StudyALSessionV3
    session={{ ...session, evaluationPreference: evalPreference }}
    materialContent="Bohr propuso niveles de energía cuantizados. La energía del estado base es -13.6 eV."
    masteryContext={{ userId: 'e2e-user', materialId: 'e2e-material', setup: { evalPreference, sessionLength: 'short' }, userProfile: { userId: 'e2e-user' }, material: { id: 'e2e-material', nombre: 'Bohr' } }}
    onClose={() => setDestination('book')}
    onSessionComplete={(result) => setDestination(result.isProgramComplete === true ? 'program-complete' : 'progress')}
  />
}
