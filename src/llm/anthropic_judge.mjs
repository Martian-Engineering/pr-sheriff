import { parseJsonFromModelText } from './judge_parse.mjs';
import { validateJudgeResult, JUDGE_RESULT_JSON_SCHEMA } from './judge_schema.mjs';

/**
 * Build the system prompt used for judge calls.
 *
 * Kept terse because the key behavior is enforced via schema + validation.
 *
 * @returns {string}
 */
export function buildJudgeSystemPrompt() {
  return [
    'You are a strict JSON generator.',
    'Return ONLY a single JSON object.',
    'Do NOT wrap it in markdown code fences.',
    'Do NOT add any keys beyond the schema.',
    'If uncertain, return empty arrays and lower confidence.',
  ].join('\n');
}

/**
 * Build the user prompt containing task context plus the schema contract.
 *
 * Callers should pass a JSON-serializable payload (e.g. PR + candidate PRs + timelines).
 *
 * @param {{task: string, payload: unknown}} opts
 * @returns {string}
 */
export function buildJudgeUserPrompt(opts) {
  const schema = JSON.stringify(JUDGE_RESULT_JSON_SCHEMA, null, 2);
  const payload = JSON.stringify(opts.payload, null, 2);
  return [
    `TASK: ${opts.task}`,
    '',
    'OUTPUT CONTRACT:',
    '- Return a single JSON object conforming to this JSON Schema.',
    '- The top-level keys MUST be exactly: superseded_by, related, evidence, confidence, timelines.',
    '- confidence fields must be numbers in [0, 1].',
    '',
    'JSON SCHEMA:',
    schema,
    '',
    'INPUT PAYLOAD (JSON):',
    payload,
  ].join('\n');
}

/**
 * Call Anthropic Messages API and return validated judge output.
 *
 * Required env vars by default:
 * - PR_SHERIFF_ANTHROPIC_API_KEY
 * Optional:
 * - PR_SHERIFF_MODEL (Anthropic model id)
 *
 * @param {{
 *   system: string,
 *   user: string,
 *   apiKey?: string,
 *   model?: string,
 *   maxTokens?: number,
 * }} opts
 * @returns {Promise<import('./judge_schema.mjs').JudgeResult>}
 */
export async function runAnthropicJudge(opts) {
  const apiKey = opts.apiKey ?? process.env.PR_SHERIFF_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing Anthropic API key: set PR_SHERIFF_ANTHROPIC_API_KEY');
  }

  // Default is intentionally overridable since Anthropic model IDs evolve.
  const model = opts.model ?? process.env.PR_SHERIFF_MODEL ?? 'claude-sonnet-4-20250514';
  const maxTokens = opts.maxTokens ?? 1200;

  const body = {
    model,
    max_tokens: maxTokens,
    temperature: 0,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API error (${res.status}): ${raw}`);
  }

  /** @type {any} */
  const parsed = JSON.parse(raw);
  const text = Array.isArray(parsed?.content)
    ? parsed.content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
    : '';

  const json = parseJsonFromModelText(text);
  return validateJudgeResult(json);
}
