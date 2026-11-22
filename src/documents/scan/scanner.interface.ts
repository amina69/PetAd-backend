export interface ScanResult {
  isInfected: boolean;
  viruses?: string[];
}

export interface Scanner {
  scanBuffer(buffer: Buffer): Promise<ScanResult>;
}

export const SCANNER_TOKEN = 'SCANNER_TOKEN';
