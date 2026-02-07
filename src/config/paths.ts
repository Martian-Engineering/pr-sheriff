import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the first existing default config path, if any.
 */
export async function findDefaultConfigPath(): Promise<string | undefined> {
  const candidates = [
    path.resolve(process.cwd(), "pr-sheriff.config.json"),
    path.resolve(process.cwd(), ".pr-sheriffrc.json"),
    path.join(os.homedir(), ".config", "pr-sheriff", "config.json")
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return undefined;
}

