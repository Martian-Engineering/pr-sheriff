#!/usr/bin/env node
import { loadConfig } from "./config/loadConfig.js";
import { printJson } from "./output/printJson.js";
import { redactConfig } from "./config/redactConfig.js";
import { runCommand } from "./commands/runCommand.js";
import { extractGlobalOptions } from "./cli/extractGlobalOptions.js";
import { getRootHelp } from "./cli/help.js";

/**
 * Entry point for the pr-sheriff CLI.
 *
 * This scaffold focuses on:
 * - a stable subcommand structure
 * - config loading (file + env)
 * - emitting JSON to stdout
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const globals = extractGlobalOptions(argv);

  if (globals.help && globals.rest.length === 0) {
    printJson({ ok: true, help: getRootHelp() });
    return;
  }

  const command = globals.rest[0];
  if (!command) {
    printJson({ ok: false, error: { message: "Missing command", code: "MISSING_COMMAND" }, help: getRootHelp() });
    process.exitCode = 1;
    return;
  }

  const configResult = await loadConfig({ configPath: globals.configPath });
  const ctx = {
    config: configResult.config,
    configMeta: configResult.meta
  };

  try {
    const result = await runCommand(command, globals.rest.slice(1), ctx);
    printJson({
      ok: true,
      command,
      config: redactConfig(configResult.config),
      configMeta: configResult.meta,
      result
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printJson({
      ok: false,
      command,
      config: redactConfig(configResult.config),
      configMeta: configResult.meta,
      error: { message }
    });
    process.exitCode = 1;
  }
}

await main();

