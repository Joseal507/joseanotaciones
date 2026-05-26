'use client';

import { useState } from 'react';
import MathText from './MathText';

interface FlashCard {
  question: string;
  answer: string;
}

interface FlashCardsProps {
  cards: FlashCard[];
}

export default function FlashCards({ cards }: FlashCardsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (!cards || cards.length === 0) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <div className="text-6xl mb-4">🎴</div>
        <p className="text-gray-400 text-lg">
          Sube un documento para generar flashcards
        </p>
      </div>
    );
  }

  const currentCard = cards[currentIndex];

  const nextCard = () => {
    setFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % cards.length);
  };

  const prevCard = () => {
    setFlipped(false);
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 text-center">
        <p className="text-gray-400">
          Tarjeta {currentIndex + 1} de {cards.length}
        </p>
      </div>

      {/* Tarjeta */}
      <div
        onClick={() => setFlipped(!flipped)}
        className="relative h-96 cursor-pointer perspective-1000"
      >
        <div
          className={`absolute w-full h-full transition-transform duration-500 transform-style-3d ${
            flipped ? 'rotate-y-180' : ''
          }`}
        >
          {/* Frente */}
          <div className="absolute w-full h-full backface-hidden">
            <div className="bg-gradient-to-br from-blue-900 to-purple-900 rounded-2xl p-8 h-full flex flex-col items-center justify-center border-2 border-blue-500 shadow-2xl">
              <p className="text-sm text-blue-300 mb-4">PREGUNTA</p>
              <h3 className="text-2xl font-bold text-center">
                <MathText text={currentCard.question} />
              </h3>
              <p className="text-sm text-gray-400 mt-8">
                👆 Haz clic para ver la respuesta
              </p>
            </div>
          </div>

          {/* Reverso */}
          <div className="absolute w-full h-full backface-hidden rotate-y-180">
            <div className="bg-gradient-to-br from-purple-900 to-pink-900 rounded-2xl p-8 h-full flex flex-col items-center justify-center border-2 border-purple-500 shadow-2xl">
              <p className="text-sm text-purple-300 mb-4">RESPUESTA</p>
              <h3 className="text-xl text-center leading-relaxed">
                <MathText text={currentCard.answer} />
              </h3>
            </div>
          </div>
        </div>
      </div>

      {/* Controles */}
      <div className="flex justify-center gap-4 mt-8">
        <button
          onClick={prevCard}
          className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors"
        >
          ⬅️ Anterior
        </button>
        <button
          onClick={nextCard}
          className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors"
        >
          Siguiente ➡️
        </button>
      </div>
    </div>
  );
}