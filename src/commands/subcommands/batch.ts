import { parseArgs } from "node:util";
import type { CommandContext } from "../../types/context.js";

export async function batch(argv: string[], _ctx: CommandContext): Promise<unknown> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      owner: { type: "string" },
      repo: { type: "string" },
      limit: { type: "string" },
      state: { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });

  if (parsed.values.help) {
    return {
      help: {
        usage: "pr-sheriff batch --owner OWNER --repo REPO [--state open] [--limit 50]",
        options: ["--owner", "--repo", "--state", "--limit"]
      }
    };
  }

  const owner = parsed.values.owner;
  const repo = parsed.values.repo;
  if (!owner || !repo) {
    throw new Error("Missing required options: --owner, --repo");
  }

  const limitRaw = parsed.values.limit ?? "50";
  const limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }

  const state = parsed.values.state ?? "open";

  return {
    kind: "batch",
    input: {
      owner,
      repo,
      state,
      limit
    },
    status: "not_implemented"
  };
}

