import type { AppConfig } from "./types.js";

/**
 * Redact secrets (tokens/keys) from config for JSON output.
 */
export function redactConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    githubToken: config.githubToken ? "[REDACTED]" : undefined,
    openaiApiKey: config.openaiApiKey ? "[REDACTED]" : undefined
  };
}

