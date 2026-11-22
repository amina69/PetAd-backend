export function assertId(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

export function dateMilliseconds(value: unknown, name: string): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${name} must be a valid Date`);
  }
  return value.getTime();
}

export function assertSeverity(value: unknown, name: string): void {
  if (value !== 'ordinary' && value !== 'severe') {
    throw new Error(`${name} must be ordinary or severe`);
  }
}

export function assertFiniteNumber(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}
