import fs from "fs";

const p = "lib/quizStorage.ts";
let s = fs.readFileSync(p, "utf8");

s = s.replace(
`export type QuizGuardado = {
  id: string;
  nombre: string;
  materiaId?: string;
  materiaNombre?: string;
  temaId?: string;
  temaNombre?: string;
  preguntas: any[];
  fechaCreacion?: string;
  fechaActualizacion?: string;
};`,
`export type NivelQuiz = 'facil' | 'medio' | 'dificil';

export type QuizGuardado = {
  id: string;
  nombre: string;
  materiaId?: string;
  materiaNombre?: string;
  materiaColor?: string;
  temaId?: string;
  temaNombre?: string;
  nivel?: NivelQuiz;
  preguntas: any[];
  fechaCreacion?: string;
  fechaActualizacion?: string;
};`
);

s = s.replace(
`    materiaNombre: quiz.materiaNombre,
    temaId: quiz.temaId,`,
`    materiaNombre: quiz.materiaNombre,
    materiaColor: quiz.materiaColor,
    temaId: quiz.temaId,`
);

s = s.replace(
`    materiaNombre: quiz.materiaNombre,
    temaId: quiz.temaId,`,
`    materiaNombre: quiz.materiaNombre,
    materiaColor: quiz.materiaColor,
    temaId: quiz.temaId,`
);

s = s.replace(
`    preguntas: quiz.preguntas || [],
    fechaCreacion: quiz.fechaCreacion || now,`,
`    preguntas: quiz.preguntas || [],
    nivel: quiz.nivel,
    fechaCreacion: quiz.fechaCreacion || now,`
);

s = s.replace(
`    preguntas: quiz.preguntas || [],
    fechaCreacion: quiz.fechaCreacion || now,`,
`    preguntas: quiz.preguntas || [],
    nivel: quiz.nivel,
    fechaCreacion: quiz.fechaCreacion || now,`
);

s += `

export const eliminarQuizGuardado = eliminarQuiz;
export const guardarDeck = guardarFlashcardDeck;
export const obtenerDecks = getFlashcardDecks;
export const eliminarDeck = eliminarFlashcardDeck;
`;

fs.writeFileSync(p, s);
console.log("fixed quizStorage exports");
