import test from 'node:test';
import assert from 'node:assert/strict';

import { stripFirstCodeFence, parseJsonFromModelText } from '../src/llm/judge_parse.mjs';

test('stripFirstCodeFence returns inner content for ```json fences', () => {
  const input = [
    '```json',
    '{ "a": 1 }',
    '```',
  ].join('\n');
  assert.equal(stripFirstCodeFence(input), '{ "a": 1 }');
});

test('stripFirstCodeFence is a no-op when no fences exist', () => {
  assert.equal(stripFirstCodeFence('{ "a": 1 }'), '{ "a": 1 }');
});

test('parseJsonFromModelText parses fenced JSON', () => {
  const input = '```json\n{ "a": 1 }\n```';
  assert.deepEqual(parseJsonFromModelText(input), { a: 1 });
});

test('parseJsonFromModelText recovers JSON object from surrounding text', () => {
  const input = 'Here you go:\n{ "a": 1, "b": "x" }\nThanks!';
  assert.deepEqual(parseJsonFromModelText(input), { a: 1, b: 'x' });
});

