#!/usr/bin/env node
/**
 * OpenClaw PR Supersession Detector - LLM Edition
 * 
 * Uses LLM reasoning to detect when an open PR is semantically superseded
 * by a newer merged PR (even when they don't reference the same issue number).
 * 
 * Run: node pr-supersession-detector-llm.js [--repo=owner/repo] [--limit=20]
 */

import { execSync } from 'child_process';
import { spawnSync } from 'child_process';

const REPO = 'openclaw/openclaw';
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || 20);

function gh(query) {
  try {
    const result = spawnSync('gh', ['api', query], {
      encoding: 'utf-8',
      timeout: 20 * 1000,
      maxBuffer: 5 * 1024 * 1024
    });
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function search(query) {
  return gh(`search/issues?q=${encodeURIComponent(query)}&per_page=100`);
}

// Truncate long bodies for LLM context
function truncate(str, max = 3000) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '\n...[truncated]';
}

// Fetch PR comments
async function getComments(prNumber) {
  try {
    const result = spawnSync('gh', ['api', `repos/${REPO}/issues/${prNumber}/comments`, '--paginate'], {
      encoding: 'utf-8',
      timeout: 15 * 1000,
      maxBuffer: 2 * 1024 * 1024
    });
    const comments = JSON.parse(result.stdout);
    return comments
      .map(c => ({
        author: c.user?.login,
        body: truncate(c.body, 500)
      }))
      .filter(c => c.body && !c.body.includes('<!-- greptile_comment -->'))
      .slice(0, 5); // Limit to 5 most relevant comments
  } catch {
    return [];
  }
}

async function callLLM(prompt) {
  const { spawn } = await import('child_process');
  
  return new Promise((resolve, reject) => {
    const proc = spawn('anthropic', [
      'messages', 'create',
      '--model', 'sonnet',
      '--max-tokens', '1000',
      '--system', 'You analyze GitHub PRs. Respond ONLY with valid JSON.',
      '--prompt', prompt
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let stdout = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => process.stderr.write(d.toString()));
    
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`LLM exited with code ${code}`));
    });
  });
}

async function analyzePR(openPR, mergedPRs) {
  // Fetch comments for open PR
  const openComments = await getComments(openPR.number);
  
  // Fetch comments for merged PRs
  const mergedWithComments = await Promise.all(
    mergedPRs.slice(0, 10).map(async (pr) => ({
      ...pr,
      comments: await getComments(pr.number)
    }))
  );
  
  const prompt = `
You are analyzing GitHub PRs to find ones that can be closed because they're superseded.

OPEN PR #${openPR.number}:
- Title: ${openPR.title}
- Body: ${truncate(openPR.body, 2000)}
- Author: ${openPR.user?.login}
- Created: ${openPR.created_at}
${openComments.length > 0 ? `
Comments:
${openComments.map(c => `- @${c.author}: ${c.body}`).join('\n')}` : ''}

MERGED PRs (sorted by merge date, newest first):
${mergedWithComments.map(pr => `
#${pr.number}: "${pr.title}"
- Body: ${truncate(pr.body, 1500)}
- Author: ${pr.user?.login}
- Merged: ${pr.merged_at}
${pr.comments?.length > 0 ? `
Comments:
${pr.comments.map(c => `- @${c.author}: ${c.body}`).join('\n')}` : ''}
`).join('')}

TASK:
Determine if OPEN PR #${openPR.number} is semantically superseded by any of the MERGED PRs.

Supersession means:
1. The merged PR addresses the same underlying issue/problem
2. The merged PR was merged AFTER the open PR was created
3. The fixes would conflict or make the open PR redundant

Look for:
- Same root cause addressed
- Similar files/functions modified
- Identical problem descriptions
- Comments mentioning related PRs/issues
- Same issue referenced (even if not in PR body)

Respond with ONLY valid JSON:
{
  "isSuperseded": true/false,
  "supersedingPR": number or null,
  "reasoning": "brief explanation of why/how",
  "confidence": "high/medium/low"
}
`;

  try {
    const response = await callLLM(prompt);
    return JSON.parse(response);
  } catch (e) {
    return { isSuperseded: false, reasoning: 'LLM error: ' + e.message, confidence: 'low' };
  }
}

async function main() {
  console.log(`Scanning ${REPO} for superseded PRs...\n`);
  
  // Get open PRs
  const openResult = search(`repo:${REPO} is:pr is:open sort:updated-desc`);
  const openPRs = (openResult?.items || []).slice(0, LIMIT);
  
  // Get merged PRs
  const mergedResult = search(`repo:${REPO} is:pr is:merged sort:updated-desc`);
  const mergedPRs = (mergedResult?.items || []).slice(0, 50);
  
  console.log(`Open PRs: ${openPRs.length}`);
  console.log(`Merged PRs: ${mergedPRs.length}\n`);
  
  const superseded = [];
  
  for (const pr of openPRs) {
    console.log(`Analyzing #${pr.number}: ${pr.title.slice(0, 50)}...`);
    const result = await analyzePR(pr, mergedPRs);
    
    if (result.isSuperseded) {
      const superseding = mergedPRs.find(m => m.number === result.supersedingPR);
      superseded.push({
        pr: pr.number,
        title: pr.title,
        author: pr.user?.login,
        created: pr.created_at.split('T')[0],
        supersededBy: result.supersedingPR,
        supersededByTitle: superseding?.title,
        supersededByAuthor: superseding?.user?.login,
        reasoning: result.reasoning,
        confidence: result.confidence
      });
    }
  }
  
  // Output
  console.log('\n' + '='.repeat(60) + '\n');
  
  if (superseded.length === 0) {
    console.log('✓ No superseded PRs found\n');
    return;
  }
  
  console.log(`## ${superseded.length} PRs Can Be Closed\n`);
  
  for (const r of superseded) {
    console.log(`#${r.pr}: ${r.title}`);
    console.log(`  by @${r.author} (${r.created})`);
    console.log(`  ↳ Superseded by #${r.supersededBy} "${r.supersededByTitle}"`);
    console.log(`    by @${r.supersededByAuthor}`);
    console.log(`  Reasoning: ${r.reasoning}`);
    console.log(`  Confidence: ${r.confidence}\n`);
  }
  
  console.log(`To close: gh pr close ${superseded.map(r => r.pr).join(' ')} --delete-branch\n`);
}

main().catch(console.error);
