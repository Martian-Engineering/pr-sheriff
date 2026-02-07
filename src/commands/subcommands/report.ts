import { parseArgs } from "node:util";
import type { CommandContext } from "../../types/context.js";

export async function report(argv: string[], _ctx: CommandContext): Promise<unknown> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      input: { type: "string" },
      format: { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });

  if (parsed.values.help) {
    return {
      help: {
        usage: "pr-sheriff report --input PATH [--format json|md]",
        options: ["--input", "--format"]
      }
    };
  }

  const input = parsed.values.input;
  if (!input) throw new Error("Missing required option: --input");

  const format = parsed.values.format ?? "json";
  if (format !== "json" && format !== "md") {
    throw new Error(`Invalid --format value: ${format}`);
  }

  return {
    kind: "report",
    input: { input, format },
    status: "not_implemented"
  };
}

