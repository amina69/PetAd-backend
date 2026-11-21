/**
 * Prefix formula-triggering cells so spreadsheet software treats them as
 * literal text. Also collapses newlines to prevent row injection.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value).replace(/[\r\n]+/g, ' ');
  if (/^\s*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows
    .map((row) => row.map(sanitizeCsvCell).join(','))
    .join('\r\n');
}
