import type { AIJobMemory, CustomerJobSessionMetadata } from '../types.ts';
import type { AIStorageProvider } from '../storage/AIStorageProvider.ts';
import { BrowserLocalStorageProvider } from '../storage/BrowserLocalStorageProvider.ts';

const SESSIONS_STORAGE_KEY = 'ishita_print_desk_ai_job_sessions';
const MEMORY_STORAGE_PREFIX = 'ishita_print_desk_ai_job_mem_';

function cloneSession(session: CustomerJobSessionMetadata): CustomerJobSessionMetadata {
  return {
    ...session,
    pdfRevisions: session.pdfRevisions.map((rev) => ({
      ...rev,
      fileIdsIncluded: [...rev.fileIdsIncluded],
    })),
  };
}

function cloneJobMemory(memory: AIJobMemory): AIJobMemory {
  return {
    ...memory,
    originalFileRef: { ...memory.originalFileRef },
    ocrResult: memory.ocrResult
      ? {
          ...memory.ocrResult,
          blocks: memory.ocrResult.blocks.map((b) => ({
            ...b,
            boundingBox: b.boundingBox ? { ...b.boundingBox } : undefined,
          })),
        }
      : undefined,
    classification: memory.classification ? { ...memory.classification } : undefined,
    duplicateInfo: memory.duplicateInfo ? { ...memory.duplicateInfo } : undefined,
    transformStack: memory.transformStack.map((t) => ({
      ...t,
      parameters: {
        ...t.parameters,
        crop: t.parameters.crop ? { ...t.parameters.crop } : undefined,
        perspective: t.parameters.perspective
          ? [
              { ...t.parameters.perspective[0] },
              { ...t.parameters.perspective[1] },
              { ...t.parameters.perspective[2] },
              { ...t.parameters.perspective[3] },
            ]
          : undefined,
      },
    })),
    warnings: [...memory.warnings],
  };
}

export class AIJobMemoryStore {
  private static instance: AIJobMemoryStore | null = null;
  private storage: AIStorageProvider;
  private sessionCache: Map<string, CustomerJobSessionMetadata>;
  private memoryCache: Map<string, AIJobMemory>;

  public constructor(storageProvider: AIStorageProvider = new BrowserLocalStorageProvider()) {
    this.storage = storageProvider;
    this.sessionCache = new Map();
    this.memoryCache = new Map();
    this.loadAllSessionsFromStorage();
  }

  public static getInstance(): AIJobMemoryStore {
    if (!AIJobMemoryStore.instance) {
      AIJobMemoryStore.instance = new AIJobMemoryStore();
    }
    return AIJobMemoryStore.instance;
  }

  public getJobSession(jobSessionId: string): CustomerJobSessionMetadata | null {
    const session = this.sessionCache.get(jobSessionId);
    return session ? cloneSession(session) : null;
  }

  public saveJobSession(session: CustomerJobSessionMetadata): void {
    const cloned = cloneSession(session);
    this.sessionCache.set(session.jobSessionId, cloned);
    this.persistSessions();
  }

  public getAllJobSessions(): CustomerJobSessionMetadata[] {
    return Array.from(this.sessionCache.values()).map((s) => cloneSession(s));
  }

  public getLatestCustomerJobSession(customerId: string): CustomerJobSessionMetadata | null {
    const customerSessions = Array.from(this.sessionCache.values()).filter(
      (s) => s.customerId === customerId
    );
    if (customerSessions.length === 0) return null;
    customerSessions.sort((a, b) => b.lastFileReceivedAt - a.lastFileReceivedAt);
    return cloneSession(customerSessions[0]);
  }

  public removeJobSession(jobSessionId: string): void {
    this.sessionCache.delete(jobSessionId);
    this.persistSessions();
  }

  public getJobMemory(fileId: string): AIJobMemory | null {
    if (this.memoryCache.has(fileId)) {
      return cloneJobMemory(this.memoryCache.get(fileId)!);
    }
    return this.loadJobMemoryFromStorage(fileId);
  }

  public saveJobMemory(memory: AIJobMemory): void {
    const cloned = cloneJobMemory(memory);
    this.memoryCache.set(memory.fileId, cloned);
    this.storage.set(`${MEMORY_STORAGE_PREFIX}${memory.fileId}`, cloned);
  }

  public removeJobMemory(fileId: string): void {
    this.memoryCache.delete(fileId);
    this.storage.remove(`${MEMORY_STORAGE_PREFIX}${fileId}`);
  }

  public clearAll(): void {
    this.sessionCache.clear();
    this.memoryCache.clear();
    this.storage.remove(SESSIONS_STORAGE_KEY);
    this.storage.clearByPrefix(MEMORY_STORAGE_PREFIX);
  }

  private loadAllSessionsFromStorage(): void {
    const rawList = this.storage.get<CustomerJobSessionMetadata[]>(SESSIONS_STORAGE_KEY);
    if (Array.isArray(rawList)) {
      rawList.forEach((session) => {
        if (session && typeof session.jobSessionId === 'string') {
          this.sessionCache.set(session.jobSessionId, cloneSession(session));
        }
      });
    }
  }

  private persistSessions(): void {
    const list = Array.from(this.sessionCache.values()).map((s) => cloneSession(s));
    this.storage.set(SESSIONS_STORAGE_KEY, list);
  }

  private loadJobMemoryFromStorage(fileId: string): AIJobMemory | null {
    const raw = this.storage.get<AIJobMemory>(`${MEMORY_STORAGE_PREFIX}${fileId}`);
    if (raw && typeof raw.fileId === 'string') {
      const cloned = cloneJobMemory(raw);
      this.memoryCache.set(fileId, cloned);
      return cloneJobMemory(cloned);
    }
    return null;
  }
}
