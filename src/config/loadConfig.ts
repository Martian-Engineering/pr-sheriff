import fs from "node:fs/promises";
import type { AppConfig, LogLevel } from "./types.js";
import { findDefaultConfigPath } from "./paths.js";

export type ConfigMeta = {
  path?: string;
  loadedFromFile: boolean;
  loadedFromEnv: string[];
};

function parseLogLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined;
  if (value === "silent" || value === "info" || value === "debug") return value;
  return undefined;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function getDefaults(): AppConfig {
  return {
    githubApiUrl: "https://api.github.com",
    qmdCollection: "pr-sheriff-corpus",
    logLevel: "info"
  };
}

async function loadConfigFile(configPath: string): Promise<Partial<AppConfig>> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Config file is not an object: ${configPath}`);
  }
  return parsed as Partial<AppConfig>;
}

/**
 * Load app configuration from defaults, an optional JSON config file, and env vars.
 *
 * Priority: defaults < file < env
 */
export async function loadConfig(opts: { configPath?: string }): Promise<{ config: AppConfig; meta: ConfigMeta }> {
  const meta: ConfigMeta = { loadedFromFile: false, loadedFromEnv: [] };

  const configPath = opts.configPath ?? env("PR_SHERIFF_CONFIG") ?? (await findDefaultConfigPath());
  let fileConfig: Partial<AppConfig> = {};

  if (configPath) {
    try {
      fileConfig = await loadConfigFile(configPath);
      meta.path = configPath;
      meta.loadedFromFile = true;
    } catch (e) {
      // For a scaffold, missing/unreadable config should not crash by default.
      // It will be surfaced via configMeta.loadedFromFile=false and meta.path.
      meta.path = configPath;
      meta.loadedFromFile = false;
    }
  }

  const envConfig: Partial<AppConfig> = {};
  const githubApiUrl = env("PR_SHERIFF_GITHUB_API_URL");
  if (githubApiUrl) {
    envConfig.githubApiUrl = githubApiUrl;
    meta.loadedFromEnv.push("PR_SHERIFF_GITHUB_API_URL");
  }
  const githubToken = env("PR_SHERIFF_GITHUB_TOKEN");
  if (githubToken) {
    envConfig.githubToken = githubToken;
    meta.loadedFromEnv.push("PR_SHERIFF_GITHUB_TOKEN");
  }
  const openaiApiKey = env("PR_SHERIFF_OPENAI_API_KEY");
  if (openaiApiKey) {
    envConfig.openaiApiKey = openaiApiKey;
    meta.loadedFromEnv.push("PR_SHERIFF_OPENAI_API_KEY");
  }
  const model = env("PR_SHERIFF_MODEL");
  if (model) {
    envConfig.model = model;
    meta.loadedFromEnv.push("PR_SHERIFF_MODEL");
  }
  const qmdCollection = env("PR_SHERIFF_QMD_COLLECTION");
  if (qmdCollection) {
    envConfig.qmdCollection = qmdCollection;
    meta.loadedFromEnv.push("PR_SHERIFF_QMD_COLLECTION");
  }
  const qmdIndex = env("PR_SHERIFF_QMD_INDEX");
  if (qmdIndex) {
    envConfig.qmdIndex = qmdIndex;
    meta.loadedFromEnv.push("PR_SHERIFF_QMD_INDEX");
  }
  const logLevel = parseLogLevel(env("PR_SHERIFF_LOG_LEVEL"));
  if (logLevel) {
    envConfig.logLevel = logLevel;
    meta.loadedFromEnv.push("PR_SHERIFF_LOG_LEVEL");
  }

  const config: AppConfig = {
    ...getDefaults(),
    ...fileConfig,
    ...envConfig
  };

  return { config, meta };
}
