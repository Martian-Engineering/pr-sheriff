#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

/**
 * Copy runtime `.mjs` modules from `src/` into `dist/`.
 *
 * The project uses TypeScript for the CLI, but keeps some runtime modules as `.mjs`.
 * `tsc` won't emit these, so we copy them in a post-build step.
 */
function main() {
  const repoRoot = process.cwd();
  const srcRoot = path.join(repoRoot, "src");
  const distRoot = path.join(repoRoot, "dist");

  if (!fs.existsSync(distRoot)) {
    fs.mkdirSync(distRoot, { recursive: true });
  }

  /** @type {string[]} */
  const files = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith(".mjs")) files.push(full);
    }
  }
  walk(srcRoot);

  for (const srcPath of files) {
    const rel = path.relative(srcRoot, srcPath);
    const dstPath = path.join(distRoot, rel);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
  }
}

main();

