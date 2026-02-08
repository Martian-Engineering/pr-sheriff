export type QmdRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type QmdRunner = (args: string[]) => Promise<QmdRunResult>;

