export type CorpusFrontmatter = {
  schema?: string;
  doc_type?: string;
  repo?: string;
  number?: number;
  title?: string;
  state?: string;
  url?: string;
  updated_at?: string;
  merged?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  labels?: string[];
};

function parseScalar(v: string): unknown {
  const raw = v.trim();
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('"') || raw.startsWith("'")) {
    // Indexer writes JSON-style quoted strings.
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

/**
 * Parse the YAML frontmatter at the top of a corpus doc.
 *
 * The corpus indexer emits a simple YAML subset (scalars + string lists),
 * so we keep parsing minimal and dependency-free.
 */
export function parseCorpusFrontmatter(markdown: string): CorpusFrontmatter | null {
  const lines = String(markdown ?? "").split(/\r?\n/);
  if (lines[0] !== "---") return null;

  const out: Record<string, unknown> = {};

  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "---") break;
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const m = /^([A-Za-z0-9_]+):(.*)$/.exec(line);
    if (!m) continue;

    const key = m[1]!;
    const rest = (m[2] ?? "").trim();

    // Inline list: labels: []
    if (rest === "[]") {
      out[key] = [];
      continue;
    }

    // Start of a block list:
    // labels:
    //   - "foo"
    if (rest === "") {
      const items: string[] = [];
      const baseIndent = (lines[i + 1] ?? "").match(/^\s*/)?.[0]?.length ?? 0;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? "";
        if (l === "---") break;
        if (!l.trim()) continue;
        const indent = l.match(/^\s*/)?.[0]?.length ?? 0;
        if (indent < baseIndent) break;

        const itemMatch = /^\s*-\s+(.*)$/.exec(l);
        if (!itemMatch) break;
        const itemVal = parseScalar(itemMatch[1] ?? "");
        if (typeof itemVal === "string") items.push(itemVal);
      }
      out[key] = items;
      continue;
    }

    out[key] = parseScalar(rest);
  }

  if (i >= lines.length) return null;
  return out as CorpusFrontmatter;
}

