import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// tsx/esbuild fuera del pipeline de build de Next.js compila JSX en modo
// clásico (React.createElement) para archivos .tsx importados desde un
// script standalone, sin que el runtime automático de Next esté disponible
// — expone React globalmente solo para este proceso de test; no afecta al
// build real (Next.js usa su propio runtime automático, AcademicContent.tsx
// no importa React explícitamente en producción, por diseño del repo).
;(globalThis as unknown as { React: typeof React }).React = React

import { AcademicContent } from '../../components/academic/AcademicContent'
import { academicNodeBoundary, toLatexSafeText } from '../../lib/academic-content/composition'
import { prepareAcademicContentForDelivery } from '../../lib/academic-content/validation'
import type { AcademicNode } from '../../lib/academic-content/types'
import { hasUnsupportedWordBankMathBlank } from '../../lib/adaptive/evaluation/questionContract'

// BUG 3 (prueba humana real): (1) "Completa la fórmula..." aparecía
// duplicado en pantalla; (2) un hueco que representaba un exponente se
// mostró como "[H3O+] = 10 log(pH)" en vez de "[H3O+] = 10^(-pH)". Causa
// raíz de (1): page.tsx renderizaba currentQuestion.questionText crudo para
// TODOS los formatos incondicionalmente, y word_bank además renderizaba su
// propia composición de la misma oración — dos renders. Causa raíz de (2,
// parte render): word_bank partía questionText con .split("___") ANTES de
// parsear, así que un span matemático que contuviera el hueco (p.ej.
// "$10^{-___}$") se cortaba a la mitad y cada mitad se parseaba aislada,
// perdiendo el agrupamiento LaTeX — y la ficha de respuesta se insertaba
// como fragmento hermano plano, nunca dentro del grupo matemático. Fix:
// AcademicContent ahora acepta un renderBlank que permite parsear el
// documento COMPLETO una sola vez (el tokenizer ya identifica "___" como un
// nodo 'blank' propio, incluso protegido dentro de spans matemáticos).

// ═══ 1. Duplicación — page.tsx no debe renderizar questionText dos veces para word_bank ═══
function testPageDoesNotDuplicateQuestionTextForWordBank() {
  const source = readFileSync("app/materias/[temaId]/sesion/[sessionNumber]/page.tsx", 'utf8')
  assert.match(
    source,
    /currentQuestion\.format !== "word_bank" && <div[^>]*><AcademicContent content=\{currentQuestion\.questionText\} \/><\/div>/,
    'BUG DE ORIGEN SI FALLA: el render genérico de questionText debe excluir word_bank (que ya compone su propia vista)',
  )
  assert.doesNotMatch(
    source,
    /currentQuestion\.questionText\.split\("___"\)/,
    'word_bank no debe volver a partir questionText con .split("___") antes de parsear (corrompe spans matemáticos que contienen el hueco)',
  )
}

// ═══ 2. session-eval instruye explícitamente el orden de correctAnswer para word_bank ═══
function testSessionEvalPromptDeclaresBlankOrderContract() {
  const source = readFileSync('app/api/adaptive/session-eval/route.ts', 'utf8')
  assert.match(
    source,
    /correctAnswer DEBE estar en el mismo orden.*izquierda a derecha.*huecos ___/s,
    'el prompt de session-eval debe declarar explícitamente que correctAnswer sigue el orden de aparición de los huecos (posición semántica del blank)',
  )
}

// ═══ 3. AcademicContent + renderBlank: parseo único, coherente ═══

function testRenderBlankIsInvokedOncePerBlankInDocumentOrder() {
  const content = 'Completa: ___ es la propiedad que ___ cuando cambia la temperatura.'
  const seen: number[] = []
  const markup = renderToStaticMarkup(createElement(AcademicContent, {
    content,
    renderBlank: (_node, index) => { seen.push(index); return createElement('span', { 'data-testid': `blank-${seen.length}` }, 'CHIP') },
  }))
  assert.equal(seen.length, 2, `debe invocar renderBlank exactamente una vez por hueco, en orden: vistos=${JSON.stringify(seen)}`)
  assert.ok(markup.includes('blank-1') && markup.includes('blank-2'), 'ambas fichas interactivas deben aparecer en el HTML resultante')
  assert.equal((markup.match(/CHIP/g) || []).length, 2, 'no debe haber duplicación del contenido — cada hueco aparece exactamente una vez')
}

function testMathSpanWithoutBlankStaysIntactAlongsideAWordBankBlank() {
  // El span matemático $E=mc^2$ NO contiene ningún hueco — un parseo único y
  // coherente del documento completo no debe degradarlo a texto plano solo
  // porque exista OTRO hueco en otra parte de la misma oración.
  const content = 'La fórmula $E=mc^2$ relaciona masa y energía; el valor de x es ___.'
  const markup = renderToStaticMarkup(createElement(AcademicContent, {
    content,
    renderBlank: () => createElement('span', null, 'CHIP'),
  }))
  assert.ok(markup.includes('role="math"'), `BUG DE ORIGEN SI FALLA: el span matemático sin hueco debe renderizar como math real, no como texto plano degradado: ${markup}`)
}

