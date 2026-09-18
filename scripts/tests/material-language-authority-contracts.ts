import assert from 'node:assert/strict'
import { academicLanguageInstruction, detectMaterialLanguage, resolveMaterialLanguage, withMaterialLanguage } from '../../lib/materialLanguage'

export const languageFixtures = {
  en: 'Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs the light in plants. The energy is stored in sugars and used by the cells for growth.',
  es: 'La fotosíntesis convierte la energía luminosa en energía química. La clorofila absorbe la luz en las plantas. La energía se almacena en azúcares y se utiliza para el crecimiento de las células.',
  zh: '光合作用将光能转化为化学能。叶绿素吸收光，植物利用这些能量将二氧化碳和水转化为糖。糖中储存的化学能支持细胞的生长。',
  fr: 'La photosynthèse est une transformation de la lumière en énergie chimique. Les plantes utilisent cette énergie pour la croissance des cellules et pour produire des sucres.',
  ja: '光合成は光エネルギーを化学エネルギーに変換します。葉緑素は光を吸収し、植物はこのエネルギーを使って糖を生成します。',
}
for (const [language, text] of Object.entries(languageFixtures)) {
  assert.equal(detectMaterialLanguage(text), language)
  const source = { blueprint: { globalOrderedAnalysis: [{ label: text, summary: text, sourceSpans: [{ page: 1, quote: text }] }] } }
  const saved = withMaterialLanguage(source)
  assert.equal(resolveMaterialLanguage(JSON.parse(JSON.stringify(saved))), language)
  assert.deepEqual(saved.blueprint.globalOrderedAnalysis, source.blueprint.globalOrderedAnalysis)
  assert.ok(academicLanguageInstruction(language).includes(`AUTHORITY: ${language}.`))
}
const quote = 'La luz es energía.'
assert.equal(detectMaterialLanguage(`${languageFixtures.en} ${languageFixtures.en} “${quote}”`), 'en')
assert.equal(resolveMaterialLanguage({ materialLanguage: 'hi', blocks: [{ summary: languageFixtures.en }] }), 'hi')
assert.equal(detectMaterialLanguage('123 = 456'), 'und')
assert.ok(academicLanguageInstruction('und').includes('dominant language of the authorized source material'))
const authority = { materialLanguage: 'en' }
assert.ok(academicLanguageInstruction(resolveMaterialLanguage(authority), true).includes('CURRENT user message'))
assert.equal(authority.materialLanguage, 'en')
console.log('PASS canonical language: English, Spanish, Chinese, French, Japanese, mixed, persistence, immutable override; zero provider calls')
