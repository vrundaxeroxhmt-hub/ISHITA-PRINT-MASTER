import type { AISettings } from '../types.ts';
import type { AIStorageProvider } from '../storage/AIStorageProvider.ts';
import { BrowserLocalStorageProvider } from '../storage/BrowserLocalStorageProvider.ts';

const STORAGE_KEY = 'ishita_print_desk_ai_settings';

export const DEFAULT_AI_SETTINGS: Readonly<AISettings> = {
  customerCompletionWindowSeconds: 45,
  customerJobSessionTimeoutMinutes: 10,
  allowOperatorPriorityOverride: true,
  autoMergePdf: true,
  oddPagesAddBlank: false,
  autoCrop: true,
  autoPerspective: true,
  autoDeskew: true,
  autoOcr: true,
  autoLayout: true,
  autoDuplicateRemoval: true,
  autoDocumentGrouping: true,
  lowConfidenceThreshold: 0.75,
  finalPdfAutoGenerate: true,
  autoPrintEnabled: false,
  executionModePreference: 'browser',
  customerConcurrency: 1,
  workerConcurrency: 1,
};

export function normalizeAISettings(rawSettings: Partial<AISettings>): AISettings {
  const merged: AISettings = {
    ...DEFAULT_AI_SETTINGS,
    ...rawSettings,
  };

  return {
    ...merged,
    customerCompletionWindowSeconds:
      typeof merged.customerCompletionWindowSeconds === 'number' &&
      merged.customerCompletionWindowSeconds > 0
        ? Math.round(merged.customerCompletionWindowSeconds)
        : DEFAULT_AI_SETTINGS.customerCompletionWindowSeconds,
    customerJobSessionTimeoutMinutes:
      typeof merged.customerJobSessionTimeoutMinutes === 'number' &&
      merged.customerJobSessionTimeoutMinutes > 0
        ? Math.round(merged.customerJobSessionTimeoutMinutes)
        : DEFAULT_AI_SETTINGS.customerJobSessionTimeoutMinutes,
    lowConfidenceThreshold:
      typeof merged.lowConfidenceThreshold === 'number'
        ? Math.max(0, Math.min(1, merged.lowConfidenceThreshold))
        : DEFAULT_AI_SETTINGS.lowConfidenceThreshold,
    customerConcurrency: 1,
    workerConcurrency: 1,
  };
}

export class AISettingsStore {
  private static instance: AISettingsStore | null = null;
  private storage: AIStorageProvider;
  private settings: AISettings;

  public constructor(storageProvider: AIStorageProvider = new BrowserLocalStorageProvider()) {
    this.storage = storageProvider;
    this.settings = this.loadSettings();
  }

  public static getInstance(): AISettingsStore {
    if (!AISettingsStore.instance) {
      AISettingsStore.instance = new AISettingsStore();
    }
    return AISettingsStore.instance;
  }

  public getSettings(): AISettings {
    return { ...this.settings };
  }

  public updateSettings(patch: Partial<AISettings>): AISettings {
    this.settings = normalizeAISettings({
      ...this.settings,
      ...patch,
    });
    this.saveSettings();
    return this.getSettings();
  }

  public resetToDefaults(): AISettings {
    this.settings = { ...DEFAULT_AI_SETTINGS };
    this.saveSettings();
    return this.getSettings();
  }

  private loadSettings(): AISettings {
    const raw = this.storage.get<Partial<AISettings>>(STORAGE_KEY);
    return normalizeAISettings(raw || {});
  }

  private saveSettings(): void {
    this.storage.set(STORAGE_KEY, this.settings);
  }
}

export function getAISettings(): AISettings {
  return AISettingsStore.getInstance().getSettings();
}

export function updateAISettings(patch: Partial<AISettings>): AISettings {
  return AISettingsStore.getInstance().updateSettings(patch);
}

export function resetAISettings(): AISettings {
  return AISettingsStore.getInstance().resetToDefaults();
}
