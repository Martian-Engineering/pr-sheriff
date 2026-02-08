/**
 * Robust parsing helpers for JSON-only LLM outputs.
 *
 * Models occasionally wrap JSON in markdown fences or add prefatory text.
 * These helpers aim to recover the JSON object without being too clever.
 */

function stripUtf8Bom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * If the text contains a markdown code fence, return the first fenced block's content.
 * Otherwise return the original string.
 *
 * Supports ``` and ~~~ fences, optionally annotated with "json".
 *
 * @param {string} text
 * @returns {string}
 */
export function stripFirstCodeFence(text) {
  const t = stripUtf8Bom(text).trim();
  const fenceMatch = t.match(/^(?:```|~~~)[^\n]*\n([\s\S]*?)\n(?:```|~~~)\s*$/m);
  if (fenceMatch && fenceMatch[1] !== undefined) return fenceMatch[1].trim();
  return t;
}

/**
 * Try to parse JSON from model output:
 * - strip code fences
 * - try JSON.parse on the whole string
 * - if that fails, try substring between first "{" and last "}"
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonFromModelText(text) {
  const stripped = stripFirstCodeFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    // Fall through
  }

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = stripped.slice(start, end + 1);
    return JSON.parse(candidate);
  }

  // Let JSON.parse throw a useful error message on the original stripped content.
  return JSON.parse(stripped);
}

