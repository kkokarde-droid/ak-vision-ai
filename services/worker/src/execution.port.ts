export interface GenerationExecutionResult {
  success: boolean;
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface GenerationExecutionContext {
  jobId: string;
  requestId: string;
  workerId: string;
}

export interface GenerationExecutionPort {
  execute(
    context: GenerationExecutionContext,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<GenerationExecutionResult>;
}