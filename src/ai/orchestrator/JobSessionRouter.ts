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
    const windowMs = (settings.customerCompletionWindowSeconds || 45) * 1000;
    const latestSession = this.memoryStore.getLatestCustomerJobSession(request.customerId);

    // Rule 1 — No existing session -> Create New Session
    if (!latestSession) {
      console.log(`[JobSessionRouter] No existing session for ${request.customerId} -> Creating new session`);
      return this.createNewSession(request.customerId, receivedAt, windowMs);
    }

    const state = latestSession.state;

    // Rule 2 — Explicitly Sealed Session or Terminal Job -> Create New Session
    if (latestSession.isSealed === true || TERMINAL_STATES.has(state as TerminalCustomerJobState)) {
      console.log(`[JobSessionRouter] Session ${latestSession.jobSessionId} is sealed/terminal -> Creating new session`);
      return this.createNewSession(request.customerId, receivedAt, windowMs);
    }

    // Rule 3 — Safe Completion Window Boundary Check
    const openedAt = Number.isFinite(latestSession.completionWindowOpenedAt)
      ? latestSession.completionWindowOpenedAt!
      : latestSession.firstFileReceivedAt;

    const closesAt = Number.isFinite(latestSession.completionWindowClosesAt)
      ? latestSession.completionWindowClosesAt!
      : (openedAt + windowMs);

    if (receivedAt >= closesAt) {
      console.log(`[JobSessionRouter] Window closed for session ${latestSession.jobSessionId} (receivedAt: ${receivedAt} >= closesAt: ${closesAt}) -> Creating new session`);
      return this.createNewSession(request.customerId, receivedAt, windowMs);
    }

    // Rule 4 — Active Operational / Complete Job outside collecting window -> Create New Session
    if (ACTIVE_OPERATIONAL_STATES.has(state as ActiveOperationalJobState) && state !== 'COLLECTING_FILES' && state !== 'WAITING_COMPLETION_WINDOW') {
      console.log(`[JobSessionRouter] Session ${latestSession.jobSessionId} is active/complete -> Creating new session`);
      return this.createNewSession(request.customerId, receivedAt, windowMs);
    }

    // Rule 5 — Inside active fixed completion window -> Append to open session
    console.log(`[JobSessionRouter] Appending file ${request.fileId} to open session ${latestSession.jobSessionId}`);
    return this.appendToSession(latestSession, receivedAt);
  }

  private createNewSession(
    customerId: string,
    receivedAt: number,
    windowMs: number
  ): RouteFileResult {
    const jobSessionId = createJobSessionId();
    const closesAt = receivedAt + windowMs;
    const newSession: CustomerJobSessionMetadata = {
      jobSessionId,
      customerId,
      startedAt: receivedAt,
      firstFileReceivedAt: receivedAt,
      lastFileReceivedAt: receivedAt,
      completionWindowOpenedAt: receivedAt,
      completionWindowClosesAt: closesAt,
      isSealed: false,
      sessionTimeoutMinutes: windowMs / (60 * 1000),
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
