export type ProviderTaskStatus = "queued" | "processing" | "succeeded" | "failed" | "unknown";

export interface ProviderTaskResult {
  status: ProviderTaskStatus;
  progress?: number;
  outputUrls: string[];
  error?: string;
  raw: unknown;
}

export interface ProviderInlineImage {
  buffer: Buffer;
  mimeType: string;
}

export interface ProviderTaskCreation {
  providerTaskId?: string;
  inlineOutput?: ProviderInlineImage;
  raw: unknown;
}

export type ProviderParameters = Record<string, string | number | boolean>;

export interface ImageProvider {
  createTextTask(input: {
    prompt: string;
    size: string;
    parameters?: ProviderParameters;
  }): Promise<ProviderTaskCreation>;

  createEditTask(input: {
    prompt: string;
    size: string;
    imageUrls: string[];
    parameters?: ProviderParameters;
  }): Promise<ProviderTaskCreation>;

  getTask(providerTaskId: string): Promise<ProviderTaskResult>;
}

export class ProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly ambiguous: boolean;
  readonly retryAfterSeconds?: number;

  constructor(options: {
    code: string;
    message: string;
    status?: number;
    retryable: boolean;
    ambiguous: boolean;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = "ProviderError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.ambiguous = options.ambiguous;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