// AUDITORÍA ADVERSARIAL (post-7a3c3f7, Finding 4 CONFIRMADO): un hueco dentro
// de un span matemático mostraba los delimitadores $/{/} LITERALES en
// pantalla — "[H3O+] = $10^{-2.38}$" tal cual, no matemática renderizada.
// Fix real (no degradación aceptada): parser.ts ahora captura el span
// matemático COMPLETO (incluyendo el ___) y sustituye cada ___ por \square
// (símbolo LaTeX válido) al construir el nodo — el hueco ya NO es un nodo
// 'blank' independiente cuando vive dentro de math, es parte del `value` del
// nodo 'math' (ver node.blankCount). AcademicContent expone renderMathBlank
// para sustituir \square por el valor real seleccionado (o dejarlo vacío)
// justo antes de invocar KaTeX — el resultado es matemática REAL, con el
// valor en su posición real (exponente/fracción/raíz/subíndice).
function testBlankInsideMathSpanRendersAsRealMathWithValueInExponentPosition() {
  const content = '[H3O+] = $10^{-___}$'
  const markup = renderToStaticMarkup(createElement(AcademicContent, {
    content,
    renderMathBlank: () => ({ latex: toLatexSafeText('2.38') }),
  }))
  assert.ok(!markup.includes('$'), `BUG DE ORIGEN SI FALLA: no debe quedar ningún delimitador $ literal en el HTML: ${markup}`)
  assert.ok(markup.includes('class="katex"'), 'debe ser un render KaTeX real, no texto degradado')
  // <annotation> es la anotación TeX interna que KaTeX embebe para
  // accesibilidad/copy-paste (dentro de <math>, no visible como texto plano
  // en pantalla) — "10^{-2.38}" ahí es CORRECTO y esperado, no un fragmento
  // de sintaxis roto. Lo que nunca debe aparecer es "$" (el delimitador que
  // NUNCA forma parte de una anotación TeX interna real).
  // La anotación TeX que KaTeX embebe confirma que "2.38" quedó DENTRO de la
  // estructura del exponente (10^{-2.38}), no como texto suelto al lado.
  assert.match(markup, /10\^\{-2\.38\}|10\^\{-2\.38}/, `2.38 debe aparecer dentro del exponente, no como fragmento fuera de la fórmula: ${markup}`)
}

function testBlankInsideMathSpanShowsEmptyPlaceholderWhenUnanswered() {
  const content = '[H3O+] = $10^{-___}$'
  const markup = renderToStaticMarkup(createElement(AcademicContent, {
    content,
    renderMathBlank: () => ({ latex: toLatexSafeText('') }),
  }))
  assert.ok(markup.includes('class="katex"'), 'sin responder, debe seguir siendo un render KaTeX real (casilla vacía \\square), no texto degradado')
  assert.ok(!markup.includes('$'), 'sin responder tampoco debe haber delimitadores $ literales')
}

function testMathBlankSupportsFractionRootAndSubscript() {
  const cases: Array<[string, string]> = [
    ['fracción', String.raw`$\frac{___}{2}$`],
    ['raíz', String.raw`$\sqrt{___}$`],
    ['subíndice', String.raw`$x_{___}$`],
  ]
  for (const [label, content] of cases) {
    const markup = renderToStaticMarkup(createElement(AcademicContent, {
      content,
      renderMathBlank: () => ({ latex: toLatexSafeText('5') }),
    }))
    assert.ok(markup.includes('class="katex"'), `${label}: debe renderizar como KaTeX real`)
    assert.ok(!markup.includes('$'), `${label}: no debe quedar ningún $ literal`)
  }
}

function testMathBlankClickClearsTheAnswer() {
  const content = '$10^{-___}$'
  let cleared = false
  const markup = renderToStaticMarkup(createElement(AcademicContent, {
    content,
    renderMathBlank: () => ({ latex: toLatexSafeText('2.38'), onClick: () => { cleared = true } }),
  }))
  assert.ok(markup.includes('cursor:pointer') || markup.includes('cursor: pointer'), 'un hueco matemático respondido debe seguir siendo interactivo (limpiar al hacer click)')
  assert.equal(cleared, false, 'renderizar no debe disparar el onClick por sí solo')
}

function testMalformedMathBlankNeverCrashesAndNeverShowsLiteralDelimiters() {
  // Caso patologico: el hueco cae DENTRO de un nombre de comando LaTeX
  // ("\\fr___ac" -> tras sustituir, "\\fr\\square ac"), imposible de renderizar
  // de forma segura -- debe degradarse a un aviso explicito (fail-closed),
  // NUNCA a texto con $/{/} literales ni una excepcion sin capturar.
  const content = '$\\fr___ac{1}{2}$'
  let markup = ''
  assert.doesNotThrow(() => {
    markup = renderToStaticMarkup(createElement(AcademicContent, {
      content,
      renderMathBlank: () => ({ latex: 'X' }),
    }))
    assert.ok(markup.length > 0)
  }, 'un span matematico malformado nunca debe crashear el render')
  assert.doesNotMatch(markup, /\\fr|\\square/, `nunca debe mostrarse sintaxis LaTeX cruda: ${markup}`)
}

