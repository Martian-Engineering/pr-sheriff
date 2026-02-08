/**
 * Extract same-repo issue/PR references from an arbitrary text blob.
 *
 * Supported patterns:
 * - "#123" (shorthand, same repo)
 * - "owner/repo#123" (fully qualified, only if matches owner/repo)
 * - "https://github.com/owner/repo/issues/123" (same repo)
 * - "https://github.com/owner/repo/pull/123" (same repo)
 *
 * This function is pure and does not call the network.
 *
 * @param {string | null | undefined} text
 * @param {{ owner: string, repo: string }} repo
 * @returns {number[]} sorted unique referenced numbers
 */
export function extractReferencedNumbers(text, { owner, repo }) {
  if (!text) return [];
  const repoFull = `${owner}/${repo}`;

  /** @type {Set<number>} */
  const out = new Set();

  // Same-repo shorthand references: "#123", but avoid matching within identifiers like "foo#123bar".
  for (const m of String(text).matchAll(/(^|[^A-Za-z0-9_])#(\d+)\b/g)) {
    const num = Number.parseInt(m[2], 10);
    if (Number.isFinite(num) && num > 0) out.add(num);
  }

  // Fully-qualified references: "owner/repo#123"
  for (const m of String(text).matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g)) {
    if (m[1] !== repoFull) continue;
    const num = Number.parseInt(m[2], 10);
    if (Number.isFinite(num) && num > 0) out.add(num);
  }

  // GitHub URLs: ".../issues/123" or ".../pull/123"
  for (const m of String(text).matchAll(/https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\b/g)) {
    if (`${m[1]}/${m[2]}` !== repoFull) continue;
    const num = Number.parseInt(m[4], 10);
    if (Number.isFinite(num) && num > 0) out.add(num);
  }

  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Extract referenced numbers from a PR body and its comments.
 *
 * @param {{ body?: string | null } | null | undefined} pr
 * @param {{ body?: string | null }[] | null | undefined} comments
 * @param {{ owner: string, repo: string }} repo
 * @returns {number[]}
 */
export function extractReferencedNumbersFromPRAndComments(pr, comments, repo) {
  const parts = [];
  parts.push(pr?.body ?? "");
  for (const c of comments ?? []) {
    parts.push(c?.body ?? "");
  }
  return extractReferencedNumbers(parts.join("\n\n"), repo);
}

