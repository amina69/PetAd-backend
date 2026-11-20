import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Auth is mandatory in production; missing credentials fail closed everywhere. */
export function metricsBasicAuth(username: string | undefined, password: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!username || !password) {
      res.status(503).send('Metrics are not configured');
      return;
    }
    const header = req.get('authorization') ?? '';
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header);
    if (!match) {
      res.setHeader('WWW-Authenticate', 'Basic realm="metrics"');
      res.status(401).send('Unauthorized');
      return;
    }
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const delimiter = decoded.indexOf(':');
    const suppliedUser = delimiter === -1 ? '' : decoded.slice(0, delimiter);
    const suppliedPass = delimiter === -1 ? '' : decoded.slice(delimiter + 1);
    if (!equal(suppliedUser, username) || !equal(suppliedPass, password)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="metrics"');
      res.status(401).send('Unauthorized');
      return;
    }
    next();
  };
}
