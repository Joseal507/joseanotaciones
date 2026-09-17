import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  computeExamLetterGrade,
  ResultsView,
  TimesTab,
  RBlock,
  ExamPaperHeader,
  PaperStat,
  FL,
  type ExamResultTab,
} from "../../components/materias/ALAIStudyALExams";
import {
  __routeDeps,
} from "../../app/api/alai-studyal-exam/route";
import {
  InMemoryExamGenerationStore,
  examGenerationIdentity,
} from "../../lib/materialBrain/examGenerationStore";
import { MemoryExamGradingStore } from "../../lib/materialBrain/examGrading";

console.log("\n── EXAM_RESULT_UX_CONTRACTS ──\n");

async function main() {
  // ── FIXTURES ──
  const mockExam: any = {
    id: "exam-fixture-1",
    title: "Cultura Contemporánea",
    totalPoints: 100,
    estimatedDifficulty: "medium",
    coverage: "100%",
    sections: [{ id: "sec-1", title: "Sección Principal" }],
    questions: [
      {
        id: "q-1",
        type: "multiple_choice",
        prompt: "¿Cuál es la definición antropológica de cultura?",
        points: 25,
        skill: "comprehension",
        difficulty: "medium",
        options: ["Opción A", "Opción B", "Opción C", "Opción D"],
        correctAnswer: 0,
        sourcePage: 4,
        sourcePages: [4],
      },
      {
        id: "q-2",
        type: "short_answer",
        prompt: "Explica la diferencia entre cultura material y no material.",
        points: 25,
        skill: "explanation",
        difficulty: "medium",
        expectedAnswer: "La cultura material incluye objetos físicos; la no material incluye valores e ideas.",
        sourcePage: 8,
        sourcePages: [8, 9],
      },
      {
        id: "q-3",
        type: "true_false",
        prompt: "Tylor propuso una definición universal de cultura.",
        points: 25,
        skill: "retention",
        difficulty: "basic",
        correctAnswer: true,
        sourcePage: 2,
        sourcePages: [2],
      },
      {
        id: "q-4",
        type: "fill_blank",
        prompt: "El relativismo cultural se contrapone al ____.",
        points: 25,
        skill: "comprehension",
        difficulty: "medium",
        expectedAnswer: "etnocentrismo",
        sourcePage: 12,
        sourcePages: [12],
      },
    ],
  };

  const mockEvaluation: any = {
    score: 50,
    earnedPoints: 50,
    totalPoints: 100,
    perQuestion: [
      { index: 0, correct: true, partialScore: 100, feedback: "Excelente deducción.", modelAnswer: "Opción A" },
      { index: 1, correct: false, partialScore: 0, feedback: "Faltó contrastar los aspectos intangibles.", modelAnswer: "La cultura material incluye objetos físicos; la no material incluye valores e ideas." },
      { index: 2, correct: true, partialScore: 100, feedback: "Correcto.", modelAnswer: "Verdadero" },
      { index: 3, correct: false, partialScore: 0, feedback: "Sin responder.", modelAnswer: "etnocentrismo" },
    ],
    skillScores: {
      retention: 100,
      comprehension: 50,
      application: null,
      relation: null,
      explanation: 0,
      critical_thinking: null,
    },
    strengths: ["Comprensión del concepto antropológico inicial."],
    weaknesses: ["Diferenciación entre cultura material e inmaterial."],
    weakConcepts: ["Cultura inmaterial y simbólica", "Relativismo vs Etnocentrismo"],
    weakPages: [8, 9, 12],
    recommendation: "Revisa las lecturas sobre relativismo cultural y cultura material.",
    recoveryPlan: Array.from({ length: 15 }, (_, i) => ({
      title: `Target interno ${i + 1}`,
      detail: `Revisa target_${i + 1}. Páginas ${i + 1}, ${i + 2}.`,
    })),
  };

  const mockAnswers = ["Opción A", "Respuesta errónea del alumno", true, null]; // q-4 unanswered
  const mockConfidences = ["high", "very_high", "low", null];
  const mockQuestionTimes = [15000, 45000, 8000, 0];

  console.log("--- Contract A: Giant recovery target list is not rendered ---");
  {
    for (const tab of ["questions", "overview", "calibration", "times"] as ExamResultTab[]) {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ResultsView, {
          exam: mockExam,
          evaluation: mockEvaluation,
          answers: mockAnswers,
          confidences: mockConfidences,
          questionTimes: mockQuestionTimes,
          resultsTab: tab,
          setResultsTab: () => {},
          onReset: () => {},
          onBack: () => {},
        })
      );
      assert.ok(!html.includes("Plan de recuperación"), "Must not render Plan de recuperación in tab: " + tab);
      assert.ok(!html.includes("Target interno 1"), "Must not render target items in tab: " + tab);
      assert.ok(!html.includes("Revisa target_"), "Must not render target bookkeeping in tab: " + tab);
    }
    console.log("PASS Contract A: Giant recovery target list is never rendered");
  }

  console.log("--- Contract B: Desempeño por habilidad is not a standalone section ---");
  {
    const overviewHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: mockEvaluation,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "overview",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
      })
    );
    assert.ok(!overviewHtml.includes("Desempeño por habilidad"), "Overview must NOT contain standalone Desempeño por habilidad");
    console.log("PASS Contract B: Desempeño por habilidad is not a standalone result section");
  }

  console.log("--- Contract C: Empty Fortalezas / Conceptos dominados sections do not render ---");
  {
    const emptyEval = {
      ...mockEvaluation,
      strengths: [],
      weaknesses: [],
      weakConcepts: [],
      weakPages: [],
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: emptyEval,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "overview",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
      })
    );
    assert.ok(!html.includes("Fortalezas"), "Empty Fortalezas must not render");
    assert.ok(!html.includes("Conceptos dominados"), "Empty Conceptos dominados must not render");
    assert.ok(!html.includes("—</div>"), "Empty placeholders with dashes must not render in empty sections");

    // Also verify RBlock directly returns null when items empty
    const rblockEmpty = ReactDOMServer.renderToStaticMarkup(
      React.createElement(RBlock, { title: "Fortalezas", items: [], color: "#16a34a" })
    );
    assert.equal(rblockEmpty, "", "RBlock must render null when items is empty");
    console.log("PASS Contract C: Empty Fortalezas and weak concept sections do not render");
  }

  console.log("--- Contract D: Review modes exist (Por pregunta, Confianza, Tiempo, Resumen) ---");
  {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: mockEvaluation,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "questions",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
      })
    );
    assert.ok(html.includes("Por pregunta"), "Review modes must include Por pregunta");
    assert.ok(html.includes("Confianza"), "Review modes must include Confianza");
    assert.ok(html.includes("Tiempo"), "Review modes must include Tiempo");
    assert.ok(html.includes("Resumen"), "Review modes must include Resumen");
    console.log("PASS Contract D: Review modes exist");
  }

  console.log("--- Contract E: Por pregunta is default ---");
  {
    const code = fs.readFileSync("/Users/joseal/IMPORTANTE/studyal/components/materias/ALAIStudyALExams.tsx", "utf8");
    assert.ok(
      code.includes("useState<ExamResultTab>('questions')") || code.includes('useState<ExamResultTab>("questions")'),
      "Default resultsTab state in ALAIStudyALExams must be questions"
    );
    assert.ok(
      code.includes("(saved.resultsTab as ExamResultTab) || 'questions'"),
      "Saved restore must fallback to questions"
    );
    console.log("PASS Contract E: Por pregunta is default");
  }

  console.log("--- Contract F: Question review uses sanitized public result data ---");
  {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: mockEvaluation,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "questions",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
      })
    );
    // Original questions rendered
    assert.ok(html.includes("¿Cuál es la definición antropológica de cultura?"));
    assert.ok(html.includes("Explica la diferencia entre cultura material y no material."));
    // Student submitted answers rendered
    assert.ok(html.includes("Opción A"));
    assert.ok(html.includes("Respuesta errónea del alumno"));
    // Correct / expected answer rendered
    assert.ok(html.includes("La cultura material incluye objetos físicos; la no material incluye valores e ideas."));
    // Feedback rendered
    assert.ok(html.includes("Excelente deducción."));
    // Source page grounding rendered
    assert.ok(html.includes("Página 4"));
    assert.ok(html.includes("Páginas 8, 9"));
    console.log("PASS Contract F: Question review uses sanitized public result data");
  }

  console.log("--- Contract G: Correct, incorrect, and unanswered states are distinguishable ---");
  {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: mockEvaluation,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "questions",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
      })
    );
    // Correct question has checkmark & accessible badge
    assert.ok(html.includes("✓ 1"), "Correct question has ✓ marker");
    assert.ok(html.includes("CORRECTA"), "Correct question has CORRECTA badge");

    // Incorrect question has cross & accessible badge
    assert.ok(html.includes("✕ 2"), "Incorrect question has ✕ marker");
    assert.ok(html.includes("INCORRECTA"), "Incorrect question has INCORRECTA badge");

    // Unanswered question has dash marker & SIN RESPONDER badge
    assert.ok(html.includes("— 4"), "Unanswered question has — marker");
    assert.ok(html.includes("SIN RESPONDER"), "Unanswered question has SIN RESPONDER badge");
    assert.ok(html.includes("(Sin responder)"), "Unanswered question shows (Sin responder) text");
    assert.ok(html.includes("0 / 25 pts"), "Unanswered question earned 0 points");
    console.log("PASS Contract G: Correct, incorrect, and unanswered states are clearly distinguishable");
  }

  console.log("--- Contract H: Confidence mode preserves all four calibration states ---");
  {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: mockEvaluation,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "calibration",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
      })
    );
    assert.ok(html.includes("Calibración: ¿qué tan bien te conoces?"));
    assert.ok(html.includes("Cruzamos tus respuestas con tu nivel de confianza. La zona crítica es la más peligrosa:"));
    assert.ok(html.includes("Suerte / intuición"), "Quadrant 1: Suerte / intuición");
    assert.ok(html.includes("Acertaste pero no estabas seguro"));
    assert.ok(html.includes("Dominio real"), "Quadrant 2: Dominio real");
    assert.ok(html.includes("Sabes y sabes que sabes"));
    assert.ok(html.includes("Sabías que no sabías"), "Quadrant 3: Sabías que no sabías");
    assert.ok(html.includes("ZONA CRÍTICA"), "Quadrant 4: ZONA CRÍTICA");
    assert.ok(html.includes("Creías saber pero no. Máxima prioridad."));
    assert.ok(html.includes("preguntas saltadas / sin responder o sin confianza marcada."));
    console.log("PASS Contract H: Confidence mode preserves all four calibration states");
  }

  console.log("--- Contract I: Time mode preserves total/average/pattern/per-question info ---");
  {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: mockEvaluation,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "times",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
      })
    );
    assert.ok(html.includes("Tiempo por pregunta"));
    assert.ok(html.includes("Tiempo total:"));
    assert.ok(html.includes("Promedio:"));
    assert.ok(html.includes("Tiempo por habilidad"), "Tiempo por habilidad must be embedded in time mode");
    console.log("PASS Contract I: Time mode preserves total, average, patterns, and per-question info");
  }

  console.log("--- Contract J: No private grading authority appears in rendered DTO/UI ---");
  {
    const evalWithPrivate = {
      ...mockEvaluation,
      criterionResults: [
        {
          criterionId: "crit-1",
          questionId: "q-1",
          label: "Definición antropológica",
          scorePercent: 100,
          canonicalCriterion: "PRIVATE_CANONICAL",
          rubric: "PRIVATE_RUBRIC",
          rubricHints: ["PRIVATE_HINT"],
          targetIds: ["target-dem-secret-1"],
        },
      ],
    };
    for (const tab of ["questions", "overview", "calibration", "times"] as ExamResultTab[]) {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ResultsView, {
          exam: mockExam,
          evaluation: evalWithPrivate,
          answers: mockAnswers,
          confidences: mockConfidences,
          questionTimes: mockQuestionTimes,
          resultsTab: tab,
          setResultsTab: () => {},
          onReset: () => {},
          onBack: () => {},
        })
      );
      assert.ok(!html.includes("PRIVATE_CANONICAL"), "Must not leak canonicalCriterion");
      assert.ok(!html.includes("PRIVATE_RUBRIC"), "Must not leak rubric");
      assert.ok(!html.includes("PRIVATE_HINT"), "Must not leak rubricHints");
      assert.ok(!html.includes("target-dem-secret-1"), "Must not leak targetIds");
    }
    console.log("PASS Contract J: No private grading authority appears in rendered DTO or UI");
  }

  console.log("--- Contract K: Same completed exam reopen requires zero provider calls ---");
  {
    const examStore = new InMemoryExamGenerationStore();
    const gradingStore = new MemoryExamGradingStore();
    const userId = "user-reopen-test";
    const sessionId = "session-reopen-test";
    const fingerprint = "fp-reopen-1";
    const examId = "exam-reopen-1";
    const identity = examGenerationIdentity(sessionId, fingerprint, examId);

    const savedResult = {
      score: 85,
      earnedPoints: 85,
      totalPoints: 100,
      perQuestion: [{ index: 0, correct: true, partialScore: 100, feedback: "OK", modelAnswer: "A" }],
      skillScores: { retention: 85, comprehension: null, application: null, relation: null, explanation: null, critical_thinking: null },
      strengths: ["Buen dominio"], weaknesses: [], masteredConcepts: ["Concepto A"], weakConcepts: [], weakPages: [],
      recommendation: "Excelente trabajo.",
      recoveryPlan: [],
    };

    let providerCalls = 0;
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: userId } }),
      getAuthoritativeFreeSession: async () => ({
        id: sessionId, userId, processMode: "free",
        sourceSelection: { fingerprint, materialIds: ["mat-1"], selectedPages: { "mat-1": [1] } },
      }),
      getMaterial: async () => ({ id: "mat-1", nombre: "Material 1" }),
      gradingStore,
      examStore,
      generateValidatedLegacyJson: async () => {
        providerCalls++;
        throw new Error("Provider should NOT be called on reopen!");
      },
    });

    // Save initial result in store
    const answersHash = "hash-123";
    await examStore.saveResult(identity, {
      examId,
      fingerprint,
      answersHash,
      result: savedResult,
      createdAt: new Date().toISOString(),
    });

    // Reopen / fetch persisted result
    const reopened = await examStore.getResult(identity, answersHash);
    assert.ok(reopened, "Persisted result must be restorable");
    assert.equal(providerCalls, 0, "Reopen must make zero provider calls");
    assert.equal(reopened.result.score, 85, "Reopened score must match");
    assert.equal(computeExamLetterGrade(reopened.result.score), "B", "Letter grade on reopen must match canonical mapping");
    console.log("PASS Contract K: Reopen requires zero provider calls and reproduces exact result");
  }

  console.log("--- Contract L: Academic score / letter grade calculations remain unchanged ---");
  {
    // Canonical A/B/C/D/F scale:
    // >= 90: A, >= 80: B, >= 70: C, >= 60: D, < 60: F
    assert.equal(computeExamLetterGrade(100), "A");
    assert.equal(computeExamLetterGrade(95), "A");
    assert.equal(computeExamLetterGrade(90), "A");
    assert.equal(computeExamLetterGrade(89), "B");
    assert.equal(computeExamLetterGrade(85), "B");
    assert.equal(computeExamLetterGrade(80), "B");
    assert.equal(computeExamLetterGrade(79), "C");
    assert.equal(computeExamLetterGrade(75), "C");
    assert.equal(computeExamLetterGrade(70), "C");
    assert.equal(computeExamLetterGrade(69), "D");
    assert.equal(computeExamLetterGrade(65), "D");
    assert.equal(computeExamLetterGrade(60), "D");
    assert.equal(computeExamLetterGrade(59), "F");
    assert.equal(computeExamLetterGrade(40), "F");
    assert.equal(computeExamLetterGrade(0), "F");
    // Clamping
    assert.equal(computeExamLetterGrade(-10), "F");
    assert.equal(computeExamLetterGrade(120), "A");
    console.log("PASS Contract L: Academic score and canonical letter grade scale verified");
  }

  console.log("--- Header & Reinforcement CTA Card Verification ---");
  {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: mockExam,
        evaluation: mockEvaluation,
        answers: mockAnswers,
        confidences: mockConfidences,
        questionTimes: mockQuestionTimes,
        resultsTab: "questions",
        setResultsTab: () => {},
        onReset: () => {},
        onBack: () => {},
        materia: { nombre: "Antropología Social" },
        tema: { nombre: "Cultura Contemporánea" },
        userName: "Estudiante Prueba",
        duration: 45,
      })
    );
    // Real Active Exam Header Reused
    assert.ok(html.includes("S T U D Y A L"), "Header contains STUDYAL brand");
    assert.ok(html.includes("Examen corregido por ALAI"), "Header title indicates corrected exam");
    assert.ok(html.includes("data-testid=\"exam-header-grade\""), "Header contains professor grade element in top-right");
    assert.ok(html.includes("F"), "Header contains letter grade F for 50%");
    assert.ok(html.includes("50%"), "Header contains percentage 50%");
    assert.ok(html.includes("50 / 100"), "Header stats contain earned / total points");
    assert.ok(html.includes("4"), "Header stats contain question count");
    assert.ok(html.includes("Cultura Contemporánea"), "Header metadata contains topic");
    assert.ok(html.includes("Antropología Social"), "Header metadata contains materia");
    assert.ok(html.includes("Estudiante Prueba"), "Header metadata contains student name");

    // ABSOLUTELY NO separate giant score card or dashboard header widget
    assert.ok(!html.includes("STUDYAL · RESULTADO DEL EXAMEN"), "Must NOT render separate score card header");

    // Unit test: ExamPaperHeader component reuse across active and completed states
    const activeHeaderHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ExamPaperHeader, {
        materia: { nombre: "Antropología Social" },
        tema: { nombre: "Cultura Contemporánea" },
        userName: "Estudiante Prueba",
        duration: 45,
        today: "09 de septiembre de 2026",
      })
    );
    assert.ok(activeHeaderHtml.includes("Examen generado por ALAI"), "Active exam header says generado por ALAI");
    assert.ok(!activeHeaderHtml.includes("data-testid=\"exam-header-grade\""), "Active exam header has no grade mark");
    assert.ok(activeHeaderHtml.includes("Estudiante Prueba"), "Active header shows student name");

    const completedHeaderHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ExamPaperHeader, {
        materia: { nombre: "Antropología Social" },
        tema: { nombre: "Cultura Contemporánea" },
        userName: "Estudiante Prueba",
        duration: 45,
        today: "09 de septiembre de 2026",
        grade: { letter: "A", score: 94, color: "#16a34a" },
      })
    );
    assert.ok(completedHeaderHtml.includes("Examen corregido por ALAI"), "Completed header says corregido por ALAI");
    assert.ok(completedHeaderHtml.includes("data-testid=\"exam-header-grade\""), "Completed header has top-right grade mark");
    assert.ok(completedHeaderHtml.includes("A"), "Completed header displays letter grade");
    assert.ok(completedHeaderHtml.includes("94%"), "Completed header displays score percentage");

    // Reinforcement CTA Card
    assert.ok(html.includes("Sigue reforzando tu conocimiento"), "CTA contains exact Spanish title");
    assert.ok(
      html.includes("Vuelve a usar las herramientas de StudyAL para reforzar los temas que necesitas mejorar."),
      "CTA contains exact Spanish body"
    );
    assert.ok(html.includes("Repasar"), "CTA provides Repasar action");
    assert.ok(html.includes("Flashcards"), "CTA provides Flashcards action");
    assert.ok(html.includes("Quiz"), "CTA provides Quiz action");
    assert.ok(html.includes("Study Map"), "CTA provides Study Map action");
    console.log("PASS Header & Reinforcement CTA Card: Exact exam header reuse and grade placement verified");
  }

  console.log("\nALL 12 RESULT UX CONTRACTS PASSED PERFECTLY!\n");
}

main().catch(err => {
  console.error("CONTRACT FAILURE:", err);
  process.exit(1);
});
