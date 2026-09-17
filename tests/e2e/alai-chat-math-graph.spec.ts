import assert from "node:assert/strict";
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from "@playwright/test";
import { extractGraphSpec } from "../../lib/adaptive/visual/engines/graphEngine";
import type { VisualSpec } from "../../lib/adaptive/visual/visualContract";
import { resolveConversation, readConversationContext } from "../../lib/alai-chat/conversation";

const ARTIFACT_DIR = '/tmp/studyal-alai-math-graph-artifacts';
mkdirSync(ARTIFACT_DIR, { recursive: true });

async function installRoutes(page: Page) {
  let calls = 0;
  await page.route("**/api/study-sessions**", async route => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, sessions: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });

  await page.route("**/api/enfoques/teorico/start", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        sourceSelectionFingerprint: request.sourceSelection.fingerprint,
        totalChars: 70,
        materials: {
          "e2e-free-a": { materialId: "e2e-free-a", selectedPages: [2, 5], text: "[Pagina 2]\nAUTHORIZED_ALPHA", nombre: "Material A", kind: "pdf", chars: 34 },
        },
      }),
    });
  });

  await page.route("**/api/materials/*/download-url", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));

  await page.route("**/api/alai-studyal-chat", async route => {
    calls += 1;
    const req = route.request().postDataJSON();
    const msg = String(req.message || req.mensaje || "");
    const isGraph = /graf[ií]c/i.test(msg);

    // Check which turn
    if (msg.includes("Resuelve 2x²")) {
      // Turn 1: Formula solution
      const answer = [
        "Para resolver la ecuación cuadrática \\(2x^2 - 8x + 6 = 0\\), procedemos paso a paso:",
        "",
        "1. Simplificamos dividiendo entre 2: \\(\\frac{2x^2}{2} - \\frac{8x}{2} + \\frac{6}{2} = 0\\), lo que da \\(x^2 - 4x + 3 = 0\\).",
        "2. Aplicamos la fórmula cuadrática general: \\[x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\]",
        "3. Sustituyendo valores: \\(x = \\frac{4 \\pm \\sqrt{16 - 12}}{2} = \\frac{4 \\pm 2}{2}\\).",
        "",
        "Las soluciones finales son **\\(x = 3\\)** y **\\(x = 1\\)**.",
      ].join("\n");

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer,
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourceMaterialName: "",
          sourcePages: [],
          suggestedFollowups: ["ahora grafícala"],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            version: 1,
            subject: "Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.",
            operation: "numbered_steps",
            sourcePolicy: "GENERAL_ONLY",
            usedTargetIds: [],
            usedRelationIds: [],
            activeProblem: "2x² - 8x + 6 = 0",
            workingMemory: "Problema activo: 2x² - 8x + 6 = 0 | Elementos: x² - 4x + 3 = 0; x = 1; x = 3",
          },
          fulfillment: "answered",
        }),
      });
    }

    if (/graf[ií]c/i.test(msg)) {
      // Turn 2: Graphing request with text_only fulfillment (tests client-side fallback derivation!)
      const answer = "Para graficar la función cuadrática asociada a 2x² - 8x + 6 = 0, consideramos la parábola y = x^2 - 4x + 3. Abre hacia arriba con vértice en (2, -1), raíces en (1, 0) y (3, 0), y corte en Y en (0, 3).";

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer,
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourceMaterialName: "",
          sourcePages: [],
          suggestedFollowups: ["que es la b?"],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            version: 1,
            subject: "Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.",
            operation: "graph",
            sourcePolicy: "GENERAL_ONLY",
            usedTargetIds: [],
            usedRelationIds: [],
            activeProblem: "2x² - 8x + 6 = 0",
            workingMemory: "Problema activo: 2x² - 8x + 6 = 0 | Elementos: y = x² - 4x + 3; a = 1; b = -4; c = 3; Vértice (2,-1)",
          },
          // Simulate historical turn without visualSpec and fulfillment: 'text_only'
          fulfillment: "text_only",
        }),
      });
    }

    if (/que es la b/i.test(msg)) {
      // Turn 3: "que es la b?" - verified conversational memory resolution
      assert.ok(req.conversationContext?.activeProblem?.includes("2x² - 8x + 6 = 0"), "Context must retain activeProblem");
      const answer = "En la ecuación cuadrática \\(ax^2 + bx + c = 0\\) y en la parábola \\(y = x^2 - 4x + 3\\), **b** representa el **coeficiente del término lineal** (el término con \\(x\\)).\n\nEn tu ecuación simplificada \\(x^2 - 4x + 3 = 0\\), tenemos \\(b = -4\\) (o \\(b = -8\\) en la ecuación original \\(2x^2 - 8x + 6 = 0\\)). Este valor determina la posición del eje de simetría y del vértice mediante la fórmula \\(x_v = -\\frac{b}{2a}\\).";

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer,
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourceMaterialName: "",
          sourcePages: [],
          suggestedFollowups: ["y la c?", "por que es negativa?"],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            version: 1,
            subject: "Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.",
            operation: "prose",
            sourcePolicy: "GENERAL_ONLY",
            usedTargetIds: [],
            usedRelationIds: [],
            activeProblem: "2x² - 8x + 6 = 0",
            workingMemory: "Problema activo: 2x² - 8x + 6 = 0 | Elementos: y = x² - 4x + 3; a = 1; b = -4 (coeficiente lineal); c = 3",
          },
          fulfillment: "answered",
        }),
      });
    }

    // Turn 4: Topic switch to WWI
    const answer = "La Primera Guerra Mundial (1914–1918) fue causada por una combinación de factores estructurales y un detonante inmediato:\n\n1. **Detonante:** El asesinato del archiduque Francisco Fernando de Austria en Sarajevo el 28 de junio de 1914.\n2. **Sistema de alianzas:** La Triple Entente y la Triple Alianza convirtieron un conflicto regional en una guerra a escala global.\n3. **Imperialismo y militarismo:** La competencia colonial y la carrera armamentista entre las potencias europeas.\n4. **Nacionalismo:** Fuertes tensiones en los Balcanes (\"el polvorín de Europa\").";

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        answer,
        mode: "GENERAL_ONLY",
        inMaterial: false,
        confidence: "media",
        sourceMaterial: "",
        sourceMaterialName: "",
        sourcePages: [],
        suggestedFollowups: [],
        provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
        conversationContext: {
          version: 1,
          subject: "¿Qué causó la Primera Guerra Mundial?",
          operation: "prose",
          sourcePolicy: "GENERAL_ONLY",
          usedTargetIds: [],
          usedRelationIds: [],
        },
        fulfillment: "answered",
      }),
    });
  });

  return () => calls;
}

