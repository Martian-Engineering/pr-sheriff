import type { AppConfig } from "../config/types.js";
import type { ConfigMeta } from "../config/loadConfig.js";

export type CommandContext = {
  config: AppConfig;
  configMeta: ConfigMeta;
};

