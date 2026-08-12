import { expect, test } from '@playwright/test'

test('chapter-style text-only: prefetch+cold exactly-once, refresh en preparación, truncado x2 grounded y quick_test',async({page,request})=>{
  const sessionId='e2e-truncated-prefetch-dcl',temaId='e2e-truncated-prefetch-dcl-tema'
  const sessionTeachCalls:Array<{chapter:number;origin:string}>=[],payloads:any[]=[]
  await page.route('**/api/study-sessions**',route=>route.request().method()==='GET'?route.fulfill({json:{success:true,sessions:[]}}):route.fulfill({json:{success:true}}))
  await page.route('**/api/adaptive/session-teach',async route=>{
    const body=route.request().postDataJSON();sessionTeachCalls.push({chapter:body.session.chapterNumber,origin:body.requestOrigin||'cold'})
    const response=await request.post('/api/e2e-session-reliability',{data:body});const json=await response.json();payloads.push(json);await route.fulfill({json})
  })
  await page.route('**/api/adaptive/session-check',route=>route.fulfill({json:{success:true,result:{outcome:'correct',correct:true,score:100,feedback:'Correcto',errorType:null}}}))
  await page.addInitScript(({sessionId,temaId})=>{
    const marker=`e2e-fixture:${sessionId}`;if(localStorage.getItem(marker))return;localStorage.setItem(marker,'1')
    const chapters=[
      {id:'chapter-1',title:'Introducción',objective:'Orientar',chapterNumber:1,kind:'introduction',status:'available',blockIds:[]},
      {id:'chapter-2',title:'Diagrama de cuerpo libre',objective:'Interpretar fuerzas',chapterNumber:2,kind:'learning',status:'available',blockIds:['dcl']},
      {id:'chapter-3',title:'Componentes del movimiento',objective:'Relacionar componentes',chapterNumber:3,kind:'learning',status:'available',blockIds:['projectile']},
    ]
    const dclText='Sobre el bloque actúan Peso = 49 N a 270°, Normal = 49 N a 90°, Fuerza aplicada = 30 N a 30° y Fricción = 8 N a 180°. Fx ≈ 25.98 N y Fy = 15 N.'
    const blocks=[
      {id:'dcl',label:'Diagrama de cuerpo libre',summary:dclText,sourceQuote:dclText,kind:'formula',importance:100,sourceSpans:[{page:1,quote:dclText}]},
      {id:'projectile',label:'Componentes del movimiento',summary:'La posición horizontal y vertical se determinan a partir de componentes grounded del movimiento.',sourceQuote:'La posición horizontal y vertical se determinan a partir de componentes grounded del movimiento.',kind:'concept',importance:100,sourceSpans:[{page:2,quote:'La posición horizontal y vertical se determinan a partir de componentes grounded del movimiento.'}]},
    ]
    const intro={sessionId:'chapter-1',sessionTitle:'Introducción',sessionNumber:1,sessionKind:'introduction',materialType:'pdf',sessionIntro:'Inicio',steps:[{id:'intro',type:'intro',title:'Mapa',content:'Recorrido grounded.',keyPoints:[],importance:'supporting',relatedBlockIds:[]}],sessionClosing:'Cierre',totalSteps:1,evaluationBlocks:[],evaluationProgress:{},recoveryQueue:[]}
    const session={id:sessionId,temaId,enfoque:'teorico',processMode:'adaptive',studyMode:'adaptive',materialIds:['stress-material'],primaryMaterialId:'stress-material',materialNames:['StudyAL Universal Visual Teach Stress Test'],adaptiveSetup:{knowledgeLevel:'never_seen',examDateType:'tomorrow',targetScore:80,evalPreference:'quick_test',planView:'book',completedAt:1},blueprint:{version:1,blocks,topics:[]},journey:{id:'stress-plan',version:1,chapters,totalChapters:3},currentSessionNumber:1,currentStep:0,completedSessionNumbers:[],status:'in_progress',adaptiveState:'studying',isProgramComplete:false,unresolvedMicroIds:[],sessionContent:{'1':intro},recoveryQueues:{},createdAt:1,lastOpenedAt:1}
    localStorage.setItem('studyal_sessions_v4',JSON.stringify({[sessionId]:{...session,blueprint:undefined,journey:undefined,sessionContent:undefined}}))
    localStorage.setItem('studyal_adaptive_artifacts_v1',JSON.stringify({[sessionId]:{blueprint:session.blueprint,journey:session.journey,sessionContent:session.sessionContent}}))
  },{sessionId,temaId})

  await page.goto(`/materias/${temaId}/sesion/1?adaptiveSessionId=${sessionId}`)
  await expect.poll(()=>sessionTeachCalls.some(call=>call.chapter===2&&call.origin==='prefetch')).toBe(true)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await page.waitForTimeout(100)
  await page.reload()
  await expect(page.getByRole('heading',{level:1,name:/Diagrama de cuerpo libre|Sesión 2/})).toBeVisible({timeout:15_000})
  const chapter2Payloads=payloads.filter(item=>item.classContent?.sessionNumber===2)
  expect(new Set(chapter2Payloads.map(item=>JSON.stringify(item.classContent.steps))).size).toBe(1)
  expect(chapter2Payloads.at(-1)._e2e.logicalPreparationCalls).toBe(1)
  await expect.poll(()=>page.evaluate(({sessionId})=>Boolean(JSON.parse(localStorage.getItem('studyal_adaptive_artifacts_v1')||'{}')[sessionId]?.sessionContent?.['2']),{sessionId})).toBe(true)

  await expect.poll(()=>sessionTeachCalls.some(call=>call.chapter===3&&call.origin==='prefetch')).toBe(true)
  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByRole('heading',{level:1,name:/Componentes del movimiento|Sesión 3/})).toBeVisible({timeout:15_000})
  await expect(page.getByText(/No pudimos preparar esta sesión/)).toHaveCount(0)
  const chapter3=payloads.find(item=>item.classContent?.sessionNumber===3)
  expect(chapter3._e2e).toMatchObject({providerAttempts:2,usedGroundedFallback:true,logicalPreparationCalls:1})
  expect(chapter3.classContent.steps.every((step:any)=>step.content.includes('grounded'))).toBe(true)
  for(const payload of payloads)for(const block of payload.classContent?.evaluationBlocks||[])for(const question of block.questions||[])expect(['numeric_problem','short_response']).not.toContain(question.format)
  expect(await page.locator('input[type="text"], textarea, input[type="number"]').count()).toBe(0)
  expect(await page.locator('[data-testid="graph-svg"], [data-testid="structured-grid"], [data-testid="spatial-vector-system"], [data-testid="chemistry-structure"], [data-testid="timeline-track"]').count()).toBe(0)
  const persisted=await page.evaluate(({sessionId})=>JSON.parse(localStorage.getItem('studyal_adaptive_artifacts_v1')||'{}')[sessionId],{sessionId})
  expect(Object.keys(persisted.sessionContent)).toEqual(expect.arrayContaining(['1','2','3']))
  expect(persisted.sessionContent['3'].assessmentBlueprint?.objectives?.some((objective:any)=>objective.mastered)).not.toBe(true)
  await page.reload();await expect(page.getByRole('heading',{level:1,name:/Componentes del movimiento|Sesión 3/})).toBeVisible();expect(payloads.filter(item=>item.classContent?.sessionNumber===3).at(-1)._e2e.logicalPreparationCalls).toBe(1)
})
