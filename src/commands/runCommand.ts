import type { CommandContext } from "../types/context.js";
import { analyzePr } from "./subcommands/analyzePr.js";
import { batch } from "./subcommands/batch.js";
import { candidates } from "./subcommands/candidates.js";
import { index } from "./subcommands/index.js";
import { report } from "./subcommands/report.js";

/**
 * Dispatch to the requested subcommand.
 */
export async function runCommand(command: string, argv: string[], ctx: CommandContext): Promise<unknown> {
  switch (command) {
    case "analyze-pr":
      return await analyzePr(argv, ctx);
    case "batch":
      return await batch(argv, ctx);
    case "candidates":
      return await candidates(argv, ctx);
    case "index":
      return await index(argv, ctx);
    case "report":
      return await report(argv, ctx);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
