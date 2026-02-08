export type GhRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export type GhRunner = (args: string[], runnerOpts?: any) => Promise<GhRunnerResult>;

export class GitHubFetch {
  constructor(opts: {
    repo: string;
    cacheDir?: string;
    cacheTtlSeconds?: number;
    ghRunner?: GhRunner;
    sleepFn?: (ms: number) => Promise<void>;
    maxBackoffSeconds?: number;
  });

  getPR(number: number, opts?: { useCache?: boolean }): Promise<any>;
  getIssue(number: number, opts?: { useCache?: boolean }): Promise<any>;
  listPRComments(
    number: number,
    opts?: { useCache?: boolean },
  ): Promise<{ issueComments: any[]; reviewComments: any[]; all: any[] }>;
  getIssueTimeline(number: number, opts?: { useCache?: boolean }): Promise<any[]>;
  searchMergedPRs(opts?: {
    query?: string;
    mergedAfter?: string | Date;
    mergedBefore?: string | Date;
    useCache?: boolean;
  }): Promise<any[]>;
}

export function defaultGhRunner(args: string[], runnerOpts?: any): Promise<GhRunnerResult>;

