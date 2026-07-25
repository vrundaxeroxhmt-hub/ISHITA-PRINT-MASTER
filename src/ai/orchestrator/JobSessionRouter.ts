import type {
  ActiveOperationalJobState,
  CustomerJobSessionMetadata,
  PreProcessingJobState,
  TerminalCustomerJobState,
} from '../types.ts';
import { AIJobMemoryStore } from '../memory/AIJobMemoryStore.ts';
import { getAISettings } from '../memory/AISettingsStore.ts';
import { createJobSessionId } from '../utils/createJobSessionId.ts';

export interface RouteFileRequest {
  customerId: string;
  fileId: string;
  receivedAt?: number;
}

export interface RouteFileResult {
  jobSessionId: string;
  isNewSessionCreated: boolean;
  batchRevision: number;
  sessionState: CustomerJobSessionMetadata['state'];
}

export const PRE_PROCESSING_STATES: ReadonlySet<PreProcessingJobState> = new Set([
  'COLLECTING_FILES',
  'WAITING_COMPLETION_WINDOW',
  'READY_FOR_PROCESSING',
  'QUEUED',
]);

export const ACTIVE_OPERATIONAL_STATES: ReadonlySet<ActiveOperationalJobState> = new Set([
  'PROCESSING_ACTIVE',
  'PDF_GENERATING',
  'AUTO_PROCESSING_COMPLETE',
  'IN_REVIEW',
  'IN_PRINT',
]);

export const TERMINAL_STATES: ReadonlySet<TerminalCustomerJobState> = new Set([
  'PRINTED',
  'COMPLETED',
  'CANCELLED',
]);

export class JobSessionRouter {
  private memoryStore: AIJobMemoryStore;

  constructor(memoryStore: AIJobMemoryStore = AIJobMemoryStore.getInstance()) {
    this.memoryStore = memoryStore;
  }

  public routeIncomingFile(request: RouteFileRequest): RouteFileResult {
    const receivedAt = request.receivedAt ?? Date.now();
    const settings = getAISettings();
    const latestSession = this.memoryStore.getLatestCustomerJobSession(request.customerId);

    // No existing session -> Create New Session
    if (!latestSession) {
      return this.createNewSession(request.customerId, receivedAt, settings.customerJobSessionTimeoutMinutes);
    }

    const state = latestSession.state;

    // Rule 1 — Terminal Job always creates a new session
    if (TERMINAL_STATES.has(state as TerminalCustomerJobState)) {
      return this.createNewSession(request.customerId, receivedAt, settings.customerJobSessionTimeoutMinutes);
    }

    // Rule 2 — Active Operational Job always keeps the same session (10m timeout bypassed)
    if (ACTIVE_OPERATIONAL_STATES.has(state as ActiveOperationalJobState)) {
      return this.appendToSession(latestSession, receivedAt);
    }

    // Rule 3 — Timeout applies only to Pre-Processing Job States
    if (PRE_PROCESSING_STATES.has(state as PreProcessingJobState)) {
      const minutesSinceLastFile = (receivedAt - latestSession.lastFileReceivedAt) / (1000 * 60);
      if (minutesSinceLastFile > settings.customerJobSessionTimeoutMinutes) {
        return this.createNewSession(request.customerId, receivedAt, settings.customerJobSessionTimeoutMinutes);
      }
      return this.appendToSession(latestSession, receivedAt);
    }

    // Fallback: create new session
    return this.createNewSession(request.customerId, receivedAt, settings.customerJobSessionTimeoutMinutes);
  }

  private createNewSession(
    customerId: string,
    receivedAt: number,
    timeoutMinutes: number
  ): RouteFileResult {
    const jobSessionId = createJobSessionId();
    const newSession: CustomerJobSessionMetadata = {
      jobSessionId,
      customerId,
      startedAt: receivedAt,
      firstFileReceivedAt: receivedAt,
      lastFileReceivedAt: receivedAt,
      sessionTimeoutMinutes: timeoutMinutes,
      state: 'COLLECTING_FILES',
      currentPdfRevision: 1,
      pdfRevisions: [],
      printedAt: null,
    };

    this.memoryStore.saveJobSession(newSession);

    return {
      jobSessionId,
      isNewSessionCreated: true,
      batchRevision: 1,
      sessionState: 'COLLECTING_FILES',
    };
  }

  private appendToSession(
    session: CustomerJobSessionMetadata,
    receivedAt: number
  ): RouteFileResult {
    const updatedSession: CustomerJobSessionMetadata = {
      ...session,
      lastFileReceivedAt: Math.max(session.lastFileReceivedAt, receivedAt),
    };

    // If job was already in a complete/review state, increment batch revision if needed
    if (session.state === 'AUTO_PROCESSING_COMPLETE' || session.state === 'IN_REVIEW') {
      updatedSession.currentPdfRevision = session.currentPdfRevision + 1;
    }

    this.memoryStore.saveJobSession(updatedSession);

    return {
      jobSessionId: updatedSession.jobSessionId,
      isNewSessionCreated: false,
      batchRevision: updatedSession.currentPdfRevision,
      sessionState: updatedSession.state,
    };
  }
}
