export interface StorageUploadInput {
  key: string;
  body: ArrayBuffer;
  contentType: string;
  cacheControl?: string;
}

export interface StorageDownloadResult {
  body: ArrayBuffer;
  contentType: string;
}

export interface StorageProvider {
  upload(input: StorageUploadInput): Promise<void>;
  createSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  download(key: string): Promise<StorageDownloadResult>;
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}
