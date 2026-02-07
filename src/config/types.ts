export type LogLevel = "silent" | "info" | "debug";

export type AppConfig = {
  githubApiUrl: string;
  githubToken?: string;
  openaiApiKey?: string;
  model?: string;
  logLevel: LogLevel;
};

