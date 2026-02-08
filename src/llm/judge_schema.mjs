/**
 * Strict JSON schema + runtime validator for the LLM judge output.
 *
 * This module intentionally avoids external deps (ajv/zod) to keep the scaffold
 * lightweight and to allow unit tests to run via `node --test` without a build step.
 */

/**
 * @typedef {"pr_body"|"pr_comment"|"review_comment"|"commit"|"timeline_event"|"diff"|"other"} EvidenceSource
 */

/**
 * @typedef {Object} Evidence
 * @property {string} id
 * @property {EvidenceSource} source
 * @property {string} snippet
 * @property {string=} url
 * @property {string=} note
 */

/**
 * @typedef {"duplicate"|"depends_on"|"blocks"|"mentioned"|"other"} RelatedRelationship
 */

/**
 * @typedef {Object} PrLink
 * @property {number} pr_number
 * @property {string} repo
 * @property {string} url
 * @property {string} summary
 * @property {string[]} evidence_ids
 * @property {number} confidence
 * @property {RelatedRelationship=} relationship
 */

/**
 * @typedef {"opened"|"closed"|"merged"|"comment"|"cross_reference"|"commit"|"other"} TimelineKind
 */

/**
 * @typedef {Object} TimelineEvent
 * @property {string} ts
 * @property {TimelineKind} kind
 * @property {number=} pr_number
 * @property {string=} url
 * @property {string} note
 */

/**
 * @typedef {Object} JudgeResult
 * @property {PrLink[]} superseded_by
 * @property {PrLink[]} related
 * @property {Evidence[]} evidence
 * @property {number} confidence
 * @property {TimelineEvent[]} timelines
 */

export const JUDGE_RESULT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://martian.engineering/pr-sheriff/judge-result.schema.json',
  title: 'pr-sheriff LLM judge result',
  type: 'object',
  additionalProperties: false,
  required: ['superseded_by', 'related', 'evidence', 'confidence', 'timelines'],
  properties: {
    superseded_by: {
      type: 'array',
      items: { $ref: '#/$defs/prLinkSupersededBy' },
    },
    related: {
      type: 'array',
      items: { $ref: '#/$defs/prLinkRelated' },
    },
    evidence: {
      type: 'array',
      items: { $ref: '#/$defs/evidence' },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    timelines: {
      type: 'array',
      items: { $ref: '#/$defs/timelineEvent' },
    },
  },
  $defs: {
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'source', 'snippet'],
      properties: {
        id: { type: 'string', minLength: 1 },
        source: {
          type: 'string',
          enum: ['pr_body', 'pr_comment', 'review_comment', 'commit', 'timeline_event', 'diff', 'other'],
        },
        snippet: { type: 'string', minLength: 1 },
        url: { type: 'string', minLength: 1 },
        note: { type: 'string', minLength: 1 },
      },
    },
    prLinkBase: {
      type: 'object',
      additionalProperties: false,
      required: ['pr_number', 'repo', 'url', 'summary', 'evidence_ids', 'confidence'],
      properties: {
        pr_number: { type: 'integer', minimum: 1 },
        repo: { type: 'string', minLength: 1 },
        url: { type: 'string', minLength: 1 },
        summary: { type: 'string', minLength: 1 },
        evidence_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    prLinkSupersededBy: {
      allOf: [{ $ref: '#/$defs/prLinkBase' }],
    },
    prLinkRelated: {
      allOf: [
        { $ref: '#/$defs/prLinkBase' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['relationship'],
          properties: {
            relationship: { type: 'string', enum: ['duplicate', 'depends_on', 'blocks', 'mentioned', 'other'] },
          },
        },
      ],
    },
    timelineEvent: {
      type: 'object',
      additionalProperties: false,
      required: ['ts', 'kind', 'note'],
      properties: {
        ts: { type: 'string', minLength: 1 },
        kind: {
          type: 'string',
          enum: ['opened', 'closed', 'merged', 'comment', 'cross_reference', 'commit', 'other'],
        },
        pr_number: { type: 'integer', minimum: 1 },
        url: { type: 'string', minLength: 1 },
        note: { type: 'string', minLength: 1 },
      },
    },
  },
};

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function assertNoExtraKeys(obj, allowedKeys, path) {
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.includes(k)) {
      throw new Error(`Invalid judge result: unexpected key at ${path}: ${k}`);
    }
  }
}

function assertString(v, path) {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`Invalid judge result: expected non-empty string at ${path}`);
}

function assertOptionalString(v, path) {
  if (v === undefined) return;
  assertString(v, path);
}

