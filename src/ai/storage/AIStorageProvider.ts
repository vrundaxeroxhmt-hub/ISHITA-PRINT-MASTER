export interface AIStorageProvider {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  getAllKeys(): string[];
  clearByPrefix(prefix: string): void;
}
