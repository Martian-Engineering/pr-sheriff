import { parseArgs } from "node:util";
import type { CommandContext } from "../../types/context.js";

export async function index(argv: string[], _ctx: CommandContext): Promise<unknown> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });

  if (parsed.values.help) {
    return {
      help: {
        usage: "pr-sheriff index --input PATH [--output PATH]",
        options: ["--input", "--output"]
      }
    };
  }

  const input = parsed.values.input;
  if (!input) throw new Error("Missing required option: --input");

  return {
    kind: "index",
    input: { input, output: parsed.values.output ?? null },
    status: "not_implemented"
  };
}

