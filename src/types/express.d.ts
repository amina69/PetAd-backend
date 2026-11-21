declare global {
  namespace Express {
    interface Request {
      user?: any;
      requestId?: string;
      rawBody?: Buffer;
    }
  }
}

export {};
