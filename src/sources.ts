import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import type { Source } from "./types.js";
import { getGlobalOpensrcDir } from "./config.js";

const execFileAsync = promisify(execFile);
const sourceIndexSchema = z.object({
  packages: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        registry: z.enum(["npm", "pypi", "crates"]),
        path: z.string(),
        fetchedAt: z.string(),
      })
    )
    .default([]),
  repos: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        path: z.string(),
        fetchedAt: z.string(),
      })
    )
    .default([]),
});

export async function runOpensrc(
  args: string[],
  cwd = process.cwd()
): Promise<void> {
  const packageJson = createRequire(import.meta.url).resolve("opensrc/package.json");
  const cliPath = join(dirname(packageJson), "bin", "opensrc.js");

  try {
    await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
      env: {
        ...process.env,
        OPENSRC_HOME: getOpensrcDir(),
      },
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`opensrc ${args.join(" ")} failed: ${message}`);
  }
}

/**
 * Get path to global opensrc directory
 */
export function getOpensrcDir(): string {
  return getGlobalOpensrcDir();
}

/**
 * Read sources from opensrc's global index and normalize them to our Source type.
 */
export async function readSources(): Promise<Source[]> {
  const sourcesPath = join(getOpensrcDir(), "sources.json");
  let content: string;

  try {
    content = await readFile(sourcesPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const index = sourceIndexSchema.parse(JSON.parse(content));
  const sources: Source[] = [];

  for (const pkg of index.packages) {
    sources.push({
      type: pkg.registry,
      name: pkg.name,
      version: pkg.version,
      path: pkg.path.replace(/^opensrc\//, ""),
      fetchedAt: pkg.fetchedAt,
      repository: "",
    });
  }

  for (const repo of index.repos) {
    sources.push({
      type: "repo",
      name: repo.name,
      ref: repo.version,
      path: repo.path.replace(/^opensrc\//, ""),
      fetchedAt: repo.fetchedAt,
      repository: `https://${repo.name}`,
    });
  }

  return sources;
}

/**
 * Remove sources by name using opensrc's smart removal
 * (monorepo-aware: only removes repo if no other packages use it)
 */
export async function removeSourcesByName(
  names: string[],
  currentSources: Source[]
): Promise<string[]> {
  const knownNames = names.filter((name) =>
    currentSources.some((source) => source.name === name)
  );
  if (knownNames.length === 0) return [];

  await runOpensrc(["remove", ...knownNames]);
  const remainingSources = await readSources();

  return knownNames.filter(
    (name) => !remainingSources.some((source) => source.name === name)
  );
}

/**
 * Clean sources based on filters
 */
export async function cleanSourcesFiltered(
  currentSources: Source[],
  options: {
    packages?: boolean;
    repos?: boolean;
    npm?: boolean;
    pypi?: boolean;
    crates?: boolean;
  }
): Promise<string[]> {
  const commands: string[][] = [];

  if (options.packages) commands.push(["clean", "--packages"]);
  if (options.repos) commands.push(["clean", "--repos"]);

  if (!options.packages) {
    if (options.npm) commands.push(["clean", "--npm"]);
    if (options.pypi) commands.push(["clean", "--pypi"]);
    if (options.crates) commands.push(["clean", "--crates"]);
  }

  if (commands.length === 0) commands.push(["clean"]);
  for (const command of commands) {
    await runOpensrc(command);
  }

  const remainingSources = await readSources();
  return currentSources
    .filter(
      (source) =>
        !remainingSources.some(
          (remaining) =>
            remaining.type === source.type && remaining.name === source.name
        )
    )
    .map((source) => source.name);
}
