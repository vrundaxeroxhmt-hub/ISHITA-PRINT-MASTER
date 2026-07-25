export * from './types.ts';
export * from './interfaces/VisionProvider.ts';
export * from './interfaces/OCRProvider.ts';
export * from './interfaces/LLMProvider.ts';
export * from './providers/LocalVisionProvider.ts';
export * from './AIManager.ts';

import { AIManager } from './AIManager.ts';

export const aiManager = new AIManager();
