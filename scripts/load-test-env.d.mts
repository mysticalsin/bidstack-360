export declare const TEST_ENV_ALLOWLIST: readonly string[];
export declare function loadTestEnv(
  dotenvFlow: { listFiles: (o: object) => string[]; parse: (f: string[]) => Record<string, string> },
  rootDir: string,
  options?: { allowlist?: readonly string[]; env?: NodeJS.ProcessEnv },
): Record<string, true>;
