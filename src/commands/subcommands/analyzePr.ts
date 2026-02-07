import { parseArgs } from "node:util";
import type { CommandContext } from "../../types/context.js";

export async function analyzePr(argv: string[], _ctx: CommandContext): Promise<unknown> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      owner: { type: "string" },
      repo: { type: "string" },
      pr: { type: "string" },
      "pr-url": { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });

  if (parsed.values.help) {
    return {
      help: {
        usage: "pr-sheriff analyze-pr --owner OWNER --repo REPO --pr NUMBER [--pr-url URL]",
        options: ["--owner", "--repo", "--pr", "--pr-url"]
      }
    };
  }

  const owner = parsed.values.owner;
  const repo = parsed.values.repo;
  const prRaw = parsed.values.pr;
  if (!owner || !repo || !prRaw) {
    throw new Error("Missing required options: --owner, --repo, --pr");
  }

  const pr = Number(prRaw);
  if (!Number.isFinite(pr) || pr <= 0) {
    throw new Error(`Invalid --pr value: ${prRaw}`);
  }

  return {
    kind: "analyze-pr",
    input: {
      owner,
      repo,
      pr,
      prUrl: parsed.values["pr-url"] ?? null
    },
    status: "not_implemented"
  };
}

