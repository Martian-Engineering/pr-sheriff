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

  // Note: `src/github/*.mjs` and `src/graph/*.mjs` are plain JS modules. We use
  // dynamic import here to avoid requiring TS declaration files for them.
  const [{ GitHubFetch }, { buildReferenceGraph }] = await Promise.all([
    import("../../github/index.mjs"),
    import("../../graph/index.mjs")
  ]);

  const gh = new GitHubFetch({ repo: `${owner}/${repo}` });
  const graph = await buildReferenceGraph({ gh, owner, repo, prNumber: pr });

  return {
    kind: "analyze-pr",
    input: {
      owner,
      repo,
      pr,
      prUrl: parsed.values["pr-url"] ?? null
    },
    graph,
    status: "ok"
  };
}
