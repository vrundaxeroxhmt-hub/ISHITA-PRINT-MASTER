import type { AIExecutionMode, DocumentPairingResult, WorkflowSuggestionResult } from '../types.ts';

export type TokenResolver = () => Promise<string | null>;

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly mode: AIExecutionMode;
  isAvailable(): Promise<boolean>;
  setTokenResolver?(resolver: TokenResolver): void;
  pairDocuments(documents: unknown[]): Promise<DocumentPairingResult>;
  suggestWorkflow(input: unknown, context?: Record<string, unknown>): Promise<WorkflowSuggestionResult>;
}
