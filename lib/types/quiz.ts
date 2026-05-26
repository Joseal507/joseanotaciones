export type QuizQuestionType =
  | 'multiple_choice'
  | 'multi_select'
  | 'true_false'
  | 'fill_blank'
  | 'matching'
  | 'short_answer';

export type NivelQuiz = 'facil' | 'intermedio' | 'dificil' | 'easy' | 'medium' | 'hard';

export interface QuizQuestionBase {
  id: string;
  type: QuizQuestionType;
  question: string;
  explanation?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  sourceMaterial?: string; // ID del material
  sourceMaterialName?: string; // Nombre del material para mostrar
  sourcePage?: number;
}

export interface MultipleChoiceQuestion extends QuizQuestionBase {
  type: 'multiple_choice';
  options: string[];
  correctAnswer: number; // Índice 0 a 3
}

export interface MultiSelectQuestion extends QuizQuestionBase {
  type: 'multi_select';
  options: string[];
  correctAnswers: number[]; // Índices correctos
}

export interface TrueFalseQuestion extends QuizQuestionBase {
  type: 'true_false';
  correctAnswer: boolean;
}

export interface FillBlankQuestion extends QuizQuestionBase {
  type: 'fill_blank';
  answer: string;
}

export interface MatchingPair {
  left: string;
  right: string;
}

export interface MatchingQuestion extends QuizQuestionBase {
  type: 'matching';
  pairs: MatchingPair[];
}

export interface ShortAnswerQuestion extends QuizQuestionBase {
  type: 'short_answer';
  acceptedAnswers: string[];
  caseInsensitive: boolean;
}

export type QuizQuestion =
  | MultipleChoiceQuestion
  | MultiSelectQuestion
  | TrueFalseQuestion
  | FillBlankQuestion
  | MatchingQuestion
  | ShortAnswerQuestion;

export interface QuizGuardado {
  id: string;
  nombre: string;
  fechaCreacion: string;
  nivel?: NivelQuiz;
  preguntas: QuizQuestion[];
  materiaNombre?: string;
  materiaColor?: string;
  expiraEn?: number;
  enDeck?: boolean;
  esTemporal?: boolean;
}
