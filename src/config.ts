import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Get the global opensrc directory path.
 */
export function getGlobalOpensrcDir(): string {
  return (
    process.env.OPENSRC_HOME ??
    process.env.OPENSRC_DIR ??
    join(homedir(), ".opensrc")
  );
}

/**
 * Get the project directory to pass to opensrc for lockfile resolution.
 */
export function getOpensrcCwd(): string {
  return process.cwd();
}
