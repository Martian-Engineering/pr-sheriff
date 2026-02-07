# Corpus Indexer

The corpus indexer fetches GitHub PRs/issues, writes them to the on-disk corpus
format (`docs/corpus/...`), and then indexes the corpus with `qmd`.

Script:
- `scripts/qmd-corpus-index.js`

## Prereqs

- `gh` CLI authenticated (e.g. `gh auth status`)
- `qmd` installed (used to index/search the corpus)

## Usage

```bash
node scripts/qmd-corpus-index.js --repo <owner/name>
```

Incremental (updated since):

```bash
node scripts/qmd-corpus-index.js --repo <owner/name> --since 2026-02-01T00:00:00Z
```

Limit work during development:

```bash
node scripts/qmd-corpus-index.js --repo <owner/name> --limit 10 --max-comments 50 --max-reviews 50
```

Dry run (fetch + render only):

```bash
node scripts/qmd-corpus-index.js --repo <owner/name> --limit 1 --dry-run
```

## qmd Behavior

The script attempts to add/index a `qmd` collection rooted at `docs/corpus`:

1. `qmd collection add docs/corpus --name pr-sheriff-corpus --mask "*.md"`
2. If the collection already exists (or add fails), it runs `qmd update`.

You can set a custom qmd index name via `--qmd-index <name>` (passed as
`qmd --index <name>`).

