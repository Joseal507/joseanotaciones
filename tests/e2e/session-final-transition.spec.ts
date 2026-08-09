import { expect, test } from '@playwright/test'
import { buildAssessmentBlueprint, recordAssessmentEvidence } from '../../lib/adaptive/evaluation/assessmentBlueprint'

test('Falcons finish session completion persists once without repeating step 12',async({page})=>{
  const sessionId='e2e-falcons-final-transition';const temaId='e2e-falcons-final-tema'
  const steps=Array.from({length:12},(_,index)=>({id:`step_${index+1}`,type:'concept',title:index===11?'Argumentos para ser el Mejor Equipo':`Paso Falcons ${index+1}`,content:`Contenido Falcons del paso ${index+1}.`,keyPoint:`Punto ${index+1}`,keyPoints:[`Punto ${index+1}`],importance:'important' as const,relatedBlockIds:[`f${index+1}`]}))
  let assessment=buildAssessmentBlueprint(steps.map(step=>({...step,importance:0.7})),sessionId,3)
  for(const objective of assessment.objectives.slice(0,-1))assessment=recordAssessmentEvidence(assessment,[objective.objectiveId],{valid:true,correct:true,independent:true,evidenceId:`prior:${objective.objectiveId}`})
  const finalObjective=assessment.objectives.at(-1)!.objectiveId
  const question={id:'falcons-final-question',conceptId:'step_12',conceptLabel:'Argumentos finales',teachingBlockId:'step_12',questionFamily:'final_argument',variant:'true_false_factual',difficulty:'easy',targetDimension:'recognition',format:'true_false',questionText:'La afición y los jugadores icónicos forman parte del argumento final.',options:null,correctAnswer:true,explanation:'Coincide con el material.',hint:'Recuerda el argumento.',estimatedSeconds:15,evidencesNeeded:1,factKey:'step_12:fact:1',factKeys:['step_12:fact:1'],targetObjectiveIds:[finalObjective],evidenceProduced:[finalObjective],coveredStepIds:['step_12'],coveredKeyPoints:['Punto 12']}
  const content={sessionId:'chapter_2',sessionTitle:'Falcons — cierre real',sessionNumber:2,sessionKind:'learning',materialType:'general',sessionIntro:'Falcons',steps,sessionClosing:'Cierre Falcons.',totalSteps:12,assessmentBlueprint:assessment,evaluationBlocks:[{id:'final-block',afterStepId:'step_12',coveredStepIds:['step_12'],coveredKeyPoints:['Punto 12'],questions:[question]}],evaluationProgress:{},recoveryQueue:[]}
  await page.route('**/api/study-sessions**',route=>route.request().method()==='GET'?route.fulfill({json:{success:true,sessions:[]}}):route.fulfill({json:{success:true}}))
  await page.route('**/api/adaptive/session-check',route=>route.fulfill({json:{success:true,result:{outcome:'correct',correct:true,score:100,feedback:'Respuesta correcta.'}}}))
  await page.addInitScript(({sessionId,temaId,content})=>{
    const journey={id:'journey_mshoqk7j',version:4,chapters:[{id:'chapter_2',chapterNumber:2,kind:'learning',status:'available',blockIds:['f12'],unitIds:['u12'],arcRole:'mechanism'}],totalChapters:1}
    const session={id:sessionId,temaId,enfoque:'teorico',processMode:'adaptive',studyMode:'adaptive',materialIds:['mat_1786030926099qn7cx2'],primaryMaterialId:'mat_1786030926099qn7cx2',materialNames:['Falcons'],selectedPages:{},adaptiveSetup:{knowledgeLevel:'never_seen',examDateType:'just_studying',evalPreference:'quick_test',completedAt:1},blueprint:{version:1,blocks:[{id:'f12'}],topics:[]},journey,currentSessionNumber:2,currentStep:11,completedSessionNumbers:[],status:'in_progress',adaptiveState:'studying',isProgramComplete:false,unresolvedMicroIds:[],sessionContent:{'2':content},recoveryQueues:{},createdAt:1,lastOpenedAt:1}
    localStorage.setItem('studyal_sessions_v4',JSON.stringify({[sessionId]:{...session,blueprint:undefined,journey:undefined,sessionContent:undefined}}))
    localStorage.setItem('studyal_adaptive_artifacts_v1',JSON.stringify({[sessionId]:{blueprint:session.blueprint,journey,sessionContent:session.sessionContent}}))
  },{sessionId,temaId,content})
  const events:string[]=[];page.on('console',message=>events.push(message.text()));page.on('pageerror',error=>events.push(error.message))
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 12 de 12')).toBeVisible()
  await expect(page.getByRole('heading',{name:'Argumentos para ser el Mejor Equipo'})).toHaveCount(1)
  await page.getByTestId('session-primary-action').click()
  await page.getByRole('button',{name:'Verdadero'}).click();await page.getByRole('button',{name:'Enviar respuesta'}).click()
  await expect(page.getByTestId('session-feedback-action')).toHaveText('🎉 Terminar')
  await page.getByTestId('session-feedback-action').dblclick()
  await expect(page.getByText('Sesión completada')).toBeVisible()
  await expect(page.getByText('Paso 12 de 12')).toHaveCount(0)
  expect(events.filter(line=>line.includes('session_completion_persisted'))).toHaveLength(1)
  expect(events.some(line=>line.includes('session_action_derived')&&line.includes('"action":"complete_session"')&&line.includes('"currentStepIndex":11'))).toBe(true)
  expect(events.filter(line=>line.includes('session_completion_started'))).toHaveLength(1)
  expect(events.filter(line=>line.includes('session_completion_rendered'))).toHaveLength(1)
  expect(events.some(line=>/RangeError|Maximum call stack size exceeded/.test(line))).toBe(false)
})
