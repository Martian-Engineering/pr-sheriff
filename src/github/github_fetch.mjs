import path from 'node:path';

import { cacheKey, readJsonCache, writeJsonCache } from './file_cache.mjs';
import { defaultGhRunner } from './gh_api_runner.mjs';

function parseOwnerRepo(repo) {
  const m = /^([^/]+)\/([^/]+)$/.exec(repo || '');
  if (!m) {
    throw new Error(`Invalid repo "${repo}". Expected "owner/name".`);
  }
  return { owner: m[1], name: m[2] };
}

function encodeQuery(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function splitHttpResponse(raw) {
  // `gh api --include` uses LF line endings on macOS, but handle CRLF too.
  const idx = raw.indexOf('\r\n\r\n') >= 0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
  if (idx < 0) {
    return { status: null, headers: {}, bodyText: raw };
  }
  const headerText = raw.slice(0, idx);
  const bodyText = raw.slice(idx + (raw[idx] === '\r' ? 4 : 2));
  const headerLines = headerText.split(/\r?\n/);
  const statusLine = headerLines[0] || '';

  const statusMatch = /HTTP\/\S+\s+(\d+)/.exec(statusLine);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  /** @type {Record<string, string>} */
  const headers = {};
  for (const line of headerLines.slice(1)) {
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    headers[m[1].toLowerCase()] = m[2];
  }

  return { status, headers, bodyText };
}

function parseLinkHeader(linkHeader) {
  /** @type {Record<string, string>} */
  const rels = {};
  if (!linkHeader) return rels;

  for (const part of linkHeader.split(',')) {
    const urlMatch = /<([^>]+)>/.exec(part);
    const relMatch = /rel="([^"]+)"/.exec(part);
    if (!urlMatch || !relMatch) continue;
    rels[relMatch[1]] = urlMatch[1];
  }
  return rels;
}

function isoDate(date) {
  if (typeof date === 'string') return date;
  return date.toISOString().slice(0, 10);
}

/**
 * Minimal GitHub data access layer backed by `gh api`.
 *
 * Responsibilities:
 * - REST + GraphQL pagination
 * - local JSON caching under `.cache/`
 * - basic rate-limit backoff (single retry with bounded sleep)
 */
export class GitHubFetch {
  /**
   * @param {object} opts
   * @param {string} opts.repo - "owner/name"
   * @param {string} [opts.cacheDir] - defaults to ".cache/pr-sheriff/github"
   * @param {number} [opts.cacheTtlSeconds] - defaults to 300 seconds
   * @param {(args: string[], runnerOpts?: any) => Promise<{exitCode:number, stdout:string, stderr:string, timedOut?:boolean}>} [opts.ghRunner]
   * @param {(ms:number) => Promise<void>} [opts.sleepFn]
   * @param {number} [opts.maxBackoffSeconds] - max sleep for rate-limit backoff
   */
  constructor({
    repo,
    cacheDir = path.join('.cache', 'pr-sheriff', 'github'),
    cacheTtlSeconds = 300,
    ghRunner = defaultGhRunner,
    sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxBackoffSeconds = 10,
  }) {
    const { owner, name } = parseOwnerRepo(repo);
    this.repo = repo;
    this.owner = owner;
    this.name = name;

    this.cacheDir = cacheDir;
    this.cacheTtlSeconds = cacheTtlSeconds;
    this.ghRunner = ghRunner;
    this.sleepFn = sleepFn;
    this.maxBackoffSeconds = maxBackoffSeconds;
  }

