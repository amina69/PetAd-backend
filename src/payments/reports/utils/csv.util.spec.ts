import { sanitizeCsvCell, toCsv } from './csv.util';

describe('CSV export safety', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-1+1', '@SUM(A1)', '  =cmd'])(
    'neutralises a cell starting with a formula trigger: %s',
    (value) => {
      expect(sanitizeCsvCell(value)).toMatch(/^'/);
    },
  );

  it('quotes separators and embedded quotes', () => {
    expect(sanitizeCsvCell('hello, "world"')).toBe('"hello, ""world"""');
  });

  it('collapses newlines to prevent row injection', () => {
    expect(sanitizeCsvCell('=cmd\r\nrow2')).toBe("'=cmd row2");
  });

  it('renders rows with CRLF separators', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
  });
});
