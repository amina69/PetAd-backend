export function canonicalJSON(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSON).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined) {
      parts.push(JSON.stringify(k) + ':' + canonicalJSON(v));
    }
  }
  return '{' + parts.join(',') + '}';
}
