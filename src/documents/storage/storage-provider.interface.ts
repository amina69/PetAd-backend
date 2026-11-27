export interface PutOptions {
  kind?: string;
  contentType?: string;
  metadata?: Record<string, string>;
  private?: boolean;
}

export interface PutResult {
  key: string;
  url: string;
  provider: string;
}

export interface StorageProvider {
  put(buffer: Buffer, key: string, options?: PutOptions): Promise<PutResult>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}
