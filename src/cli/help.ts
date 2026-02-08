import type { RootHelp } from "../types/help.js";

export function getRootHelp(): RootHelp {
  return {
    name: "pr-sheriff",
    usage: "pr-sheriff [--config PATH] <command> [options]",
    commands: [
      { name: "analyze-pr", description: "Analyze a single PR (placeholder)" },
      { name: "batch", description: "Analyze many PRs in a repo (placeholder)" },
      { name: "candidates", description: "Retrieve candidate matches via qmd" },
      { name: "index", description: "Build/search a local index (placeholder)" },
      { name: "report", description: "Generate a report from results (placeholder)" }
    ]
  };
}
