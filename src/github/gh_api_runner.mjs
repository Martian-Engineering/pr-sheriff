import { spawn } from 'node:child_process';

/**
 * Run the `gh` CLI with provided arguments and return captured output.
 *
 * This is intentionally a thin wrapper so higher-level code can:
 * - parse `--include` HTTP headers/status itself
 * - inject a fake runner in tests (no live calls)
 */
export async function defaultGhRunner(
  args,
  { stdin = undefined, timeoutMs = 30_000, maxOutputBytes = 20 * 1024 * 1024 } = {},
) {
  /** @type {Buffer[]} */
  const outChunks = [];
  /** @type {Buffer[]} */
  const errChunks = [];

  const child = spawn('gh', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  if (stdin !== undefined) {
    child.stdin.end(stdin);
  } else {
    child.stdin.end();
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  const pushChunk = (chunks, chunk) => {
    chunks.push(chunk);
    const totalBytes = chunks.reduce((n, b) => n + b.length, 0);
    if (totalBytes > maxOutputBytes) {
      child.kill('SIGKILL');
    }
  };

  child.stdout.on('data', (chunk) => pushChunk(outChunks, chunk));
  child.stderr.on('data', (chunk) => pushChunk(errChunks, chunk));

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });
  clearTimeout(timeout);

  return {
    exitCode,
    stdout: Buffer.concat(outChunks).toString('utf-8'),
    stderr: Buffer.concat(errChunks).toString('utf-8'),
    timedOut,
  };
}

