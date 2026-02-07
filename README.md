# pr-sheriff (scaffold)

CLI skeleton for **PR Sheriff**: detect pull requests that are likely safe to close because they have been superseded by newer work.

This repo currently provides a minimal command structure, config loading, and JSON output plumbing.

## Install

```bash
npm install
npm run build
```

## Usage

All commands emit JSON to stdout.

```bash
# Help (JSON)
node dist/cli.js --help

# Analyze a single PR (placeholder)
node dist/cli.js analyze-pr --owner Martian-Engineering --repo pr-sheriff --pr 123

# Batch mode (placeholder)
node dist/cli.js batch --owner Martian-Engineering --repo pr-sheriff --limit 50

# Index (placeholder)
node dist/cli.js index --input ./data/results.json

# Report (placeholder)
node dist/cli.js report --input ./data/index.json --format md
```

## Configuration

Config is loaded from (in order):

1. Defaults
2. Config file (if found)
3. Environment variables (override config file)

### Config file

To specify a config path:

- CLI: `--config /path/to/config.json`
- Env: `PR_SHERIFF_CONFIG=/path/to/config.json`

If neither is set, the loader looks for:

- `./pr-sheriff.config.json`
- `./.pr-sheriffrc.json`
- `~/.config/pr-sheriff/config.json`

Example config JSON:

```json
{
  "githubApiUrl": "https://api.github.com",
  "githubToken": "ghp_...redacted...",
  "openaiApiKey": "sk-...redacted...",
  "model": "gpt-4.1-mini",
  "logLevel": "info"
}
```

### Environment variables

- `PR_SHERIFF_GITHUB_API_URL`
- `PR_SHERIFF_GITHUB_TOKEN`
- `PR_SHERIFF_OPENAI_API_KEY`
- `PR_SHERIFF_MODEL`
- `PR_SHERIFF_LOG_LEVEL`

