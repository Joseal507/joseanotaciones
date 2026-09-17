import assert from "node:assert/strict"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

;(globalThis as unknown as { React: typeof React }).React = React

import { renderMessageContent } from "../../components/materias/ALAIStudyALChat"
import { extractGraphSpec } from "../../lib/adaptive/visual/engines/graphEngine"
import { detectChatIntent } from "../../lib/alai-chat/intent"
import { resolveConversation, type ChatConversationContext } from "../../lib/alai-chat/conversation"
import { VisualRenderer } from "../../components/visual/VisualRenderer"
import type { VisualSpec } from "../../lib/adaptive/visual/visualContract"

function html(node: React.ReactNode): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, node))
}

// ---------------------------------------------------------------------------
// TEST 1: LaTeX expressions in chat turn 1 render properly without raw syntax
// ---------------------------------------------------------------------------
function testTurn1FormulaRendering() {
  const turn1Answer = [
    "Para resolver la ecuación cuadrática \\(2x^2 - 8x + 6 = 0\\), procedemos paso a paso:",
    "",
    "1. Simplificamos dividiendo entre 2: \\(\\frac{2x^2}{2} - \\frac{8x}{2} + \\frac{6}{2} = 0\\), lo que da \\(x^2 - 4x + 3 = 0\\).",
    "2. Identificamos los coeficientes: \\(a = 1\\), \\(b = -4\\), \\(c = 3\\).",
    "3. Aplicamos la fórmula cuadrática general:",
    "\\[x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\]",
    "4. Sustituimos valores:",
    "\\(x = \\frac{-(-4) \\pm \\sqrt{(-4)^2 - 4(1)(3)}}{2(1)} = \\frac{4 \\pm \\sqrt{16 - 12}}{2} = \\frac{4 \\pm 2}{2}\\)",
    "",
    "Las soluciones finales son **\\(x = 3\\)** y **\\(x = 1\\)**.",
  ].join("\n")

  const markup = html(renderMessageContent(turn1Answer))

  // Must contain KaTeX rendered HTML structures
  assert.ok(markup.includes("katex"), "Chat markup must contain KaTeX elements")
  assert.ok(markup.includes("katex-html"), "Chat markup must contain KaTeX HTML containers")

  // Must NOT leak raw delimiter characters as literal displayed text
  assert.ok(!markup.includes("\\("), "Literal \\( must not leak into markup")
  assert.ok(!markup.includes("\\)"), "Literal \\) must not leak into markup")
  assert.ok(!markup.includes("\\["), "Literal \\[ must not leak into markup")
  assert.ok(!markup.includes("\\]"), "Literal \\] must not leak into markup")

  // Must NOT leak raw LaTeX commands as literal text outside aria-labels
  const textWithoutAria = markup.replace(/aria-label="[^"]*"/g, "")
  assert.ok(!textWithoutAria.includes("\\frac"), "Literal \\frac must not leak outside aria-label")
  assert.ok(!textWithoutAria.includes("\\sqrt"), "Literal \\sqrt must not leak outside aria-label")
  assert.ok(!textWithoutAria.includes("\\pm"), "Literal \\pm must not leak outside aria-label")

  // Must contain the actual math classes
  assert.ok(markup.includes("frac-line") || markup.includes("vlist"), "Fractions must render with visual fraction lines")
  assert.ok(markup.includes("sqrt") || markup.includes("sqrt-sign"), "Square roots must render with visual radical glyphs")

  console.log("PASS 1: Turn 1 LaTeX formulas render via KaTeX with 0 raw delimiter leaks")
}

// ---------------------------------------------------------------------------
// TEST 2: Turn 2 \"ahora grafícala\" continuity and intent resolution
// ---------------------------------------------------------------------------
function testTurn2ContinuityAndIntent() {
  const turn1Message = "Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso."
  const turn1Context = resolveConversation(turn1Message, null)
  assert.equal(turn1Context.intent.shape, "numbered_steps")
  assert.ok(turn1Context.context.subject.includes("2x² - 8x + 6 = 0"))

  const turn2Message = "ahora grafícala"
  const turn2 = resolveConversation(turn2Message, turn1Context.context)
  assert.equal(turn2.intent.shape, "graph", "Shape must be graph")
  assert.equal(turn2.intent.followup, true, "Must recognize followup")
  assert.ok(turn2.context.subject.includes("2x² - 8x + 6 = 0"), "Subject must be preserved from turn 1")

  console.log("PASS 2: Turn 2 \"ahora grafícala\" resolves intent.shape=graph and inherits Turn 1 subject")
}

