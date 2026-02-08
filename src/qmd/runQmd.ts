import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { QmdRunResult, QmdRunner } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Default qmd runner.
 *
 * This is intentionally small and injectable so tests can stub qmd output.
 */
export const runQmd: QmdRunner = async (args: string[]): Promise<QmdRunResult> => {
  try {
    const { stdout, stderr } = await execFileAsync("qmd", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return { exitCode: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
  } catch (err) {
    // execFile throws on non-zero status; capture stdout/stderr for nicer errors.
    const e = err as {
      code?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stdout = typeof e.stdout === "string" ? e.stdout : e.stdout ? e.stdout.toString("utf8") : "";
    const stderr = typeof e.stderr === "string" ? e.stderr : e.stderr ? e.stderr.toString("utf8") : "";
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return { exitCode, stdout, stderr: stderr || (e.message ? String(e.message) : "") };
  }
};

