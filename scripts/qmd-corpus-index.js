#!/usr/bin/env node
/**
 * Index GitHub PRs/issues into an on-disk Markdown corpus and run `qmd` indexing.
 *
 * Uses `gh api` for GitHub access. This is intentionally dependency-free and
 * designed to be "good enough" until a shared GitHub fetch layer is finalized.
 *
 * Note: written as CommonJS so it can run without a package.json.
 */

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {Object} Args
 * @property {string} repo
 * @property {string} outDir
 * @property {Date | null} since
 * @property {boolean} includePulls
 * @property {boolean} includeIssues
 * @property {string} qmdCollection
 * @property {string | null} qmdIndex
 * @property {number} maxComments
 * @property {number} maxReviews
 * @property {number} limit
 * @property {boolean} dryRun
 */

/**
 * @param {string[]} argv
 * @returns {Args}
 */
function parseArgs(argv) {
  /** @type {Args} */
  const out = {
    repo: "",
    outDir: "docs/corpus",
    since: null,
    includePulls: true,
    includeIssues: true,
    qmdCollection: "pr-sheriff-corpus",
    qmdIndex: null,
    maxComments: 200,
    maxReviews: 200,
    limit: 0,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") out.repo = argv[++i] ?? "";
    else if (a === "--out") out.outDir = argv[++i] ?? out.outDir;
    else if (a === "--since") {
      const v = argv[++i];
      out.since = v ? new Date(v) : null;
    } else if (a === "--types") {
      const v = argv[++i] ?? "";
      const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
      out.includePulls = parts.includes("pr") || parts.includes("pull");
      out.includeIssues = parts.includes("issue");
    } else if (a === "--qmd-collection") out.qmdCollection = argv[++i] ?? out.qmdCollection;
    else if (a === "--qmd-index") out.qmdIndex = argv[++i] ?? out.qmdIndex;
    else if (a === "--max-comments") out.maxComments = Number(argv[++i] ?? out.maxComments);
    else if (a === "--max-reviews") out.maxReviews = Number(argv[++i] ?? out.maxReviews);
    else if (a === "--limit") out.limit = Number(argv[++i] ?? out.limit);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") usageAndExit(0);
    else {
      console.error(`Unknown arg: ${a}`);
      usageAndExit(2);
    }
  }

  if (!out.repo) {
    console.error("--repo is required (e.g. --repo Martian-Engineering/pr-sheriff)");
    usageAndExit(2);
  }

  if (out.since && Number.isNaN(out.since.getTime())) {
    console.error(`Invalid --since timestamp: ${argv.join(" ")}`);
    usageAndExit(2);
  }

  if (!Number.isFinite(out.maxComments) || out.maxComments < 0) {
    console.error("--max-comments must be a non-negative number");
    usageAndExit(2);
  }

  if (!Number.isFinite(out.maxReviews) || out.maxReviews < 0) {
    console.error("--max-reviews must be a non-negative number");
    usageAndExit(2);
  }

  if (!Number.isFinite(out.limit) || out.limit < 0) {
    console.error("--limit must be a non-negative number");
    usageAndExit(2);
  }

  if (!out.includePulls && !out.includeIssues) {
    console.error("--types must include at least one of: pr, issue");
    usageAndExit(2);
  }

  return out;
}

function usageAndExit(code) {
  console.log(`
Usage:
  node scripts/qmd-corpus-index.js --repo <owner/name> [options]

Options:
  --out <dir>                 Corpus root (default: docs/corpus)
  --since <ISO8601>           Only ingest items updated at/after this timestamp
  --types pr,issue            Which item types to ingest (default: pr,issue)
  --max-comments <n>          Max issue comments per item (default: 200)
  --max-reviews <n>           Max PR reviews per PR (default: 200)
  --limit <n>                 Only ingest the N most recently updated items
  --qmd-collection <name>     qmd collection name (default: pr-sheriff-corpus)
  --qmd-index <name>          qmd index name (passed as: qmd --index <name>)
  --dry-run                   Fetch + render only (no writes, no qmd)
  --help                      Show help

Examples:
  node scripts/qmd-corpus-index.js --repo OpenClaw/OpenClaw
  node scripts/qmd-corpus-index.js --repo OpenClaw/OpenClaw --since 2026-02-01T00:00:00Z
  node scripts/qmd-corpus-index.js --repo OpenClaw/OpenClaw --types pr --qmd-index pr-sheriff
`.trim());
  process.exit(code);
}

