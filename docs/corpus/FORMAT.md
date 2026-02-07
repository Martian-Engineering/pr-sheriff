# QMD Corpus Format (GitHub PRs/Issues)

This repository stores GitHub Pull Requests and Issues as Markdown documents on
disk so they can be indexed with `qmd` and searched/reranked with awareness of
time (created/updated/merged, last activity, etc.).

## Directory Layout

Corpus documents live under:

`docs/corpus/<owner>/<repo>/<type>/<number>.md`

Where:
- `<owner>` is the GitHub org/user (e.g. `Martian-Engineering`)
- `<repo>` is the repository name (e.g. `pr-sheriff`)
- `<type>` is one of:
  - `pull` for pull requests
  - `issue` for issues
- `<number>` is the PR/issue number (e.g. `123`)

Example:

`docs/corpus/OpenClaw/OpenClaw/pull/742.md`

## Document Structure

Each file is a Markdown document with YAML frontmatter:

1. YAML frontmatter contains stable metadata for filtering and timeline-aware
   reranking.
2. The Markdown body contains the human content (title/body) plus a timeline
   section (comments/reviews) in chronological order.

### YAML Frontmatter (Schema v1)

Required fields:
- `schema`: `"pr_sheriff_corpus_v1"`
- `doc_type`: `"github_pull"` or `"github_issue"`
- `repo`: `"owner/name"`
- `number`: integer
- `title`: string
- `state`: `"open"` or `"closed"`
- `url`: string
- `author_login`: string
- `created_at`: ISO8601 string
- `updated_at`: ISO8601 string

Recommended fields:
- `closed_at`: ISO8601 string or null
- `labels`: list of strings
- `assignees`: list of strings (logins)
- `milestone_title`: string or null
- `comment_count`: integer

Pull request only:
- `draft`: boolean
- `merged`: boolean
- `merged_at`: ISO8601 string or null
- `base_ref`: string
- `head_ref`: string
- `head_sha`: string
- `review_count`: integer

Timeline-aware rerank fields (recommended):
- `last_activity_at`: ISO8601 string
  - Intended to be the max timestamp across: `updated_at`, last issue comment,
    last review.
- `timeline_event_count`: integer
- `timeline_first_at`: ISO8601 string or null
- `timeline_last_at`: ISO8601 string or null

Notes:
- Use ISO8601 timestamps from the GitHub API (UTC `Z`) verbatim.
- Keep metadata normalized (logins, label names) to support filters.

### Markdown Body

Suggested sections:

- Title heading:
  - `# PR #<number>: <title>` or `# Issue #<number>: <title>`
- `## Body`:
  - Original PR/issue body text (verbatim).
- `## Timeline`:
  - Chronological list of events with timestamps and actors.

Timeline event format is intentionally simple and text-heavy so `qmd` can index
it well, e.g.:

`### 2026-02-07T12:34:56Z (comment) @somebody`

Followed by the comment/review body.

## Indexing With qmd

This corpus is meant to be indexed as a single `qmd` collection rooted at
`docs/corpus` (or another configured corpus root).

The indexer script in `scripts/qmd-corpus-index.js` uses:
- `qmd collection add <corpusDir> --name <collectionName> --mask "*.md"`
- If the collection already exists, it falls back to `qmd update`.

