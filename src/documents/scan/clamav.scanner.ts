import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Scanner, ScanResult } from './scanner.interface';
import * as net from 'net';

@Injectable()
export class ClamAVScanner implements Scanner {
  private readonly logger = new Logger(ClamAVScanner.name);
  private readonly host: string;
  private readonly port: number;

  constructor(private readonly configService: ConfigService) {
    this.host = this.configService.get<string>('CLAMAV_HOST') || 'localhost';
    this.port = parseInt(this.configService.get<string>('CLAMAV_PORT') || '3310', 10);
  }

  async scanBuffer(buffer: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let dataResponse = '';

      client.setTimeout(10000);

      client.connect(this.port, this.host, () => {
        // INSTREAM protocol command
        client.write('zINSTREAM\0');
        const chunkSize = 2048;
        for (let i = 0; i < buffer.length; i += chunkSize) {
          const chunk = buffer.subarray(i, i + chunkSize);
          const sizeHeader = Buffer.alloc(4);
          sizeHeader.writeInt32BE(chunk.length, 0);
          client.write(sizeHeader);
          client.write(chunk);
        }
        const zeroHeader = Buffer.alloc(4);
        zeroHeader.writeInt32BE(0, 0);
        client.write(zeroHeader);
      });

      client.on('data', (data) => {
        dataResponse += data.toString();
      });

      client.on('close', () => {
        if (dataResponse.includes('FOUND')) {
          const match = dataResponse.match(/stream: (.+) FOUND/);
          const virusName = match ? match[1] : 'Unknown virus';
          resolve({ isInfected: true, viruses: [virusName] });
        } else if (dataResponse.includes('OK')) {
          resolve({ isInfected: false });
        } else {
          reject(new Error(`Unexpected ClamAV response: ${dataResponse}`));
        }
      });

      client.on('timeout', () => {
        client.destroy();
        reject(new Error('ClamAV scan timeout'));
      });

      client.on('error', (err) => {
        client.destroy();
        reject(err);
      });
    });
  }
}
