/**
 * Minimal global option extraction to support placing options before or after
 * the subcommand without relying on external deps.
 */
export function extractGlobalOptions(argv: string[]): {
  configPath?: string;
  help: boolean;
  rest: string[];
} {
  const rest: string[] = [];
  let configPath: string | undefined;
  let help = false;
  let seenCommand = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;

    if (token === "--help" || token === "-h") {
      // If a subcommand is already present, pass help through for the subcommand.
      if (seenCommand) {
        rest.push(token);
      } else {
        help = true;
      }
      continue;
    }

    if (token === "--config") {
      const next = argv[i + 1];
      if (next) {
        configPath = next;
        i++;
      }
      continue;
    }

    if (token.startsWith("--config=")) {
      configPath = token.slice("--config=".length);
      continue;
    }

    if (!seenCommand && !token.startsWith("-")) {
      seenCommand = true;
    }
    rest.push(token);
  }

  return { configPath, help, rest };
}
