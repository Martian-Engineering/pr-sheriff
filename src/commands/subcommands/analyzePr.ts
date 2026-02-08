import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { CommandContext } from "../../types/context.js";
import { GitHubFetch } from "../../github/index.mjs";

type AnalyzePrReference = {
  kind: "issue";
  owner: string;
  repo: string;
  number: number;
  url: string | null;
  source: "pr" | "comment";
};

type AnalyzePrCandidate = {
  number: number;
  title: string | null;
  url: string | null;
  source: "merged_search" | "reference_chain";
};

function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Accept `YYYY-MM-DD` or full ISO timestamps.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return null;
}

function uniqNumbers(nums: number[]): number[] {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/**
 * Extract `#123`, PR URLs, and issue URLs from text.
 *
 * Notes:
 * - We keep the extraction intentionally permissive (false positives are OK).
 * - Downstream logic uses `getIssue()` to determine if a `#123` is a PR.
 */
function extractIssueNumbersFromText(text: string, owner: string, repo: string): number[] {
  const out: number[] = [];
  const add = (nRaw: string | undefined) => {
    if (!nRaw) return;
    const n = Number(nRaw);
    if (!Number.isFinite(n) || n <= 0) return;
    out.push(n);
  };

  // `#123`
  for (const m of text.matchAll(/(^|[^A-Za-z0-9_])#(\d+)\b/g)) add(m[2]);

  // `owner/repo#123`
  for (const m of text.matchAll(/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/g)) {
    if (m[1] === owner && m[2] === repo) add(m[3]);
  }

  // Full GitHub URLs.
  for (const m of text.matchAll(/https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)\b/g)) {
    if (m[1] === owner && m[2] === repo) add(m[4]);
  }

  return uniqNumbers(out);
}

function pickKeywordQuery(title: unknown): string {
  if (typeof title !== "string" || title.trim().length === 0) return "";
  const stop = new Set(["the", "and", "for", "with", "from", "into", "this", "that", "fix", "adds", "add"]);
  const parts = title
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((p) => p.length >= 4 && !stop.has(p));
  const uniq = Array.from(new Set(parts)).slice(0, 6);
  if (uniq.length === 0) return "";
  // Keep it simple: search in title only.
  return `in:title ${uniq.join(" ")}`;
}

async function readFixture(fixturesDir: string, filename: string): Promise<string> {
  const p = path.join(fixturesDir, filename);
  return await fs.readFile(p, "utf8");
}

/**
 * Create a `ghRunner` compatible stub backed by `.http` fixtures.
 *
 * Supported endpoints:
 * - `GET /repos/<owner>/<repo>/pulls/<n>`
 * - `GET /repos/<owner>/<repo>/issues/<n>`
 * - `GET /repos/<owner>/<repo>/issues/<n>/comments`
 * - `GET /repos/<owner>/<repo>/pulls/<n>/comments`
 * - `GET /search/issues`
 */
function makeFixtureGhRunner(fixturesDir: string) {
  return async (args: string[]) => {
    const isGraphql = args[0] === "api" && args[1] === "graphql";
    if (isGraphql) {
      throw new Error("fixtures runner does not support GraphQL in analyze-pr dry mode");
    }

    const endpoint = args[args.length - 1] ?? "";
    const methodIdx = args.indexOf("-X");
    const method = methodIdx >= 0 ? args[methodIdx + 1] : "GET";
    if (method !== "GET") throw new Error(`fixtures runner only supports GET (got ${method || "unknown"})`);

    const url = endpoint.startsWith("http") ? new URL(endpoint) : null;
    const [rawPath, rawQuery] = url ? [url.pathname, url.search.slice(1)] : endpoint.split("?", 2);
    const pathname = rawPath ?? "";
    const searchParams = url ? url.searchParams : new URLSearchParams(rawQuery ?? "");
    const page = searchParams.get("page") ?? "1";

    let fixtureName: string | null = null;

    const mPull = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/.exec(pathname);
    if (mPull) fixtureName = `rest_get_pr_${mPull[3]}.http`;

    const mIssue = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(pathname);
    if (!fixtureName && mIssue) fixtureName = `rest_get_issue_${mIssue[3]}.http`;

    const mIssueComments = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/.exec(pathname);
    if (!fixtureName && mIssueComments) fixtureName = `rest_issue_comments_${mIssueComments[3]}_page${page}.http`;

    const mReviewComments = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/.exec(pathname);
    if (!fixtureName && mReviewComments) fixtureName = `rest_review_comments_${mReviewComments[3]}_page${page}.http`;

    if (!fixtureName && pathname === "/search/issues") fixtureName = `rest_search_issues_page${page}.http`;

    if (!fixtureName) {
      throw new Error(`fixtures runner has no mapping for endpoint: ${endpoint}`);
    }

    const stdout = await readFixture(fixturesDir, fixtureName);
    return { exitCode: 0, stdout, stderr: "" };
  };
}

export async function analyzePr(argv: string[], _ctx: CommandContext): Promise<unknown> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      owner: { type: "string" },
      repo: { type: "string" },
      pr: { type: "string" },
      "pr-url": { type: "string" },
      "dry-fixtures": { type: "string" },
      "no-cache": { type: "boolean" },
      help: { type: "boolean", short: "h" }
    }
  });

  if (parsed.values.help) {
    return {
      help: {
        usage:
          "pr-sheriff analyze-pr --owner OWNER --repo REPO --pr NUMBER [--pr-url URL] [--dry-fixtures DIR] [--no-cache]",
        options: ["--owner", "--repo", "--pr", "--pr-url", "--dry-fixtures", "--no-cache"]
      }
    };
  }

  const owner = parsed.values.owner;
  const repo = parsed.values.repo;
  const prRaw = parsed.values.pr;
  if (!owner || !repo || !prRaw) {
    throw new Error("Missing required options: --owner, --repo, --pr");
  }

  const pr = Number(prRaw);
  if (!Number.isFinite(pr) || pr <= 0) {
    throw new Error(`Invalid --pr value: ${prRaw}`);
  }

  const fixturesDir = parsed.values["dry-fixtures"] ?? null;
  const useCache = parsed.values["no-cache"] ? false : !fixturesDir;
  const ghRunner = fixturesDir ? makeFixtureGhRunner(fixturesDir) : undefined;

  // Note: `src/github/*.mjs` and `src/graph/*.mjs` are plain JS modules.
  // We use dynamic import to avoid TS type declaration friction.
  const [{ GitHubFetch }, { buildReferenceGraph }] = await Promise.all([
    import("../../github/index.mjs"),
    import("../../graph/index.mjs")
  ]);

  const gh = new GitHubFetch({ repo: `${owner}/${repo}`, ghRunner });

  // Always build the reference graph first; it provides high-signal candidates.
  const graph = await buildReferenceGraph({ gh, owner, repo, prNumber: pr });

  // Minimal candidate set based on merged search + (optional) graph-derived PRs.
  // NOTE: We keep the existing simple candidate logic as a baseline while the
  // graph builder evolves.

  const maxChainPRs = 10;
  const chainQueue: number[] = [pr];
  const visitedPRs = new Set<number>();

  /** References extracted from PRs and their comments. */
  const references: AnalyzePrReference[] = [];

  /** PR candidates and how they were discovered. */
  const candidates: AnalyzePrCandidate[] = [];

  let targetPR: any = null;
  let targetComments: any = null;

  for (let i = 0; i < chainQueue.length && visitedPRs.size < maxChainPRs; i++) {
    const cur = chainQueue[i]!;
    if (visitedPRs.has(cur)) continue;
    visitedPRs.add(cur);

    const prData = await gh.getPR(cur, { useCache });
    const comments = await gh.listPRComments(cur, { useCache });

    if (cur === pr) {
      targetPR = prData;
      targetComments = comments;
    }

    const prText = `${prData?.title ?? ""}\n\n${prData?.body ?? ""}`.trim();
    const commentTexts = (comments?.all ?? [])
      .map((c: any) => (typeof c?.body === "string" ? c.body : ""))
      .filter((s: string) => s.length > 0);

    const nums = uniqNumbers([
      ...extractIssueNumbersFromText(prText, owner, repo),
      ...commentTexts.flatMap((t: string) => extractIssueNumbersFromText(t, owner, repo))
    ]);

    for (const n of nums) {
      references.push({
        kind: "issue",
        owner,
        repo,
        number: n,
        url: null,
        source: n === pr ? "pr" : "comment"
      });
    }

    // Expand the chain using `getIssue()` to detect whether a `#n` is a PR.
    for (const n of nums) {
      if (n === cur) continue;
      if (visitedPRs.has(n)) continue;
      if (chainQueue.includes(n)) continue;

      const issue = await gh.getIssue(n, { useCache });
      const isPR = Boolean(issue && typeof issue === "object" && (issue as any).pull_request);
      if (isPR) {
        chainQueue.push(n);
        candidates.push({ number: n, title: (issue as any).title ?? null, url: (issue as any).html_url ?? null, source: "reference_chain" });
      }
    }
  }

  if (!targetPR) {
    throw new Error("Failed to load target PR");
  }

  // Baseline merged PR candidates: simple keyword search after the target PR's creation date.
  const mergedAfter = toIsoDate(targetPR?.created_at) ?? undefined;
  const query = pickKeywordQuery(targetPR?.title);
  const mergedItems = await gh.searchMergedPRs({ query, mergedAfter, useCache });

  for (const item of mergedItems.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    if (typeof (item as any).number !== "number") continue;
    candidates.push({
      number: (item as any).number,
      title: (item as any).title ?? null,
      url: (item as any).html_url ?? null,
      source: "merged_search"
    });
  }

  const candidateNumbers = uniqNumbers(candidates.map((c) => c.number));


  return {
    kind: "analyze-pr",
    input: {
      owner,
      repo,
      pr,
      prUrl: parsed.values["pr-url"] ?? null,
      dryFixturesDir: fixturesDir,
      useCache
    },
    status: "ok",
    target: {
      number: targetPR.number,
      title: targetPR.title ?? null,
      url: targetPR.html_url ?? null,
      state: targetPR.state ?? null,
      draft: targetPR.draft ?? null,
      createdAt: targetPR.created_at ?? null,
      updatedAt: targetPR.updated_at ?? null,
      author: targetPR.user?.login ?? null
    },
    comments: {
      counts: {
        issue: targetComments?.issueComments?.length ?? 0,
        review: targetComments?.reviewComments?.length ?? 0,
        all: targetComments?.all?.length ?? 0
      }
    },
    references: {
      issues: uniqNumbers(references.map((r) => r.number)).map((n) => ({ owner, repo, number: n }))
    },
    candidates: {
      numbers: candidateNumbers,
      items: candidates
    },
    judgeInput: {
      repo: `${owner}/${repo}`,
      target: {
        number: targetPR.number,
        title: targetPR.title ?? "",
        body: targetPR.body ?? "",
        comments: (targetComments?.all ?? []).map((c: any) => ({
          id: c.id ?? null,
          created_at: c.created_at ?? null,
          user: c.user?.login ?? null,
          body: c.body ?? ""
        }))
      },
      candidates: candidates
        .filter((c) => c.source === "merged_search")
        .slice(0, 50)
        .map((c) => ({ number: c.number, title: c.title ?? "", url: c.url }))
    },
    graph
  };
}