// ---------------------------------------------------------------------------
// TEST 3: Graph extraction from Turn 2 response & Turn 1 equation with labels
// ---------------------------------------------------------------------------
function testTurn2GraphExtractionAndFeatures() {
  const turn2ModelAnswer = "Para graficar la función cuadrática asociada a 2x² - 8x + 6 = 0, consideramos la parábola y = x^2 - 4x + 3. Abre hacia arriba con vértice en (2, -1), raíces en (1, 0) y (3, 0), y corte en Y en (0, 3)."

  // Should extract directly from the model answer
  const graphFromAnswer = extractGraphSpec(turn2ModelAnswer, [], "alai:turn-2")
  assert.ok(graphFromAnswer, "Must extract graph from Turn 2 answer")
  assert.equal(graphFromAnswer!.data.expression.replace(/\s/g, ""), "x^2-4x+3")

  // Check labeled features
  const labeled = graphFromAnswer!.data.points.filter(p => p.label)
  assert.ok(labeled.length >= 3, "Must have at least 3 labeled features")

  const vertex = labeled.find(p => p.label?.includes("Vértice"))
  assert.ok(vertex, "Must have a labeled vertex")
  assert.equal(vertex!.x, 2)
  assert.equal(vertex!.y, -1)

  const roots = labeled.filter(p => p.label?.includes("Raíz"))
  assert.ok(roots.length >= 2, "Must have 2 labeled roots")
  assert.ok(roots.some(r => r.x === 1 && r.y === 0), "Must include root (1, 0)")
  assert.ok(roots.some(r => r.x === 3 && r.y === 0), "Must include root (3, 0)")

  const yIntercept = labeled.find(p => p.label?.includes("Corte Y"))
  assert.ok(yIntercept, "Must have labeled Y-intercept")
  assert.equal(yIntercept!.x, 0)
  assert.equal(yIntercept!.y, 3)

  // Should also fallback cleanly to subject equation if model answer was prose-only
  const graphFromSubject = extractGraphSpec("Resuelve 2x² - 8x + 6 = 0 paso a paso", [], "alai:turn-subject")
  assert.ok(graphFromSubject, "Must extract graph from equation = 0 in subject")
  assert.equal(graphFromSubject!.data.expression.replace(/\s/g, ""), "2x^2-8x+6")

  console.log("PASS 3: Graph extraction produces graph_2d with vertex (2,-1), roots (1,0) & (3,0), and Y-intercept (0,3)")
}

// ---------------------------------------------------------------------------
// TEST 4: VisualRenderer renders SVG parabola with elements and points
// ---------------------------------------------------------------------------
function testVisualRendererGraphSvg() {
  const graphData = extractGraphSpec("y = x^2 - 4x + 3", [], "alai:test")!
  const spec: VisualSpec = {
    id: "visualspec:test",
    requirementId: "visualreq:test",
    microId: "alai:test",
    representation: "cartesian_graph",
    engine: "graph_2d",
    data: graphData.data,
    sourceGrounding: { sourceSpans: [], factKeys: [] },
    conceptual: false,
    provenance: { kind: "DERIVED", operation: "plot_explicit_function", inputs: ["x^2 - 4x + 3"], reproducible: true },
  }

  const svgMarkup = html(React.createElement(VisualRenderer, { spec, mode: "teach" }))

  assert.ok(svgMarkup.includes("data-testid=\"graph-svg\""), "Must render SVG with data-testid=\"graph-svg\"")
  assert.ok(svgMarkup.includes("<polyline"), "Must render parabola polyline curve")
  assert.ok(svgMarkup.includes("f(x) = x^2 - 4x + 3"), "Must render function equation label")
  assert.ok(svgMarkup.includes("Vértice (2, -1)"), "Must render vertex label in SVG")
  assert.ok(svgMarkup.includes("Raíz (1, 0)"), "Must render root (1,0) label in SVG")
  assert.ok(svgMarkup.includes("Raíz (3, 0)"), "Must render root (3,0) label in SVG")
  assert.ok(svgMarkup.includes("Corte Y (0, 3)"), "Must render Y-intercept label in SVG")

  console.log("PASS 4: VisualRenderer renders interactive SVG with parabola curve and all key point labels")
}

async function main() {
  testTurn1FormulaRendering()
  testTurn2ContinuityAndIntent()
  testTurn2GraphExtractionAndFeatures()
  testVisualRendererGraphSvg()
  console.log("alai-chat-equation-graph-continuity-contracts: ALL PASS")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
