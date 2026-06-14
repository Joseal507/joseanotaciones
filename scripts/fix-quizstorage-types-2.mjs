import fs from "fs";

const p = "lib/quizStorage.ts";
let s = fs.readFileSync(p, "utf8");

s = s.replace(
  "export type NivelQuiz = 'facil' | 'medio' | 'dificil';",
  "export type NivelQuiz = 'facil' | 'medio' | 'intermedio' | 'dificil';"
);

s = s.replace(
`export type FlashcardDeck = {
  id: string;
  nombre: string;
  materiaId?: string;
  materiaNombre?: string;
  temaId?: string;
  temaNombre?: string;
  flashcards: any[];
  fechaCreacion?: string;
  fechaActualizacion?: string;
};`,
`export type FlashcardDeck = {
  id: string;
  nombre: string;
  materiaId?: string;
  materiaNombre?: string;
  materiaColor?: string;
  temaId?: string;
  temaNombre?: string;
  temaColor?: string;
  flashcards: any[];
  fechaCreacion?: string;
  fechaActualizacion?: string;
};`
);

s = s.replace(
`    materiaNombre: deck.materiaNombre,
    temaId: deck.temaId,`,
`    materiaNombre: deck.materiaNombre,
    materiaColor: deck.materiaColor,
    temaId: deck.temaId,`
);

s = s.replace(
`    temaNombre: deck.temaNombre,
    flashcards: deck.flashcards || [],`,
`    temaNombre: deck.temaNombre,
    temaColor: deck.temaColor,
    flashcards: deck.flashcards || [],`
);

fs.writeFileSync(p, s);
console.log("fixed quizStorage type compatibility");
