const FORMULA_START = /^(=|\+|-|@|\t|\r)/;
// A signed decimal is a number in Excel, Sheets, and LibreOffice. Prefixing it
// forces the cell to text, so SUM skips a loss and a re-import keeps the apostrophe.
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Prefix a spreadsheet formula so the cell is text. A plain signed number is
 * left alone. `-1+1` is still prefixed. `=cmd` is still prefixed.
 */
export function spreadsheetCell(value: string): string {
  if (PLAIN_NUMBER.test(value)) return value;
  return value.replace(FORMULA_START, "'$1");
}
