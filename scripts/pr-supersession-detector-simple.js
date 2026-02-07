#!/usr/bin/env node
/**
 * Supersession detector - finds open PRs that reference issues closed by other merged PRs
 * Run: node pr-supersession-detector-simple.js
 */

import { execSync } from 'child_process';

const REPO = 'openclaw/openclaw';
const DAYS = 30;

// Use gh api directly and parse JSON
function ghq(endpoint) {
  try {
    const output = execSync(`gh api "${endpoint}"`, { encoding: 'utf-8', shell: '/bin/bash' });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function main() {
  console.log(`Scanning ${REPO}...\n`);
  
  // Get open PRs
  const allPRs = ghq(`repos/${REPO}/pulls?state=open&per_page=100`) || [];
  
  const prs = allPRs.filter(pr => {
    const daysAgo = (Date.now() - new Date(pr.created_at)) / (1000 * 60 * 60 * 24);
    return daysAgo <= DAYS;
  });
  
  console.log(`Found ${prs.length} open PRs (last ${DAYS} days)\n`);
  
  const results = [];
  
  for (const pr of prs) {
    const refs = new Set();
    pr.body?.match(/#(\d+)/g)?.forEach(m => refs.add(parseInt(m.slice(1))));
    
    if (refs.size === 0) continue;
    
    for (const issueNum of refs) {
      const events = ghq(`repos/${REPO}/issues/${issueNum}/events`);
      if (!events) continue;
      
      const closes = events.filter(e => e.event === 'closed' && e.actor?.type === 'User');
      
      for (const close of closes) {
        const prNum = close.source?.pull_request?.number;
        if (!prNum || prNum === pr.number) continue;
        
        const closingPR = ghq(`repos/${REPO}/pulls/${prNum}`);
        if (closingPR?.merged_at) {
          const isNewer = new Date(pr.created_at) < new Date(closingPR.merged_at);
          
          if (isNewer) {
            results.push({
              pr: pr.number,
              title: pr.title,
              author: pr.user?.login,
              created: pr.created_at?.split('T')[0],
              supersededBy: prNum,
              supersededByTitle: closingPR.title,
              supersededByAuthor: closingPR.user?.login,
              supersededAt: closingPR.merged_at.split('T')[0],
              sameIssue: issueNum
            });
            break;
          }
        }
      }
    }
  }
  
  // Deduplicate
  const seen = new Set();
  const unique = results.filter(r => {
    if (seen.has(r.pr)) return false;
    seen.add(r.pr);
    return true;
  });
  
  if (unique.length === 0) {
    console.log('✓ No superseded PRs found\n');
    return;
  }
  
  console.log(`## ${unique.length} PRs Can Be Closed\n`);
  
  for (const r of unique) {
    console.log(`#${r.pr}: ${r.title}`);
    console.log(`  by @${r.author} (${r.created})`);
    console.log(`  ↳ Superseded by #${r.supersededBy} "${r.supersededByTitle}"`);
    console.log(`    by @${r.supersededByAuthor} (merged ${r.supersededAt})`);
    console.log(`    Both reference issue #${r.sameIssue}\n`);
  }
  
  console.log(`To close: gh pr close ${unique.map(r => r.pr).join(' ')} --delete-branch\n`);
}

main();
