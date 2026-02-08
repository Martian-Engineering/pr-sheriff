export type LogLevel = "silent" | "info" | "debug";

export type AppConfig = {
  githubApiUrl: string;
  githubToken?: string;
  openaiApiKey?: string;
  model?: string;
  /**
   * qmd collection name used for corpus search (see docs/corpus/INDEXER.md).
   */
  qmdCollection: string;
  /**
   * Optional qmd index name (passed as: qmd --index <name> ...).
   */
  qmdIndex?: string;
  logLevel: LogLevel;
};
