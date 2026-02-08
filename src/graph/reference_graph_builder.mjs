import { extractReferencedNumbersFromPRAndComments } from "./reference_extraction.mjs";

function prNodeId({ owner, repo, number }) {
  return `pr:${owner}/${repo}#${number}`;
}

function issueNodeId({ owner, repo, number }) {
  return `issue:${owner}/${repo}#${number}`;
}

function addNode(graph, node) {
  graph.nodes[node.id] = node;
}

function addEdge(graph, edge) {
  graph.edges.push(edge);
}

function uniquePush(arr, value) {
  if (!arr.includes(value)) arr.push(value);
}

/**
 * Build a small reference graph rooted at a PR, following issue/PR references and
 * "issue closed by PR" relationships up to 2 layers deep.
 *
 * Traversal overview:
 * - Root PR -> (references) numbers mentioned in body/comments (layer 1)
 * - For layer-1 issues:
 *   - Issue -> (closed_by|cross_referenced_by) PRs from issue timeline
 *   - Each closing/cross-ref PR -> (references) numbers mentioned in its body/comments (layer 2)
 * - For layer-2 issues:
 *   - Issue -> (closed_by|cross_referenced_by) PR numbers from issue timeline (no further expansion)
 *
 * Classification:
 * - We classify a referenced number via `GET /issues/{n}`: if payload includes `pull_request`,
 *   it's a PR number; otherwise it's an Issue number.
 *
 * @param {object} args
 * @param {import("../github/github_fetch.mjs").GitHubFetch} args.gh
 * @param {string} args.owner
 * @param {string} args.repo
 * @param {number} args.prNumber
 * @param {object} [args.budgets]
 * @param {number} [args.budgets.maxLayer1References] - cap numbers extracted from the root PR
 * @param {number} [args.budgets.maxClosingPrsPerIssue] - cap PRs from an issue timeline
 * @param {number} [args.budgets.maxLayer2ReferencesPerPr] - cap numbers extracted from a 1st-layer PR
 * @param {number} [args.budgets.maxLayer2ClosingPrsPerIssue] - cap PRs from a layer-2 issue timeline
 * @returns {Promise<{rootId: string, nodes: Record<string, any>, edges: any[], budgets: any, stats: any}>}
 */
