// ═══════════════════════════════════════════════════════════════
// StudyAL — Tipos del Plan de Aprendizaje Adaptativo
// El blueprint describe el conocimiento.
// El plan organiza el camino para dominarlo.
// El motor adaptativo decide cómo recorrerlo.
// ═══════════════════════════════════════════════════════════════

import type { AdaptiveSetup } from '../studySessions';

// ─── Tipos base ───────────────────────────────────────────────

export type SessionType =
  | 'intro'         // "Antes de comenzar" — siempre primera
  | 'deep'          // Estudio profundo de una cognitive unit
  | 'integration'   // Conecta 2+ topics relacionados
  | 'final_review'; // Repaso + simulacro — siempre última

export type CognitiveLoad = 'light' | 'medium' | 'heavy';

export type SessionStatus = 'locked' | 'available' | 'active' | 'done';

export type BloomVerb =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

// ─── Cognitive Unit ───────────────────────────────────────────
// Agrupación de blocks del blueprint que NO se pueden dividir.
// Un topic + sus conceptos, definiciones, fórmulas = 1 unit.

export interface CognitiveUnit {
  id: string;               // "unit_0", "unit_1"...
  topicId: string | null;
  topicLabel: string;
  blockIds: string[];       // refs a blueprint.blocks[].id
  pages: number[];
  concepts: string[];       // nombres legibles de los conceptos
  globalOrderStart: number; // para mantener orden del material
  cognitiveLoad: number;    // score numérico interno
  difficultyBreakdown: {
    basic: number;
    intermediate: number;
    advanced: number;
  };
  highImportanceCount: number;
  formulaCount: number;
  bloomLevels: BloomVerb[];
  dependsOnTopicIds: string[];
}

// ─── Sesión del plan ──────────────────────────────────────────

export interface PlanSession {
  sessionNumber: number;
  type: SessionType;

  // El corazón: objetivo, no tema
  title: string;            // nombre corto para el mapa visual
  objective: string;        // "Comprender cómo Bohr resolvió..."
  why: string;              // "Necesario para entender mecánica cuántica"
  whatYouWillBeAbleToDo: string[];  // al terminar podrás...

  // Contenido (refs al blueprint)
  unitIds: string[];        // CognitiveUnit ids
  blockIds: string[];       // refs a blueprint blocks
  topicIds: string[];       // refs a blueprint topics
  pages: number[];          // ocultas al usuario, para el engine
  concepts: string[];       // nombres legibles

  // Grafo de aprendizaje
  prerequisites: number[];  // sessionNumbers que deben estar done
  unlocks: number[];        // sessionNumbers que esto desbloquea

  // Criterio de salida — cuándo termina esta sesión
  exitCriteria: string[];   // "Explicar X", "Resolver Y", "Comparar Z"

  // Carga cognitiva (no tiempo)
  cognitiveLoad: CognitiveLoad;
  conceptCount: number;
  highImportanceCount: number;
  difficultyBreakdown: {
    basic: number;
    intermediate: number;
    advanced: number;
  };

  // Estado (cambia durante el estudio)
  status: SessionStatus;
}

// ─── Plan completo ────────────────────────────────────────────

export interface StudyPlan {
  id: string;
  version: number;          // se incrementa si ALAI reordena
  createdAt: number;
  updatedAt: number;

  // Programa
  materialTitle: string;
  programGoal: string;      // "Dominar Física Atómica"
  programObjectives: string[];  // lo que sabrás al final
  coverageTarget: 100;      // siempre 100
  totalCognitiveUnits: number;

  // Mapa de dependencias entre topics
  dependencyMap: {
    topicId: string;
    topicLabel: string;
    dependsOn: string[];    // otros topicIds
  }[];

  // Sesiones — el viaje
  sessions: PlanSession[];
  totalSessions: number;

  // Metadata para regeneración y tracking
  blueprintVersion: number;
  setupSnapshot: AdaptiveSetup;
  cognitiveUnits: CognitiveUnit[];  // guardadas para el engine
}
