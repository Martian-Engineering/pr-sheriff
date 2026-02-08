function stripAnsiAndOsc(s: string): string {
  // Strip ANSI CSI sequences and OSC sequences (qmd prints OSC 9;4 during rerank).
  // Keep this tiny; we only need "good enough" sanitization for JSON parsing.
  return s
    .replace(/\u001b\][^\u0007]*\u0007/g, "") // OSC ... BEL
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "") // CSI
    .replace(/\u001b\([A-Za-z]/g, ""); // charset selection
}

/**
 * Parse qmd `--json` output.
 *
 * qmd may print progress lines before the JSON, and in "no results" cases may
 * print no JSON at all. This helper returns [] when no JSON array/object is
 * found.
 */
export function parseQmdJsonOutput(raw: string): unknown[] {
  const cleaned = stripAnsiAndOsc(raw ?? "").trim();
  if (!cleaned) return [];

  const firstArray = cleaned.indexOf("[");
  const firstObj = cleaned.indexOf("{");
  const start =
    firstArray === -1 ? firstObj : firstObj === -1 ? firstArray : Math.min(firstArray, firstObj);

  if (start === -1) return [];
  const jsonPart = cleaned.slice(start);

  const parsed = JSON.parse(jsonPart) as unknown;
  if (Array.isArray(parsed)) return parsed;
  return [parsed];
}

