import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

async function copyGithubMjs() {
  const srcDir = path.join(repoRoot, 'src', 'github');
  const distDir = path.join(repoRoot, 'dist', 'github');

  await fs.mkdir(distDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith('.mjs')) continue;
    await fs.copyFile(path.join(srcDir, ent.name), path.join(distDir, ent.name));
  }
}

await copyGithubMjs();