/**
 * @param {string} endpoint
 * @param {string[]} extraArgs
 * @returns {any}
 */
function ghApiJson(endpoint, extraArgs = []) {
  const args = ["api", endpoint, ...extraArgs];
  const out = execFileSync("gh", args, { encoding: "utf8" });
  return JSON.parse(out);
}

/**
 * Manual pagination so we can stop early when `--since` is used.
 *
 * @param {(page: number) => string} endpointForPage
 * @param {(items: any[]) => any[]} filterPage
 * @param {Date | null} since
 * @param {number | null} maxItems
 * @returns {any[]}
 */
function ghListAll(endpointForPage, filterPage, since, maxItems = null) {
  /** @type {any[]} */
  const all = [];

  for (let page = 1; ; page++) {
    const endpoint = endpointForPage(page);
    /** @type {any[]} */
    const items = ghApiJson(endpoint);
    if (!items.length) break;

    const filtered = filterPage(items);

    if (since) {
      for (const it of filtered) {
        if (!it.updated_at) continue;
        const updated = new Date(it.updated_at);
        if (!Number.isNaN(updated.getTime()) && updated >= since) all.push(it);
      }

      // If the last item on the page is older than `since`, earlier pages will
      // also be older because we're sorting by updated desc.
      const last = filtered[filtered.length - 1];
      const lastUpdated = last?.updated_at ? new Date(last.updated_at) : null;
      if (lastUpdated && !Number.isNaN(lastUpdated.getTime()) && lastUpdated < since) break;
    } else {
      all.push(...filtered);
      if (maxItems && all.length >= maxItems) break;
    }
  }

  return maxItems ? all.slice(0, maxItems) : all;
}

/**
 * @param {string} s
 * @returns {string}
 */
function yamlQuote(s) {
  return JSON.stringify(String(s ?? ""));
}

/**
 * @param {any} v
 * @returns {string}
 */
function yamlScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return yamlQuote(String(v));
}

/**
 * @param {string[]} items
 * @param {number} indent
 * @returns {string}
 */
function yamlStringList(items, indent) {
  const pad = " ".repeat(indent);
  if (!items.length) return "[]";
  return "\n" + items.map((s) => `${pad}- ${yamlQuote(s)}`).join("\n");
}

/**
 * @param {string} owner
 * @param {string} repoName
 * @param {"pull"|"issue"} type
 * @param {number} number
 * @returns {string}
 */
function corpusPath(owner, repoName, type, number) {
  return path.join(owner, repoName, type, `${number}.md`);
}

/**
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
function joinCorpus(root, rel) {
  return path.join(root, rel);
}

/**
 * @param {string} absPath
 * @param {string} content
 * @param {boolean} dryRun
 */
