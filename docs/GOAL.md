# PR Sheriff — Project Goal

## Mission
Reduce maintainer burden for large OSS projects (starting with OpenClaw) by automatically identifying open pull requests that are safe to close because they have been **superseded** by newer work.

## What “Superseded” Means
An open PR is considered *superseded* when a newer PR (typically merged) accomplishes the same outcome or resolves the same underlying issue(s), making the older PR redundant.

This tool should:
- Use **semantic reasoning** (LLM + local semantic search), not just string matching.
- Be **time-aware**: newer merged work can supersede older open PRs.
- Follow **reference chains** (PR ↔ issues ↔ other PRs) to detect “resolved by X” chains.
- Provide **structured JSON output** with rationale and confidence.

## Non-Goals (for now)
- No automatic PR closing.
- No daily cron / scheduled runs by default.

## Target Outputs
- A proper CLI that can:
  - Analyze a single PR (`analyze-pr`)
  - Analyze a repo backlog (batch mode)
  - Produce machine-readable JSON reports
  - Produce a human-readable report suitable for sharing (pagedrop)

## Success Metric
Maintainers can regularly run this tool, quickly find redundant PRs, and confidently close them with minimal manual investigation.
