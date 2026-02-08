import { parseArgs } from "node:util";

import type { CommandContext } from "../../types/context.js";
import { retrieveCandidates } from "../../candidates/retrieveCandidates.js";

export async function candidates(argv: string[], ctx: CommandContext): Promise<unknown> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      summary: { type: "string" },
      n: { type: "string" },
      "qmd-collection": { type: "string" },
      "qmd-index": { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });

  if (parsed.values.help) {
    return {
      help: {
        usage: "pr-sheriff candidates --summary TEXT [--n N] [--qmd-collection NAME] [--qmd-index NAME]",
        options: ["--summary", "--n", "--qmd-collection", "--qmd-index"]
      }
    };
  }

  const summary = parsed.values.summary;
  if (!summary) throw new Error("Missing required option: --summary");

  const nRaw = parsed.values.n ?? "10";
  const n = Number(nRaw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --n value: ${nRaw}`);

  const qmdCollection = parsed.values["qmd-collection"] ?? ctx.config.qmdCollection;
  const qmdIndex = parsed.values["qmd-index"] ?? ctx.config.qmdIndex;

  const res = await retrieveCandidates({
    summary,
    n,
    config: { qmdCollection, qmdIndex }
  });

  return {
    kind: "candidates",
    input: { summary, n, qmdCollection, qmdIndex: qmdIndex ?? null },
    ...res
  };
}

