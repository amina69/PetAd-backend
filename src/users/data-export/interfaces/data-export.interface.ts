export interface AssembledUserData {
  exportedAt: string;
  userId: string;
  profile: Record<string, any>;
  adoptions: Record<string, any>[];
  custody: Record<string, any>[];
  documents: Record<string, any>[];
  messages: Record<string, any>[];
  events: Record<string, any>[];
}

export interface SignedUrlResult {
  downloadUrl: string;
  expiresAt: Date;
}
