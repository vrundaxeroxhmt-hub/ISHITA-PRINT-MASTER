import { AIManager } from '../AIManager.ts';
import { LocalVisionProvider } from '../providers/LocalVisionProvider.ts';
import { LocalServiceVisionProvider } from '../providers/LocalServiceVisionProvider.ts';
import { RemoteAPIVisionProvider } from '../providers/RemoteAPIVisionProvider.ts';

let defaultInstance: AIManager | null = null;

/**
 * Creates and configures a new AIManager instance populated with default vision providers.
 * Explicit bootstrap function without global import side effects.
 */
export function createDefaultAIManager(): AIManager {
  const manager = new AIManager();
  manager.registerVisionProvider(new LocalVisionProvider());
  manager.registerVisionProvider(new LocalServiceVisionProvider());
  manager.registerVisionProvider(new RemoteAPIVisionProvider());
  return manager;
}

/**
 * Returns a lazily instantiated default AIManager instance.
 * Ensures zero side effects at module evaluation time.
 */
export function getDefaultAIManager(): AIManager {
  if (!defaultInstance) {
    defaultInstance = createDefaultAIManager();
  }
  return defaultInstance;
}

/**
 * Side-effect-free lazy proxy for backward compatibility with existing imports.
 * Defers AIManager creation until first method invocation.
 */
export const aiManager: AIManager = new Proxy({} as AIManager, {
  get(_target, prop, receiver) {
    const instance = getDefaultAIManager();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
