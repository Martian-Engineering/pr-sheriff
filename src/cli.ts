#!/usr/bin/env node

import { Command } from 'commander';

/**
 * Entry point for the pr-sheriff CLI.
 *
 * This is intentionally minimal scaffolding so other tasks can fill in
 * commands, config loading, and output formatting.
 */
export function main(argv: string[] = process.argv): void {
  const program = new Command();

  program
    .name('pr-sheriff')
    .description('PR Sheriff CLI (work in progress)')
    .version('0.0.0');

  program
    .command('analyze-pr')
    .argument('<repo>', 'GitHub repo, e.g. owner/name')
    .argument('<prNumber>', 'Pull request number')
    .action((_repo: string, _prNumber: string) => {
      console.error('analyze-pr: not implemented');
      process.exitCode = 1;
    });

  program.parse(argv);
}

main();
