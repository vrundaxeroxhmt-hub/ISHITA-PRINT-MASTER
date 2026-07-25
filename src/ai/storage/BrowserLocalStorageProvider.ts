import type { AIStorageProvider } from './AIStorageProvider.ts';

export class BrowserLocalStorageProvider implements AIStorageProvider {
  private isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  }

  public get<T>(key: string): T | null {
    if (!this.isAvailable()) return null;
    try {
      const item = localStorage.getItem(key);
      if (item === null) return null;
      return JSON.parse(item) as T;
    } catch {
      return null;
    }
  }

  public set<T>(key: string, value: T): void {
    if (!this.isAvailable()) return;
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(key, serialized);
    } catch {
      // Safely ignore storage limits or write errors
    }
  }

  public remove(key: string): void {
    if (!this.isAvailable()) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Safely ignore removal errors
    }
  }

  public getAllKeys(): string[] {
    if (!this.isAvailable()) return [];
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null) {
          keys.push(key);
        }
      }
      return keys;
    } catch {
      return [];
    }
  }

  public clearByPrefix(prefix: string): void {
    if (!this.isAvailable()) return;
    try {
      const keysToRemove = this.getAllKeys().filter((key) => key.startsWith(prefix));
      keysToRemove.forEach((key) => this.remove(key));
    } catch {
      // Safely ignore clear errors
    }
  }
}
