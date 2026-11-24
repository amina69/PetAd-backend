/**
 * Envelope every realtime event carries. It is identical to the schema used
 * for REST-delivered notifications so a client can handle both transports
 * with one code path.
 */
export interface RealtimeEnvelope<T = unknown> {
  id: string;
  type: string;
  data: T;
  at: string;
}

/**
 * Minimal surface other modules need from the realtime layer. Kept as an
 * interface so consumers (e.g. the notification dispatcher) never depend on
 * the socket.io gateway directly.
 */
export interface RealtimePublisher {
  publishToUser(userId: string, type: string, data: unknown): void;
}

export const REALTIME_PUBLISHER = Symbol('REALTIME_PUBLISHER');
