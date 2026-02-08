import type { AppConfig } from "../config/types.js";
import type { QmdRunner } from "../qmd/types.js";
import { runQmd } from "../qmd/runQmd.js";
import { parseQmdJsonOutput } from "../qmd/parseQmdJson.js";
import { parseCorpusFrontmatter } from "./parseFrontmatter.js";

export type QmdQueryHit = {
  docid?: string;
  score?: number;
  file?: string;
  title?: string;
  snippet?: string;
};

export type Candidate = {
  rank: number;
  qmd: {
    docid: string | null;
    score: number | null;
    file: string;
    snippet: string | null;
  };
  corpus: {
    repo: string | null;
    number: number | null;
    docType: string | null;
    title: string | null;
    url: string | null;
    updatedAt: string | null;
    mergedAt: string | null;
  };
};

export type CandidateRetrievalError =
  | { code: "QMD_COLLECTION_NOT_FOUND"; message: string; collection: string }
  | { code: "QMD_QUERY_FAILED"; message: string };

export type RetrieveCandidatesResult = {
  candidates: Candidate[];
  error: CandidateRetrievalError | null;
};

function parseCorpusPathFromQmdFile(file: string): { repo: string | null; type: string | null; number: number | null } {
  // Expected corpus path: <owner>/<repo>/<type>/<number>.md
  // qmd file can be: qmd://<collection>/<path>
  const s = String(file ?? "");
  const withoutScheme = s.startsWith("qmd://") ? s.slice("qmd://".length) : s;
  const parts = withoutScheme.split("/").filter(Boolean);

  // If scheme was present, first path segment is the collection name.
  const idx = s.startsWith("qmd://") ? 1 : 0;
  const owner = parts[idx] ?? null;
  const repoName = parts[idx + 1] ?? null;
  const type = parts[idx + 2] ?? null;
  const numPart = parts[idx + 3] ?? null;

  const number = numPart ? Number(numPart.replace(/\.md$/, "")) : null;
  const repo = owner && repoName ? `${owner}/${repoName}` : null;
  return {
    repo,
    type,
    number: Number.isFinite(number as number) ? (number as number) : null
  };
}

async function getCorpusFrontmatterForFile(
  qmdRunner: QmdRunner,
  file: string
): Promise<ReturnType<typeof parseCorpusFrontmatter>> {
  const res = await qmdRunner(["get", file, "-l", "120"]);
  if (res.exitCode !== 0) return null;
  return parseCorpusFrontmatter(res.stdout);
}

/**
 * Retrieve candidate corpus docs for a target summary using `qmd query`.
 *
 * This is the "first pass" retrieval layer feeding later reranking/LLM steps.
 * It is designed to degrade gracefully when the qmd collection is missing.
 */
export async function retrieveCandidates(opts: {
  summary: string;
  n: number;
  config: Pick<AppConfig, "qmdCollection" | "qmdIndex">;
  qmdRunner?: QmdRunner;
}): Promise<RetrieveCandidatesResult> {
  const qmdRunner = opts.qmdRunner ?? runQmd;
  const collection = opts.config.qmdCollection;

  const baseArgs: string[] = [];
  if (opts.config.qmdIndex) baseArgs.push("--index", opts.config.qmdIndex);

  const queryArgs = [...baseArgs, "query", opts.summary, "-c", collection, "--json", "-n", String(opts.n)];
  const q = await qmdRunner(queryArgs);

  if (q.exitCode !== 0) {
    const combined = `${q.stdout}\n${q.stderr}`.trim();
    if (combined.includes("Collection not found:")) {
      return {
        candidates: [],
        error: {
          code: "QMD_COLLECTION_NOT_FOUND",
          message: `qmd collection not found: ${collection}`,
          collection
        }
      };
    }
    return {
      candidates: [],
      error: { code: "QMD_QUERY_FAILED", message: combined || "qmd query failed" }
    };
  }

  const hitsRaw = parseQmdJsonOutput(q.stdout);
  const hits = hitsRaw as QmdQueryHit[];
  const candidates: Candidate[] = [];

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i] ?? {};
    if (!hit.file) continue;

    const fm = await getCorpusFrontmatterForFile(qmdRunner, hit.file);
    const fromPath = parseCorpusPathFromQmdFile(hit.file);

    const repo = fm?.repo ?? fromPath.repo;
    const number = typeof fm?.number === "number" ? fm.number : fromPath.number;
    const docType = fm?.doc_type ?? null;

    candidates.push({
      rank: candidates.length + 1,
      qmd: {
        docid: hit.docid ?? null,
        score: typeof hit.score === "number" ? hit.score : null,
        file: hit.file,
        snippet: hit.snippet ?? null
      },
      corpus: {
        repo,
        number,
        docType,
        title: fm?.title ?? hit.title ?? null,
        url: fm?.url ?? null,
        updatedAt: fm?.updated_at ?? null,
        mergedAt: fm?.merged_at ?? null
      }
    });
  }

  return { candidates, error: null };
}