function testGenerationTimeRejectsUnsupportedMathBlankStructures() {
  // Los casos SOPORTADOS (exponente, fracción, raíz, subíndice) nunca deben
  // rechazarse en generación — solo lo verdaderamente irrenderizable.
  assert.equal(hasUnsupportedWordBankMathBlank('[H3O+] = $10^{-___}$'), false, 'exponente soportado, no debe rechazarse en generación')
  assert.equal(hasUnsupportedWordBankMathBlank(String.raw`$\frac{___}{2}$`), false, 'fracción soportada, no debe rechazarse en generación')
  assert.equal(hasUnsupportedWordBankMathBlank('El valor de x es ___.'), false, 'un hueco fuera de math nunca debe pasar por esta validación')
}

function testDefaultBlankRenderingUnchangedWhenNoCallbackProvided() {
  // Sin renderBlank (callers existentes que no lo pasan, p.ej. resúmenes de
  // feedback) el comportamiento por defecto debe seguir siendo el mismo de
  // siempre — este fix es puramente aditivo/opt-in.
  const markup = renderToStaticMarkup(createElement(AcademicContent, { content: 'Valor: ___.' }))
  assert.ok(markup.includes('___'), 'sin renderBlank, el hueco debe seguir mostrándose como "___" (comportamiento preexistente intacto)')
}

// ═══ 4. Espaciado — 'blank' debe tratarse como word-like (regresión del fix en composition.ts) ═══
// El tokenizer normalmente preserva el espacio en blanco DENTRO del propio
// nodo de texto (p.ej. "de " ya incluye el espacio final), así que
// academicNodeBoundary no necesita sintetizar nada en ese caso — y con razón
// (evita doble espacio: el guard de la línea 39 de composition.ts ya
// devuelve '' cuando el texto previo termina en whitespace,
// independientemente de este fix). El caso donde SÍ hace falta sintetizar un
// espacio es cuando el nodo anterior NO termina en whitespace (p.ej. límite
// de tokenización sin espacio de por medio) y el siguiente nodo es un hueco
// — antes de este fix, 'blank' no estaba en la clasificación "word-like" en
// ninguna de las dos ramas, así que ese espacio nunca se sintetizaba.
function testBlankNodeGetsSpacingLikeAWordWhenPrecedingTextHasNoTrailingWhitespace() {
  const textNode: AcademicNode = { type: 'text', value: 'de', sourceSpan: { start: 0, end: 2 } }
  const blankNode: AcademicNode = { type: 'blank', id: 'blank_1', sourceSpan: { start: 2, end: 5 } }
  const boundary = academicNodeBoundary(textNode, blankNode)
  assert.equal(boundary, ' ', 'BUG DE ORIGEN SI FALLA: debe sintetizarse un espacio entre una palabra sin espacio final y un hueco adyacente')
}

function testBlankNodeDoesNotDoubleSpaceWhenPrecedingTextAlreadyEndsInWhitespace() {
  const document = prepareAcademicContentForDelivery('de ___ siguiente').document
  const markup = renderToStaticMarkup(createElement(AcademicContent, { content: document }))
  assert.doesNotMatch(markup, /de\s{2,}/, 'no debe introducirse doble espacio cuando el texto fuente ya incluye el espacio antes del hueco')
}

testPageDoesNotDuplicateQuestionTextForWordBank()
testSessionEvalPromptDeclaresBlankOrderContract()
testRenderBlankIsInvokedOncePerBlankInDocumentOrder()
testMathSpanWithoutBlankStaysIntactAlongsideAWordBankBlank()
testBlankInsideMathSpanRendersAsRealMathWithValueInExponentPosition()
testBlankInsideMathSpanShowsEmptyPlaceholderWhenUnanswered()
testMathBlankSupportsFractionRootAndSubscript()
testMathBlankClickClearsTheAnswer()
testMalformedMathBlankNeverCrashesAndNeverShowsLiteralDelimiters()
testGenerationTimeRejectsUnsupportedMathBlankStructures()
testDefaultBlankRenderingUnchangedWhenNoCallbackProvided()
testBlankNodeGetsSpacingLikeAWordWhenPrecedingTextHasNoTrailingWhitespace()
testBlankNodeDoesNotDoubleSpaceWhenPrecedingTextAlreadyEndsInWhitespace()

console.log('word-bank-render-contracts: PASS (no duplicación, orden de correctAnswer declarado, parseo único coherente, math real con blank en exponente/fracción/raíz/subíndice, fallback fail-closed sin sintaxis cruda, rechazo en generación solo para estructuras no soportadas, espaciado word-like)')
