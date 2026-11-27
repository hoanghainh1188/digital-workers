export type ConfigIssue = {
  readonly name: string;
  readonly reason: string;
};

/**
 * Thrown when environment configuration is missing or invalid.
 * Carries variable names and short reasons only — never the values.
 */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(formatIssues(issues));
    this.name = 'ConfigError';
    this.issues = Object.freeze([...issues]);
  }
}

export function formatIssues(issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => `  - ${issue.name}: ${issue.reason}`);
  return ['Invalid configuration:', ...lines].join('\n');
}