  /**
   * Fetch pull request details.
   */
  async getPR(number, { useCache = true } = {}) {
    return await this.#restRequest({
      method: 'GET',
      endpoint: `/repos/${this.owner}/${this.name}/pulls/${number}`,
      useCache,
    });
  }

  /**
   * Fetch issue details.
   */
  async getIssue(number, { useCache = true } = {}) {
    return await this.#restRequest({
      method: 'GET',
      endpoint: `/repos/${this.owner}/${this.name}/issues/${number}`,
      useCache,
    });
  }

  /**
   * List all comments on a PR: issue comments + PR review (inline) comments.
   *
   * @returns {Promise<{issueComments:any[], reviewComments:any[], all:any[]}>}
   */
  async listPRComments(number, { useCache = true } = {}) {
    const issueComments = await this.#restPaginateArray({
      endpoint: `/repos/${this.owner}/${this.name}/issues/${number}/comments`,
      useCache,
    });

    const reviewComments = await this.#restPaginateArray({
      endpoint: `/repos/${this.owner}/${this.name}/pulls/${number}/comments`,
      useCache,
    });

    const all = [...issueComments, ...reviewComments].sort((a, b) => {
      const ta = a.created_at || a.createdAt || '';
      const tb = b.created_at || b.createdAt || '';
      return ta.localeCompare(tb);
    });

    return { issueComments, reviewComments, all };
  }

  /**
   * Fetch issue timeline events, including cross-references and "closed by" data.
   *
   * This uses GraphQL because REST issue timeline is still awkward and requires previews.
   */
  async getIssueTimeline(number, { useCache = true } = {}) {
    const query = `
      query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            timelineItems(
              first: 100,
              after: $cursor,
              itemTypes: [
                CROSS_REFERENCED_EVENT,
                REFERENCED_EVENT,
                CLOSED_EVENT,
                REOPENED_EVENT,
                LABELED_EVENT,
                UNLABELED_EVENT
              ]
            ) {
              nodes {
                __typename
                ... on CrossReferencedEvent {
                  createdAt
                  actor { login }
                  source {
                    __typename
                    ... on PullRequest { number title url mergedAt closedAt }
                    ... on Issue { number title url closedAt }
                  }
                }
                ... on ReferencedEvent {
                  createdAt
                  actor { login }
                  commit { oid url messageHeadline }
                  commitRepository { nameWithOwner }
                }
                ... on ClosedEvent {
                  createdAt
                  actor { login }
                  closer {
                    __typename
                    ... on PullRequest { number title url mergedAt closedAt }
                    ... on Commit { oid url messageHeadline }
                  }
                }
                ... on ReopenedEvent {
                  createdAt
                  actor { login }
                }
                ... on LabeledEvent {
                  createdAt
                  actor { login }
                  label { name }
                }
                ... on UnlabeledEvent {
                  createdAt
                  actor { login }
                  label { name }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `.trim();

    const nodes = await this.#graphqlPaginateNodes({
      query,
      variables: { owner: this.owner, name: this.name, number },
      extract: (data) => data?.repository?.issue?.timelineItems,
      useCache,
    });

    return nodes;
  }

  /**
   * Search merged PRs in a repo, with optional time window.
   *
   * @param {object} opts
   * @param {string} [opts.query] - raw search terms (no repo/is:pr/is:merged needed)
   * @param {string|Date} [opts.mergedAfter] - inclusive date (YYYY-MM-DD)
   * @param {string|Date} [opts.mergedBefore] - inclusive date (YYYY-MM-DD)
   * @param {boolean} [opts.useCache]
   */
  async searchMergedPRs({ query = '', mergedAfter, mergedBefore, useCache = true } = {}) {
    const qParts = [
      `repo:${this.owner}/${this.name}`,
      'is:pr',
      'is:merged',
      query.trim(),
    ].filter(Boolean);

    if (mergedAfter || mergedBefore) {
      const after = mergedAfter ? isoDate(mergedAfter) : '*';
      const before = mergedBefore ? isoDate(mergedBefore) : '*';
      qParts.push(`merged:${after}..${before}`);
    }

    const q = qParts.join(' ');
    const result = await this.#restPaginateSearch({
      endpoint: '/search/issues',
      params: { q },
      useCache,
    });
    return result.items;
  }

  async #restPaginateArray({ endpoint, params = {}, useCache }) {
    const key = cacheKey({ kind: 'rest-array', endpoint, params, repo: this.repo });
    if (useCache) {
      const cached = readJsonCache({ cacheDir: this.cacheDir, key, ttlSeconds: this.cacheTtlSeconds });
      if (cached) return cached;
    }

    const perPage = 100;
    let url = `${endpoint}${encodeQuery({ ...params, per_page: perPage })}`;
    /** @type {any[]} */
    const out = [];
    for (let page = 0; page < 200; page++) {
      const { status, headers, body } = await this.#restRequestRaw({ method: 'GET', endpoint: url });
      if (status && status >= 400) {
        throw new Error(`GitHub API error ${status} for ${endpoint}`);
      }
      if (!Array.isArray(body)) {
        throw new Error(`Expected array response for ${endpoint}`);
      }
      out.push(...body);

      const rels = parseLinkHeader(headers.link);
      if (!rels.next) break;
      url = rels.next;
    }

    if (useCache) writeJsonCache({ cacheDir: this.cacheDir, key, value: out });
    return out;
  }

  async #restPaginateSearch({ endpoint, params = {}, useCache }) {
    const key = cacheKey({ kind: 'rest-search', endpoint, params, repo: this.repo });
    if (useCache) {
      const cached = readJsonCache({ cacheDir: this.cacheDir, key, ttlSeconds: this.cacheTtlSeconds });
      if (cached) return cached;
    }

    const perPage = 100;
    let url = `${endpoint}${encodeQuery({ ...params, per_page: perPage })}`;
    /** @type {any[]} */
    const items = [];
    /** @type {any} */
    let firstPage = null;

    for (let page = 0; page < 200; page++) {
      const { status, headers, body } = await this.#restRequestRaw({ method: 'GET', endpoint: url });
      if (status && status >= 400) {
        throw new Error(`GitHub API error ${status} for ${endpoint}`);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`Expected object response for ${endpoint}`);
      }
      if (!firstPage) firstPage = body;
      items.push(...(body.items || []));

      const rels = parseLinkHeader(headers.link);
      if (!rels.next) break;
      url = rels.next;
    }

    const out = { ...firstPage, items };
    if (useCache) writeJsonCache({ cacheDir: this.cacheDir, key, value: out });
    return out;
  }

  async #restRequest({ method, endpoint, params = undefined, useCache }) {
    const key = cacheKey({ kind: 'rest', method, endpoint, params, repo: this.repo });
    if (useCache) {
      const cached = readJsonCache({ cacheDir: this.cacheDir, key, ttlSeconds: this.cacheTtlSeconds });
      if (cached) return cached;
    }

    const fullEndpoint = params ? `${endpoint}${encodeQuery(params)}` : endpoint;
    const { status, body } = await this.#restRequestRaw({ method, endpoint: fullEndpoint });
    if (status && status >= 400) {
      throw new Error(`GitHub API error ${status} for ${endpoint}`);
    }

    if (useCache) writeJsonCache({ cacheDir: this.cacheDir, key, value: body });
    return body;
  }

  async #restRequestRaw({ method, endpoint }) {
    const args = ['api', '--include', '-X', method, endpoint];
    return await this.#executeWithBackoff(args, (raw) => {
      const { status, headers, bodyText } = splitHttpResponse(raw);
      const body = bodyText.trim() ? JSON.parse(bodyText) : null;
      return { status, headers, body };
    });
  }

  async #graphqlPaginateNodes({ query, variables, extract, useCache }) {
    const key = cacheKey({ kind: 'graphql', query, variables, repo: this.repo });
    if (useCache) {
      const cached = readJsonCache({ cacheDir: this.cacheDir, key, ttlSeconds: this.cacheTtlSeconds });
      if (cached) return cached;
    }

    /** @type {any[]} */
    const nodes = [];
    let cursor = null;

    for (let page = 0; page < 200; page++) {
      const pageVars = { ...variables, cursor };
      const args = [
        'api',
        'graphql',
        '--include',
        '-f',
        `query=${query}`,
        '-f',
        `owner=${pageVars.owner}`,
        '-f',
        `name=${pageVars.name}`,
        '-F',
        `number=${pageVars.number}`,
      ];
      if (cursor) {
        args.push('-f', `cursor=${cursor}`);
      }

      const { status, body } = await this.#executeWithBackoff(args, (raw) => {
        const { status: s, bodyText } = splitHttpResponse(raw);
        const parsed = bodyText.trim() ? JSON.parse(bodyText) : null;
        return { status: s, body: parsed };
      });

      if (status && status >= 400) {
        throw new Error(`GitHub GraphQL error ${status}`);
      }
      if (body?.errors?.length) {
        throw new Error(`GitHub GraphQL errors: ${JSON.stringify(body.errors)}`);
      }

      const container = extract(body?.data);
      nodes.push(...(container?.nodes || []));

      if (!container?.pageInfo?.hasNextPage) break;
      cursor = container.pageInfo.endCursor;
      if (!cursor) break;
    }

    if (useCache) writeJsonCache({ cacheDir: this.cacheDir, key, value: nodes });
    return nodes;
  }

  async #executeWithBackoff(args, parseFn) {
    // "Basics": only retry once, and only if we can infer a short wait.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.ghRunner(args);
      if (res.timedOut) throw new Error(`gh timed out: gh ${args.join(' ')}`);
      if (res.exitCode !== 0 && !res.stdout) {
        throw new Error(`gh failed (exit ${res.exitCode}): ${res.stderr || 'unknown error'}`);
      }

      const parsed = parseFn(res.stdout);
      const status = parsed.status;
      const headers = parsed.headers || {};

      const isRateLimited =
        status === 429 ||
        (status === 403 && String(headers['x-ratelimit-remaining'] || '') === '0');

      if (!isRateLimited || attempt === 1) return parsed;

      const retryAfter = Number(headers['retry-after'] || 'NaN');
      const resetEpoch = Number(headers['x-ratelimit-reset'] || 'NaN');
      const nowEpoch = Math.floor(Date.now() / 1000);

      let waitSeconds = Number.isFinite(retryAfter) ? retryAfter : NaN;
      if (!Number.isFinite(waitSeconds) && Number.isFinite(resetEpoch)) {
        waitSeconds = Math.max(0, resetEpoch - nowEpoch);
      }
      if (!Number.isFinite(waitSeconds)) {
        // Can't infer; don't spin.
        return parsed;
      }

      waitSeconds = Math.min(waitSeconds, this.maxBackoffSeconds);
      if (waitSeconds > 0) {
        await this.sleepFn(waitSeconds * 1000);
      }
    }

    // Unreachable
    throw new Error('unexpected backoff loop state');
  }
}

