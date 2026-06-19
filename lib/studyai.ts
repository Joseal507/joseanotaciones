// Compatibilidad temporal.
// El motor real ahora es ALAI.
export {
  alai,
  alaiJson,
  alaiRequest,
  getALAIClient,
  blockALAIKey,
  safeParseJson,
  cleanText,
  cleanDeep,

  // exports viejos para no romper rutas existentes
  studyAI,
  studyAIJson,
  groqRequest,
  getGroqClient,
} from './alai';

export type {
  ALAIParams,
  ALAIResult,
  StudyAIParams,
  StudyAIResult,
} from './alai';
