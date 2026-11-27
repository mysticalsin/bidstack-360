/**
 * The contacts list export prefixes an apostrophe when a cell starts with
 * + = - @ so a spreadsheet does not run it as a formula. Every demo phone
 * starts with +. Pasting that file back has to keep the number the list
 * printed. An apostrophe that is not that escape stays, so a name is not
 * rewritten into a phone.
 */
const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

export function restoreExportedContactCell(value: string): string {
  if (value.startsWith("'") && value.length > 1 && FORMULA_START.has(value[1] ?? '')) {
    return value.slice(1);
  }
  return value;
}