function assertNumber01(v, path) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`Invalid judge result: expected number in [0,1] at ${path}`);
  }
}

function assertIntegerMin1(v, path) {
  if (!Number.isInteger(v) || v < 1) throw new Error(`Invalid judge result: expected integer >= 1 at ${path}`);
}

function assertStringArray(v, path) {
  if (!Array.isArray(v)) throw new Error(`Invalid judge result: expected array at ${path}`);
  for (let i = 0; i < v.length; i++) assertString(v[i], `${path}[${i}]`);
}

function validateEvidence(item, path) {
  if (!isObject(item)) throw new Error(`Invalid judge result: expected object at ${path}`);
  assertNoExtraKeys(item, ['id', 'source', 'snippet', 'url', 'note'], path);
  assertString(item.id, `${path}.id`);
  if (!['pr_body', 'pr_comment', 'review_comment', 'commit', 'timeline_event', 'diff', 'other'].includes(item.source)) {
    throw new Error(`Invalid judge result: invalid evidence source at ${path}.source`);
  }
  assertString(item.snippet, `${path}.snippet`);
  assertOptionalString(item.url, `${path}.url`);
  assertOptionalString(item.note, `${path}.note`);
}

function validatePrLink(item, path, opts) {
  if (!isObject(item)) throw new Error(`Invalid judge result: expected object at ${path}`);
  const allowed = opts.requireRelationship
    ? ['pr_number', 'repo', 'url', 'summary', 'evidence_ids', 'confidence', 'relationship']
    : ['pr_number', 'repo', 'url', 'summary', 'evidence_ids', 'confidence'];
  assertNoExtraKeys(item, allowed, path);
  assertIntegerMin1(item.pr_number, `${path}.pr_number`);
  assertString(item.repo, `${path}.repo`);
  assertString(item.url, `${path}.url`);
  assertString(item.summary, `${path}.summary`);
  assertStringArray(item.evidence_ids, `${path}.evidence_ids`);
  assertNumber01(item.confidence, `${path}.confidence`);
  if (opts.requireRelationship) {
    if (!['duplicate', 'depends_on', 'blocks', 'mentioned', 'other'].includes(item.relationship)) {
      throw new Error(`Invalid judge result: invalid related relationship at ${path}.relationship`);
    }
  }
}

function validateTimelineEvent(item, path) {
  if (!isObject(item)) throw new Error(`Invalid judge result: expected object at ${path}`);
  assertNoExtraKeys(item, ['ts', 'kind', 'pr_number', 'url', 'note'], path);
  assertString(item.ts, `${path}.ts`);
  if (!['opened', 'closed', 'merged', 'comment', 'cross_reference', 'commit', 'other'].includes(item.kind)) {
    throw new Error(`Invalid judge result: invalid timeline kind at ${path}.kind`);
  }
  if (item.pr_number !== undefined) assertIntegerMin1(item.pr_number, `${path}.pr_number`);
  assertOptionalString(item.url, `${path}.url`);
  assertString(item.note, `${path}.note`);
}

/**
 * Validate a parsed judge result. Throws a human-readable Error if invalid.
 *
 * @param {unknown} value
 * @returns {JudgeResult}
 */
export function validateJudgeResult(value) {
  if (!isObject(value)) throw new Error('Invalid judge result: expected top-level object');
  assertNoExtraKeys(value, ['superseded_by', 'related', 'evidence', 'confidence', 'timelines'], '$');

  if (!Array.isArray(value.superseded_by)) throw new Error('Invalid judge result: expected array at $.superseded_by');
  if (!Array.isArray(value.related)) throw new Error('Invalid judge result: expected array at $.related');
  if (!Array.isArray(value.evidence)) throw new Error('Invalid judge result: expected array at $.evidence');
  if (!Array.isArray(value.timelines)) throw new Error('Invalid judge result: expected array at $.timelines');

  for (let i = 0; i < value.superseded_by.length; i++) {
    validatePrLink(value.superseded_by[i], `$.superseded_by[${i}]`, { requireRelationship: false });
  }
  for (let i = 0; i < value.related.length; i++) {
    validatePrLink(value.related[i], `$.related[${i}]`, { requireRelationship: true });
  }
  for (let i = 0; i < value.evidence.length; i++) {
    validateEvidence(value.evidence[i], `$.evidence[${i}]`);
  }
  assertNumber01(value.confidence, '$.confidence');
  for (let i = 0; i < value.timelines.length; i++) {
    validateTimelineEvent(value.timelines[i], `$.timelines[${i}]`);
  }

  return /** @type {JudgeResult} */ (value);
}