function writeFileEnsuringDir(absPath, content, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

/**
 * @param {string} s
 * @returns {string}
 */
function normalizeBody(s) {
  // Keep the doc readable and stable if the API returns null bodies.
  const v = String(s ?? "");
  return v.trim() ? v : "(no body)";
}

/**
 * @param {any[]} events
 * @param {string} createdAtKey
 * @returns {{firstAt: string|null, lastAt: string|null}}
 */
function bounds(events, createdAtKey) {
  if (!events.length) return { firstAt: null, lastAt: null };
  const times = events.map((e) => e?.[createdAtKey]).filter(Boolean);
  if (!times.length) return { firstAt: null, lastAt: null };
  times.sort();
  return { firstAt: times[0], lastAt: times[times.length - 1] };
}

/**
 * @param {any} pr
 * @param {any[]} issueComments
 * @param {any[]} reviews
 * @returns {string}
 */
function renderPullDoc(pr, issueComments, reviews) {
  const labels = (pr.labels ?? []).map((l) => l?.name).filter(Boolean);
  const assignees = (pr.assignees ?? []).map((a) => a?.login).filter(Boolean);
  const reviewEvents = reviews.map((r) => ({
    kind: "review",
    created_at: r.submitted_at ?? r.submittedAt ?? r.created_at ?? null,
    actor: r.user?.login ?? "unknown",
    state: r.state ?? "",
    body: r.body ?? "",
  })).filter((e) => e.created_at);
  const commentEvents = issueComments.map((c) => ({
    kind: "comment",
    created_at: c.created_at,
    actor: c.user?.login ?? "unknown",
    body: c.body ?? "",
  }));

  /** @type {{kind: string, created_at: string, actor: string, state?: string, body: string}[]} */
  const timeline = [...commentEvents, ...reviewEvents].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const tb = bounds(timeline, "created_at");

  const activityCandidates = [
    pr.updated_at,
    tb.lastAt,
  ].filter(Boolean).sort();
  const lastActivityAt = activityCandidates.length ? activityCandidates[activityCandidates.length - 1] : pr.updated_at;

  const merged = Boolean(pr.merged_at);
  const docType = "github_pull";

  const fmLines = [];
  fmLines.push("---");
  fmLines.push(`schema: ${yamlQuote("pr_sheriff_corpus_v1")}`);
  fmLines.push(`doc_type: ${yamlQuote(docType)}`);
  fmLines.push(`repo: ${yamlQuote(pr.base?.repo?.full_name ?? pr.base?.repo?.name ?? "")}`);
  fmLines.push(`number: ${yamlScalar(pr.number)}`);
  fmLines.push(`title: ${yamlQuote(pr.title ?? "")}`);
  fmLines.push(`state: ${yamlQuote(pr.state ?? "")}`);
  fmLines.push(`url: ${yamlQuote(pr.html_url ?? pr.url ?? "")}`);
  fmLines.push(`author_login: ${yamlQuote(pr.user?.login ?? "")}`);
  fmLines.push(`created_at: ${yamlQuote(pr.created_at ?? "")}`);
  fmLines.push(`updated_at: ${yamlQuote(pr.updated_at ?? "")}`);
  fmLines.push(`closed_at: ${yamlScalar(pr.closed_at ?? null)}`);
  fmLines.push(`draft: ${yamlScalar(Boolean(pr.draft))}`);
  fmLines.push(`merged: ${yamlScalar(merged)}`);
  fmLines.push(`merged_at: ${yamlScalar(pr.merged_at ?? null)}`);
  fmLines.push(`base_ref: ${yamlQuote(pr.base?.ref ?? "")}`);
  fmLines.push(`head_ref: ${yamlQuote(pr.head?.ref ?? "")}`);
  fmLines.push(`head_sha: ${yamlQuote(pr.head?.sha ?? "")}`);
  fmLines.push(`labels: ${yamlStringList(labels, 2)}`);
  fmLines.push(`assignees: ${yamlStringList(assignees, 2)}`);
  fmLines.push(`milestone_title: ${yamlScalar(pr.milestone?.title ?? null)}`);
  fmLines.push(`comment_count: ${yamlScalar(pr.comments ?? pr.comments_count ?? 0)}`);
  fmLines.push(`review_count: ${yamlScalar(reviews.length)}`);
  fmLines.push(`last_activity_at: ${yamlQuote(lastActivityAt ?? pr.updated_at ?? "")}`);
  fmLines.push(`timeline_event_count: ${yamlScalar(timeline.length)}`);
  fmLines.push(`timeline_first_at: ${yamlScalar(tb.firstAt)}`);
  fmLines.push(`timeline_last_at: ${yamlScalar(tb.lastAt)}`);
  fmLines.push("---");

  const title = `PR #${pr.number}: ${pr.title ?? ""}`.trim();
  const lines = [];
  lines.push(fmLines.join("\n"));
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`URL: ${pr.html_url ?? pr.url ?? ""}`);
  lines.push("");
  lines.push("## Body");
  lines.push("");
  lines.push(normalizeBody(pr.body));
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  if (!timeline.length) {
    lines.push("(no timeline events ingested)");
  } else {
    for (const e of timeline) {
      const label = e.kind === "review" ? `review: ${e.state ?? ""}`.trim() : e.kind;
      lines.push(`### ${e.created_at} (${label}) @${e.actor}`);
      lines.push("");
      lines.push(normalizeBody(e.body));
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * @param {any} issue
 * @param {any[]} issueComments
 * @returns {string}
 */
function renderIssueDoc(issue, issueComments) {
  const labels = (issue.labels ?? []).map((l) => l?.name).filter(Boolean);
  const assignees = (issue.assignees ?? []).map((a) => a?.login).filter(Boolean);
  const commentEvents = issueComments.map((c) => ({
    kind: "comment",
    created_at: c.created_at,
    actor: c.user?.login ?? "unknown",
    body: c.body ?? "",
  }));
  const tb = bounds(commentEvents, "created_at");

  const activityCandidates = [
    issue.updated_at,
    tb.lastAt,
  ].filter(Boolean).sort();
  const lastActivityAt = activityCandidates.length ? activityCandidates[activityCandidates.length - 1] : issue.updated_at;

  const docType = "github_issue";

  const fmLines = [];
  fmLines.push("---");
  fmLines.push(`schema: ${yamlQuote("pr_sheriff_corpus_v1")}`);
  fmLines.push(`doc_type: ${yamlQuote(docType)}`);
  fmLines.push(`repo: ${yamlQuote(issue.repository_url?.split("/repos/")[1] ?? "")}`);
  fmLines.push(`number: ${yamlScalar(issue.number)}`);
  fmLines.push(`title: ${yamlQuote(issue.title ?? "")}`);
  fmLines.push(`state: ${yamlQuote(issue.state ?? "")}`);
  fmLines.push(`url: ${yamlQuote(issue.html_url ?? issue.url ?? "")}`);
  fmLines.push(`author_login: ${yamlQuote(issue.user?.login ?? "")}`);
  fmLines.push(`created_at: ${yamlQuote(issue.created_at ?? "")}`);
  fmLines.push(`updated_at: ${yamlQuote(issue.updated_at ?? "")}`);
  fmLines.push(`closed_at: ${yamlScalar(issue.closed_at ?? null)}`);
  fmLines.push(`labels: ${yamlStringList(labels, 2)}`);
  fmLines.push(`assignees: ${yamlStringList(assignees, 2)}`);
  fmLines.push(`milestone_title: ${yamlScalar(issue.milestone?.title ?? null)}`);
  fmLines.push(`comment_count: ${yamlScalar(issue.comments ?? issue.comments_count ?? 0)}`);
  fmLines.push(`last_activity_at: ${yamlQuote(lastActivityAt ?? issue.updated_at ?? "")}`);
  fmLines.push(`timeline_event_count: ${yamlScalar(commentEvents.length)}`);
  fmLines.push(`timeline_first_at: ${yamlScalar(tb.firstAt)}`);
  fmLines.push(`timeline_last_at: ${yamlScalar(tb.lastAt)}`);
  fmLines.push("---");

  const title = `Issue #${issue.number}: ${issue.title ?? ""}`.trim();
  const lines = [];
  lines.push(fmLines.join("\n"));
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`URL: ${issue.html_url ?? issue.url ?? ""}`);
  lines.push("");
  lines.push("## Body");
  lines.push("");
  lines.push(normalizeBody(issue.body));
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  if (!commentEvents.length) {
    lines.push("(no timeline events ingested)");
  } else {
    for (const e of commentEvents.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      lines.push(`### ${e.created_at} (comment) @${e.actor}`);
      lines.push("");
      lines.push(normalizeBody(e.body));
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * @param {string} repo
 * @param {number} number
 * @param {number} max
 * @returns {any[]}
 */
function fetchIssueComments(repo, number, max) {
  if (max === 0) return [];
  const endpointForPage = (page) =>
    `repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`;
  return ghListAll(endpointForPage, (xs) => xs, null, max);
}

/**
 * @param {string} repo
 * @param {number} number
 * @param {number} max
 * @returns {any[]}
 */
function fetchPullReviews(repo, number, max) {
  if (max === 0) return [];
  const endpointForPage = (page) =>
    `repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`;
  return ghListAll(endpointForPage, (xs) => xs, null, max);
}

/**
 * @param {Args} args
 */
function runQmdIndex(args) {
  const baseArgs = [];
  if (args.qmdIndex) baseArgs.push("--index", args.qmdIndex);

  const addArgs = [
    ...baseArgs,
    "collection",
    "add",
    args.outDir,
    "--name",
    args.qmdCollection,
    "--mask",
    "*.md",
  ];

  const add = spawnSync("qmd", addArgs, { stdio: "inherit" });
  if (add.status === 0) return;

  // If the collection already exists (or add fails for any reason), update all
  // collections as a safe fallback.
  const updArgs = [...baseArgs, "update"];
  const upd = spawnSync("qmd", updArgs, { stdio: "inherit" });
  if (upd.status !== 0) process.exit(upd.status ?? 1);
}

/**
 * @param {Args} args
 */
function main(args) {
  const [owner, repoName] = args.repo.split("/");
  if (!owner || !repoName) {
    console.error(`Invalid --repo (expected owner/name): ${args.repo}`);
    process.exit(2);
  }

  /** @type {Array<{type: "pull"|"issue", number: number, updated_at: string}>} */
  const work = [];

  // Limit applies to the overall ingest, but we also use it as a soft cap per
  // list call to avoid fetching thousands of items just to ingest a handful.
  const listCap = args.limit > 0 ? args.limit : null;

  if (args.includePulls) {
    const pulls = ghListAll(
      (page) => `repos/${args.repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
      (xs) => xs,
      args.since,
      listCap
    );
    for (const pr of pulls) work.push({ type: "pull", number: pr.number, updated_at: pr.updated_at });
  }

  if (args.includeIssues) {
    const issues = ghListAll(
      (page) => `repos/${args.repo}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
      (xs) => xs.filter((it) => !it.pull_request),
      args.since,
      listCap
    );
    for (const iss of issues) work.push({ type: "issue", number: iss.number, updated_at: iss.updated_at });
  }

  // Stable ordering (updated desc) helps reproducibility and makes --limit useful.
  work.sort((a, b) => {
    const upd = b.updated_at.localeCompare(a.updated_at);
    if (upd !== 0) return upd;
    const c = a.type.localeCompare(b.type);
    if (c !== 0) return c;
    return a.number - b.number;
  });

  const limited = args.limit > 0 ? work.slice(0, args.limit) : work;
  console.error(`Ingesting ${limited.length} items for ${args.repo} into ${args.outDir}`);

  for (const item of limited) {
    if (item.type === "pull") {
      const pr = ghApiJson(`repos/${args.repo}/pulls/${item.number}`);
      const issueComments = fetchIssueComments(args.repo, item.number, args.maxComments);
      const reviews = fetchPullReviews(args.repo, item.number, args.maxReviews);
      const doc = renderPullDoc(pr, issueComments, reviews);
      const rel = corpusPath(owner, repoName, "pull", item.number);
      const abs = joinCorpus(args.outDir, rel);
      writeFileEnsuringDir(abs, doc, args.dryRun);
    } else {
      const issue = ghApiJson(`repos/${args.repo}/issues/${item.number}`);
      const issueComments = fetchIssueComments(args.repo, item.number, args.maxComments);
      const doc = renderIssueDoc(issue, issueComments);
      const rel = corpusPath(owner, repoName, "issue", item.number);
      const abs = joinCorpus(args.outDir, rel);
      writeFileEnsuringDir(abs, doc, args.dryRun);
    }
  }

  if (args.dryRun) return;
  runQmdIndex(args);
}

const args = parseArgs(process.argv.slice(2));
main(args);
