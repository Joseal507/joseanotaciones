import {expect,test} from '@playwright/test'

test('showcase visual único: primitives reales, interacción, grading servidor y móvil',async({page})=>{
 await page.goto('/e2e-visual-showcase');await expect(page.getByRole('heading',{name:'Visual Pedagogy Showcase'})).toBeVisible()
 for(const engine of ['graph_2d','geometry_canvas','structured_grid','chemistry_2d','structure_graph','flow_state','timeline','source_image','code_execution','equation_expression'])await expect(page.locator(`[data-showcase-engine="${engine}"]`)).toBeVisible()
 await expect(page.locator('[data-layout-kind="definition"]')).toBeVisible();await expect(page.locator('[data-layout-kind="numbered_steps"]')).toBeVisible();await expect(page.locator('[data-layout-kind="warning"]')).toBeVisible()
 await page.locator('[data-showcase-engine="graph_2d"] [role="button"]').first().click();await expect(page.locator('[data-grade="graph"]')).toHaveText('correct')
 await page.locator('[data-showcase-engine="geometry_canvas"] [data-geometry-point="A"]').click();await expect(page.locator('[data-grade="geometry"]')).toHaveText('correct')
 await page.locator('[data-showcase-engine="source_image"] button[aria-label="Entrada"]').click();await expect(page.locator('[data-grade="source"]')).toHaveText('correct')
 await page.locator('[data-showcase-engine="flow_state"] svg g').nth(1).click();await expect(page.locator('[data-grade="flow"]')).toBeVisible()
 await page.getByRole('button',{name:'Ampliar'}).click();await page.getByRole('button',{name:'Anotaciones'}).click();await page.getByRole('button',{name:'Anotaciones'}).click()
 await page.setViewportSize({width:390,height:844});for(const engine of ['graph_2d','geometry_canvas','structured_grid','structure_graph','flow_state','timeline','source_image','code_execution']){const box=await page.locator(`[data-showcase-engine="${engine}"]`).boundingBox();expect(box?.width).toBeLessThanOrEqual(390)}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBeTruthy()
 await page.reload();await expect(page.locator('[data-showcase-engine="source_image"]')).toBeVisible()
})
