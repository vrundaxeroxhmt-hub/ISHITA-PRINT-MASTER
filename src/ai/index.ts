export * from './types.ts';
export * from './interfaces/VisionProvider.ts';
export * from './interfaces/OCRProvider.ts';
export * from './interfaces/LLMProvider.ts';
export * from './providers/LocalVisionProvider.ts';
export * from './providers/LocalServiceVisionProvider.ts';
export * from './providers/RemoteAPIVisionProvider.ts';
export * from './AIManager.ts';

import { AIManager } from './AIManager.ts';
import { LocalVisionProvider } from './providers/LocalVisionProvider.ts';
import { LocalServiceVisionProvider } from './providers/LocalServiceVisionProvider.ts';
import { RemoteAPIVisionProvider } from './providers/RemoteAPIVisionProvider.ts';

export const aiManager = new AIManager();

// Register default execution mode providers into registry
aiManager.registerVisionProvider(new LocalVisionProvider());
aiManager.registerVisionProvider(new LocalServiceVisionProvider());
aiManager.registerVisionProvider(new RemoteAPIVisionProvider());