test("ALAI multi-turn continuity: LaTeX math, client graph recovery, conversational memory ('que es la b?'), and topic switch isolation", async ({ page }) => {
  await installRoutes(page);
  await page.goto("/e2e-free-continuity?tool=alai");

  // --- Turn 1: Formula resolution ---
  const input = page.getByPlaceholder(/Escribe tu pregunta aquí/i);
  await input.fill("Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.");
  await page.getByRole("button", { name: "Enviar" }).click();

  // Target the specific AI response bubble for Turn 1
  const turn1Bubble = page.locator(".aal-bubble.alai").filter({ hasText: "Para resolver la ecuación cuadrática" });
  await expect(turn1Bubble).toBeVisible();

  // Verify KaTeX rendered math is present
  await expect(turn1Bubble.locator(".katex").first()).toBeVisible();
  await expect(turn1Bubble.locator(".katex-html").first()).toBeVisible();
  await expect(turn1Bubble.locator('[role="math"]').first()).toBeVisible();

  // Verify no raw LaTeX delimiters or commands leak into plain text
  const bubbleText = await turn1Bubble.innerText();
  expect(bubbleText).not.toContain("\\(");
  expect(bubbleText).not.toContain("\\)");
  expect(bubbleText).not.toContain("\\[");
  expect(bubbleText).not.toContain("\\]");
  expect(bubbleText).not.toContain("\\frac");
  expect(bubbleText).not.toContain("\\sqrt");
  expect(bubbleText).not.toContain("\\pm");

  // Screenshot of Turn 1 rendered formula
  const formulaScreenshotPath = `${ARTIFACT_DIR}/rendered_formula.png`;
  await turn1Bubble.screenshot({ path: formulaScreenshotPath });
  console.log("Saved Turn 1 formula screenshot:", formulaScreenshotPath);

  // --- Turn 2: Parabola graph (client-side fallback derivation) ---
  const chip = page.getByRole("button", { name: "ahora grafícala" });
  if (await chip.isVisible()) {
    await chip.click();
  } else {
    await input.fill("ahora grafícala");
    await page.getByRole("button", { name: "Enviar" }).click();
  }

  // Target the specific AI response bubble for Turn 2
  const turn2Bubble = page.locator(".aal-bubble.alai").filter({ hasText: "Para graficar la función cuadrática" });
  await expect(turn2Bubble).toBeVisible();

  // Verify graph SVG is rendered despite server returning fulfillment: 'text_only' and no visualSpec!
  const graphSvg = turn2Bubble.locator("svg[data-testid=\"graph-svg\"]");
  await expect(graphSvg).toBeVisible();

  // Verify parabola polyline curve is rendered
  const polyline = graphSvg.locator("polyline");
  await expect(polyline).toBeVisible();

  // Verify key feature text labels in SVG
  await expect(graphSvg.locator("text", { hasText: "Vértice (2, -1)" })).toBeVisible();
  await expect(graphSvg.locator("text", { hasText: "Raíz (1, 0)" })).toBeVisible();
  await expect(graphSvg.locator("text", { hasText: "Raíz (3, 0)" })).toBeVisible();
  await expect(graphSvg.locator("text", { hasText: "Corte Y (0, 3)" })).toBeVisible();

  // Verify fallback error message is NOT present
  await expect(turn2Bubble.getByText("esta función no tiene una gráfica disponible")).toHaveCount(0);

  // Screenshot of visible parabola graph
  const graphScreenshotPath = `${ARTIFACT_DIR}/rendered_parabola.png`;
  await graphSvg.screenshot({ path: graphScreenshotPath });
  console.log("Saved Turn 2 parabola screenshot:", graphScreenshotPath);

  // --- Turn 3: Conversational follow-up "que es la b?" ---
  const followupChip = page.getByRole("button", { name: "que es la b?" });
  if (await followupChip.isVisible()) {
    await followupChip.click();
  } else {
    await input.fill("que es la b?");
    await page.getByRole("button", { name: "Enviar" }).click();
  }

  // Target Turn 3 bubble
  const turn3Bubble = page.locator(".aal-bubble.alai").filter({ hasText: "coeficiente del término lineal" });
  await expect(turn3Bubble).toBeVisible();

  // Verify ALAI correctly interpreted b as the quadratic coefficient, NOT the alphabet letter
  const turn3Text = await turn3Bubble.innerText();
  expect(turn3Text).toContain("coeficiente del término lineal");
  expect(turn3Text).toMatch(/b\s*=\s*[-−]4/);
  expect(turn3Text).not.toContain("alfabeto latino");
  expect(turn3Text).not.toContain("segunda letra");
  // Turn 3 is a prose question, so it should not render a graph SVG
  await expect(turn3Bubble.locator("svg[data-testid=\"graph-svg\"]")).toHaveCount(0);

  // Screenshot of Turn 3 conversational answer
  const memoryScreenshotPath = `${ARTIFACT_DIR}/conversational_memory_answer.png`;
  await turn3Bubble.screenshot({ path: memoryScreenshotPath });
  console.log("Saved Turn 3 conversational memory screenshot:", memoryScreenshotPath);

  // --- Turn 4: Topic switch "¿Qué causó la Primera Guerra Mundial?" ---
  await input.fill("¿Qué causó la Primera Guerra Mundial?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const turn4Bubble = page.locator(".aal-bubble.alai").filter({ hasText: "Primera Guerra Mundial (1914–1918)" });
  await expect(turn4Bubble).toBeVisible();

  const turn4Text = await turn4Bubble.innerText();
  expect(turn4Text).toContain("Francisco Fernando");
  expect(turn4Text).toContain("Triple Entente");
  // Clean isolation: no quadratic contamination
  expect(turn4Text).not.toContain("parábola");
  expect(turn4Text).not.toContain("2x²");
  expect(turn4Text).not.toContain("vértice");
});

test("ALAI dynamic conversational memory and clean topic switches across distinct runs", async ({ page }) => {
  let serverWorkingMemory = "";
  let currentActiveProblem = "";

  await page.route("**/api/study-sessions**", async route => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, sessions: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });

  await page.route("**/api/enfoques/teorico/start", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        sourceSelectionFingerprint: request.sourceSelection.fingerprint,
        totalChars: 70,
        materials: {
          "e2e-free-a": { materialId: "e2e-free-a", selectedPages: [2, 5], text: "[Pagina 2]\nAUTHORIZED_ALPHA", nombre: "Material A", kind: "pdf", chars: 34 },
        },
      }),
    });
  });

  await page.route("**/api/materials/*/download-url", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));

  await page.route("**/api/alai-studyal-chat", async route => {
    const req = route.request().postDataJSON();
    const msg = String(req.message || req.mensaje || "");
    const previousContext = readConversationContext(req.conversationContext);
    const resolved = resolveConversation(msg, previousContext);

    // Dynamic resolution based on message & state
    if (msg.includes("x² - 10x + 21 = 0")) {
      assert.equal(resolved.intent.followup, false);
      currentActiveProblem = "x² - 10x + 21 = 0";
      serverWorkingMemory = "Problema activo: x² - 10x + 21 = 0 | Elementos: a = 1; b = -10; c = 21";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer: "Para resolver la ecuación \\(x^2 - 10x + 21 = 0\\), identificamos \\(a = 1\\), \\(b = -10\\) y \\(c = 21\\). Factorizando: \\((x - 3)(x - 7) = 0\\), por lo que las raíces son \\(x = 3\\) y \\(x = 7\\).",
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourcePages: [],
          suggestedFollowups: ["cuál era la b ahí?"],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            version: 1,
            subject: msg,
            operation: "worked_solution",
            sourcePolicy: "GENERAL_ONLY",
            usedTargetIds: [],
            usedRelationIds: [],
            activeProblem: currentActiveProblem,
            workingMemory: serverWorkingMemory,
          },
          fulfillment: "answered",
        }),
      });
    }

    if (msg.includes("x² + 7x + 12 = 0")) {
      assert.equal(resolved.intent.followup, false);
      currentActiveProblem = "x² + 7x + 12 = 0";
      serverWorkingMemory = "Problema activo: x² + 7x + 12 = 0 | Elementos: a = 1; b = 7; c = 12";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer: "Para resolver la ecuación \\(x^2 + 7x + 12 = 0\\), identificamos \\(a = 1\\), \\(b = 7\\) y \\(c = 12\\). Factorizando: \\((x + 3)(x + 4) = 0\\), por lo que las raíces son \\(x = -3\\) y \\(x = -4\\).",
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourcePages: [],
          suggestedFollowups: ["cuál era la b ahí?"],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            version: 1,
            subject: msg,
            operation: "worked_solution",
            sourcePolicy: "GENERAL_ONLY",
            usedTargetIds: [],
            usedRelationIds: [],
            activeProblem: currentActiveProblem,
            workingMemory: serverWorkingMemory,
          },
          fulfillment: "answered",
        }),
      });
    }

    if (/cu[aá]l era la b ah[ií]/i.test(msg)) {
      // Must be classified as follow-up
      assert.equal(resolved.intent.followup, true, "'cuál era la b ahí?' MUST be recognized as follow-up");
      assert.equal(resolved.context.activeProblem, currentActiveProblem, "activeProblem must be preserved");

      const isRunA = currentActiveProblem.includes("- 10x");
      const bValue = isRunA ? "-10" : "7";
      const bAnswer = isRunA
        ? "En la ecuación \\(x^2 - 10x + 21 = 0\\), el coeficiente lineal es **\\(b = -10\\)**. Determina el eje de simetría en \\(x = 5\\)."
        : "En la ecuación \\(x^2 + 7x + 12 = 0\\), el coeficiente lineal es **\\(b = 7\\)**. Determina el eje de simetría en \\(x = -3.5\\).";

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer: bAnswer,
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourcePages: [],
          suggestedFollowups: ["y la c?"],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            ...resolved.context,
            workingMemory: `${serverWorkingMemory} | b confirmado: ${bValue}`,
          },
          fulfillment: "answered",
        }),
      });
    }

    if (/y la c/i.test(msg)) {
      assert.equal(resolved.intent.followup, true, "'y la c?' MUST be recognized as follow-up");
      const isRunA = currentActiveProblem.includes("- 10x");
      const cValue = isRunA ? "21" : "12";
      const cAnswer = `El término independiente es **\\(c = ${cValue}\\)**. Corresponde al corte con el eje Y.`;

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer: cAnswer,
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourcePages: [],
          suggestedFollowups: [],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            ...resolved.context,
            workingMemory: `${serverWorkingMemory} | c confirmado: ${cValue}`,
          },
          fulfillment: "answered",
        }),
      });
    }

    if (/Napole[oó]n/i.test(msg)) {
      assert.equal(resolved.intent.followup, false, "Topic switch to Napoleon MUST NOT be follow-up");
      assert.equal(resolved.context.workingMemory, undefined, "Working memory must be CLEARED on topic switch");

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          answer: "Napoleón Bonaparte (1769–1821) fue un estratega y gobernante militar francés que dominó la historia europea durante más de una década liderando las Guerras Napoleónicas.",
          mode: "GENERAL_ONLY",
          inMaterial: false,
          confidence: "media",
          sourceMaterial: "",
          sourcePages: [],
          suggestedFollowups: [],
          provenance: { sourceMode: "GENERAL_ONLY", externalKnowledgeUsed: true, materialEvidenceUsed: false },
          conversationContext: {
            version: 1,
            subject: msg,
            operation: "prose",
            sourcePolicy: "GENERAL_ONLY",
            usedTargetIds: [],
            usedRelationIds: [],
          },
          fulfillment: "answered",
        }),
      });
    }

    throw new Error(`Unexpected message in test: ${msg}`);
  });

  await page.goto("/e2e-free-continuity?tool=alai");
  const input = page.getByPlaceholder(/Escribe tu pregunta aquí/i);

  // === RUN A: x² - 10x + 21 = 0 ===
  await input.fill("Resuelve x² - 10x + 21 = 0 y dime a, b y c.");
  await page.getByRole("button", { name: "Enviar" }).click();

  const runABubble1 = page.locator(".aal-bubble.alai").filter({ hasText: "Para resolver la ecuación" }).last();
  await expect(runABubble1).toBeVisible();

  // Ask "cuál era la b ahí?"
  await input.fill("cuál era la b ahí?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const runABubble2 = page.locator(".aal-bubble.alai").filter({ hasText: "el coeficiente lineal es" }).last();
  await expect(runABubble2).toBeVisible();
  const runABubble2Text = await runABubble2.innerText();
  expect(runABubble2Text).toMatch(/b\s*=\s*[-−]10/);
  expect(runABubble2Text).not.toContain("alfabeto");
  expect(runABubble2Text).not.toContain("más contexto");

  // Ask "y la c?"
  await input.fill("y la c?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const runABubble3 = page.locator(".aal-bubble.alai").filter({ hasText: "término independiente es" }).last();
  await expect(runABubble3).toBeVisible();
  const runABubble3Text = await runABubble3.innerText();
  expect(runABubble3Text).toMatch(/c\s*=\s*21/);

  // Topic switch to Napoleon
  await input.fill("¿Quién fue Napoleón Bonaparte?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const runABubble4 = page.locator(".aal-bubble.alai").filter({ hasText: "Napoleón Bonaparte (1769–1821)" }).last();
  await expect(runABubble4).toBeVisible();
  const runABubble4Text = await runABubble4.innerText();
  expect(runABubble4Text).toContain("Guerras Napoleónicas");
  expect(runABubble4Text).not.toContain("x²");
  expect(runABubble4Text).not.toContain("coeficiente");

  // === RUN B: Clear session and test with x² + 7x + 12 = 0 ===
  await page.evaluate(() => localStorage.clear());
  await page.goto("/e2e-free-continuity?tool=alai");
  const inputB = page.getByPlaceholder(/Escribe tu pregunta aquí/i);

  await inputB.fill("Resuelve x² + 7x + 12 = 0 y dime a, b y c.");
  await page.getByRole("button", { name: "Enviar" }).click();

  const runBBubble1 = page.locator(".aal-bubble.alai").filter({ hasText: "Para resolver la ecuación" }).last();
  await expect(runBBubble1).toBeVisible();

  // Ask "cuál era la b ahí?" in Run B
  await inputB.fill("cuál era la b ahí?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const runBBubble2 = page.locator(".aal-bubble.alai").filter({ hasText: "el coeficiente lineal es" }).last();
  await expect(runBBubble2).toBeVisible();
  const runBBubble2Text = await runBBubble2.innerText();
  // In Run B, b MUST be 7, NOT -10!
  expect(runBBubble2Text).toMatch(/b\s*=\s*7/);
  expect(runBBubble2Text).not.toContain("-10");

  // Ask "y la c?" in Run B
  await inputB.fill("y la c?");
  await page.getByRole("button", { name: "Enviar" }).click();

  const runBBubble3 = page.locator(".aal-bubble.alai").filter({ hasText: "término independiente es" }).last();
  await expect(runBBubble3).toBeVisible();
  const runBBubble3Text = await runBBubble3.innerText();
  // In Run B, c MUST be 12, NOT 21!
  expect(runBBubble3Text).toMatch(/c\s*=\s*12/);
  expect(runBBubble3Text).not.toContain("21");
});