export async function buildReferenceGraph({
  gh,
  owner,
  repo,
  prNumber,
  budgets = {},
}) {
  const caps = {
    maxLayer1References: budgets.maxLayer1References ?? 10,
    maxClosingPrsPerIssue: budgets.maxClosingPrsPerIssue ?? 5,
    maxLayer2ReferencesPerPr: budgets.maxLayer2ReferencesPerPr ?? 10,
    maxLayer2ClosingPrsPerIssue: budgets.maxLayer2ClosingPrsPerIssue ?? 5,
  };

  /** @type {{rootId: string, nodes: Record<string, any>, edges: any[], budgets: any, stats: any}} */
  const graph = {
    rootId: prNodeId({ owner, repo, number: prNumber }),
    nodes: {},
    edges: [],
    budgets: caps,
    stats: {
      apiCalls: { getPR: 0, getIssue: 0, listPRComments: 0, getIssueTimeline: 0 },
      truncated: { layer1Refs: false, closingPrs: 0, layer2Refs: 0, layer2ClosingPrs: 0 },
    },
  };

  /** @type {Map<number, "issue" | "pr" | "unknown">} */
  const kindCache = new Map();

  async function getNumberKind(num) {
    if (kindCache.has(num)) return kindCache.get(num);
    graph.stats.apiCalls.getIssue += 1;
    const issue = await gh.getIssue(num, { useCache: true });
    const kind = issue && typeof issue === "object" ? (issue.pull_request ? "pr" : "issue") : "unknown";
    kindCache.set(num, kind);
    return kind;
  }

  async function fetchPRWithComments(num) {
    graph.stats.apiCalls.getPR += 1;
    const pr = await gh.getPR(num, { useCache: true });
    graph.stats.apiCalls.listPRComments += 1;
    const comments = await gh.listPRComments(num, { useCache: true });
    return { pr, comments: comments.all };
  }

  function timelinePRNumbers(nodes) {
    /** @type {{closing: number[], crossReferenced: number[]}} */
    const out = { closing: [], crossReferenced: [] };
    for (const ev of nodes || []) {
      if (!ev || typeof ev !== "object") continue;
      if (ev.__typename === "ClosedEvent") {
        const closer = ev.closer;
        if (closer && closer.__typename === "PullRequest" && typeof closer.number === "number") {
          uniquePush(out.closing, closer.number);
        }
      }
      if (ev.__typename === "CrossReferencedEvent") {
        const src = ev.source;
        if (src && src.__typename === "PullRequest" && typeof src.number === "number") {
          uniquePush(out.crossReferenced, src.number);
        }
      }
    }
    out.closing.sort((a, b) => a - b);
    out.crossReferenced.sort((a, b) => a - b);
    return out;
  }

  async function addIssueTimelineEdges(issueNum, { maxPrs, edgeKindFor }) {
    graph.stats.apiCalls.getIssueTimeline += 1;
    const timeline = await gh.getIssueTimeline(issueNum, { useCache: true });
    const prNums = timelinePRNumbers(timeline);

    const closing = prNums.closing.slice(0, maxPrs);
    const cross = prNums.crossReferenced.slice(0, Math.max(0, maxPrs - closing.length));

    if (prNums.closing.length > closing.length) graph.stats.truncated.closingPrs += 1;
    if (prNums.crossReferenced.length > cross.length) graph.stats.truncated.closingPrs += 1;

    for (const n of closing) {
      const pid = prNodeId({ owner, repo, number: n });
      if (!graph.nodes[pid]) {
        addNode(graph, { id: pid, type: "pr", owner, repo, number: n });
      }
      addEdge(graph, { from: issueNodeId({ owner, repo, number: issueNum }), to: pid, type: edgeKindFor("closed_by") });
    }
    for (const n of cross) {
      const pid = prNodeId({ owner, repo, number: n });
      if (!graph.nodes[pid]) {
        addNode(graph, { id: pid, type: "pr", owner, repo, number: n });
      }
      addEdge(graph, { from: issueNodeId({ owner, repo, number: issueNum }), to: pid, type: edgeKindFor("cross_referenced_by") });
    }

    return { closing, crossReferenced: cross };
  }

  // Root PR node with minimal metadata.
  const { pr: rootPr, comments: rootComments } = await fetchPRWithComments(prNumber);
  addNode(graph, {
    id: graph.rootId,
    type: "pr",
    owner,
    repo,
    number: prNumber,
    title: rootPr?.title ?? null,
    url: rootPr?.html_url ?? rootPr?.url ?? null,
    mergedAt: rootPr?.merged_at ?? null,
    closedAt: rootPr?.closed_at ?? null,
    state: rootPr?.state ?? null,
  });

  const layer1All = extractReferencedNumbersFromPRAndComments(rootPr, rootComments, { owner, repo });
  const layer1 = layer1All.slice(0, caps.maxLayer1References);
  if (layer1All.length > layer1.length) graph.stats.truncated.layer1Refs = true;

  /** @type {number[]} */
  const layer1Issues = [];
  /** @type {number[]} */
  const layer1PRs = [];

  for (const n of layer1) {
    const kind = await getNumberKind(n);
    if (kind === "issue") layer1Issues.push(n);
    else if (kind === "pr") layer1PRs.push(n);
  }

  // Add layer-1 references edges from root PR.
  for (const n of layer1Issues) {
    const iid = issueNodeId({ owner, repo, number: n });
    addNode(graph, { id: iid, type: "issue", owner, repo, number: n });
    addEdge(graph, { from: graph.rootId, to: iid, type: "references" });
  }
  for (const n of layer1PRs) {
    const pid = prNodeId({ owner, repo, number: n });
    addNode(graph, { id: pid, type: "pr", owner, repo, number: n });
    addEdge(graph, { from: graph.rootId, to: pid, type: "references" });
  }

  // Expand layer-1 issues.
  /** @type {number[]} */
  const layer1IssueRelatedPRs = [];
  for (const issueNum of layer1Issues) {
    const issueId = issueNodeId({ owner, repo, number: issueNum });
    const related = await addIssueTimelineEdges(issueNum, {
      maxPrs: caps.maxClosingPrsPerIssue,
      edgeKindFor: (k) => k,
    });
    for (const prNum of [...related.closing, ...related.crossReferenced]) {
      uniquePush(layer1IssueRelatedPRs, prNum);
      // Ensure edge source node exists (it should).
      if (!graph.nodes[issueId]) addNode(graph, { id: issueId, type: "issue", owner, repo, number: issueNum });
    }
  }

  // Expand each related PR from layer-1 issues: extract refs (layer 2).
  /** @type {number[]} */
  const layer2Issues = [];
  /** @type {number[]} */
  const layer2PRs = [];

  for (const prNum of layer1IssueRelatedPRs) {
    const { pr, comments } = await fetchPRWithComments(prNum);
    const pid = prNodeId({ owner, repo, number: prNum });
    const existing = graph.nodes[pid];
    // Upgrade PR node with metadata if we fetched it.
    if (!existing || existing.title == null) {
      addNode(graph, {
        id: pid,
        type: "pr",
        owner,
        repo,
        number: prNum,
        title: pr?.title ?? null,
        url: pr?.html_url ?? pr?.url ?? null,
        mergedAt: pr?.merged_at ?? null,
        closedAt: pr?.closed_at ?? null,
        state: pr?.state ?? null,
      });
    }

    const refsAll = extractReferencedNumbersFromPRAndComments(pr, comments, { owner, repo });
    const refs = refsAll.slice(0, caps.maxLayer2ReferencesPerPr);
    if (refsAll.length > refs.length) graph.stats.truncated.layer2Refs += 1;

    for (const n of refs) {
      const kind = await getNumberKind(n);
      if (kind === "issue") {
        uniquePush(layer2Issues, n);
        const iid = issueNodeId({ owner, repo, number: n });
        if (!graph.nodes[iid]) addNode(graph, { id: iid, type: "issue", owner, repo, number: n });
        addEdge(graph, { from: pid, to: iid, type: "references" });
      } else if (kind === "pr") {
        uniquePush(layer2PRs, n);
        const rid = prNodeId({ owner, repo, number: n });
        if (!graph.nodes[rid]) addNode(graph, { id: rid, type: "pr", owner, repo, number: n });
        addEdge(graph, { from: pid, to: rid, type: "references" });
      }
    }
  }

  // Expand layer-2 issues by adding their closing/cross-ref PR numbers (no further PR expansion).
  for (const issueNum of layer2Issues) {
    await addIssueTimelineEdges(issueNum, {
      maxPrs: caps.maxLayer2ClosingPrsPerIssue,
      edgeKindFor: (k) => k,
    });
  }

  // Add stubs for layer-2 PRs that weren't expanded.
  for (const prNum of layer2PRs) {
    const pid = prNodeId({ owner, repo, number: prNum });
    if (!graph.nodes[pid]) addNode(graph, { id: pid, type: "pr", owner, repo, number: prNum });
  }

  return graph;
}

