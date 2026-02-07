/**
 * Print JSON to stdout.
 *
 * The CLI contract for this scaffold is "JSON only to stdout", including errors.
 */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

