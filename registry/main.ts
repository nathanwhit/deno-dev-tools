import { Command } from "@cliffy/command";
import { trimIndent2 } from "@nathan/devtools-util";
import { basename, dirname, join, SEPARATOR } from "@std/path";
import { walk } from "@std/fs";

import $ from "@david/dax";

type Args = {
  deps: string[];
  version: string;
  outputPath: string;
  name: string;
};

type Dep = {
  name: string;
  versionReq: string;
};

function parseDep(dep: string): Dep {
  dep = dep.trim();
  const parts = dep.split("@");
  const name = parts[0];
  let versionReq = "*";
  if (parts.length > 1) {
    versionReq = parts[1];
  }
  return {
    name,
    versionReq,
  };
}

class PublishError extends Error {
  constructor(message?: string, public logs?: string) {
    super(message);
  }
}

class AlreadyPublished extends PublishError {}

async function publish(path: string) {
  const result = await $`npm publish`.cwd(path).captureCombined(true).noThrow(
    true,
  );
  if (result.code !== 0) {
    if (result.combined.includes("this package is already present")) {
      throw new AlreadyPublished();
    } else {
      throw new PublishError(
        `publish failed with exit code ${result.code}`,
        result.combined,
      );
    }
  }
}

async function tryPublish(path: string) {
  try {
    await publish(path);
    const packageJson = await readPackageJson(join(path, "package.json"));
    console.log(`Published ${packageJson.name}@${packageJson.version}`);
    return true;
  } catch (error) {
    if (error instanceof AlreadyPublished) {
      return false;
    }
    throw error;
  }
}

async function publishAll(startDir: string) {
  const entries = walk(startDir, {
    includeFiles: true,
    includeDirs: false,
  });
  const promises = [];
  for await (const entry of entries) {
    if (basename(entry.path) === "package.json") {
      const parent = dirname(entry.path);
      promises.push(tryPublish(parent));
    }
  }
  await Promise.all(promises);
}

async function readPackageJson(path: string) {
  if (basename(path) !== ("package.json")) {
    throw new Error(`should be a package.json, not ${path}`);
  }
  const contents = await Deno.readTextFile(path);
  const json = JSON.parse(contents);

  if (typeof json !== "object" || json === null || json == undefined) {
    throw new Error(`Bad package.json: ${json}`);
  }

  return json;
}

async function setupPackage(args: Args) {
  const {
    deps,
    version,
    outputPath,
    name,
  } = args;

  console.log(`Setting up package`, args);
  const depsParsed = deps.map(parseDep);
  const depsString = depsParsed.map(({ name, versionReq }) =>
    `"${name}": "${versionReq}"`
  ).join(",\n");
  const packageJson = trimIndent2(`
    {
      "name": "${name}",
      "version": "${version}",
      "dependencies": {
        ${depsString} 
      }
    }`);

  let path = "";
  if (outputPath.endsWith(SEPARATOR)) {
    path = outputPath.trim();
  } else {
    path = join(outputPath.trim(), name.replace("/", SEPARATOR), version);
  }
  await Deno.mkdir(path, {
    recursive: true,
  });
  await Deno.writeTextFile(join(path, "package.json"), packageJson);
}

export const command = new Command()
  .default("make-package")
  .command(
    "make-package",
  ).arguments(
    "<name:string>",
  ).option(
    "-d, --dep <req:string>",
    "With dependency",
    {
      collect: true,
    },
  )
  .option("-v, --version <version:string>", "With version", {
    default: "1.0.0",
  })
  .option("-o, --out <path:string>", "output path", { default: "." })
  .action(async ({ dep, version, out }, name) => {
    await setupPackage({
      deps: dep ?? [],
      version,
      outputPath: out,
      name,
    });
  })
  .command("publish-all")
  .arguments("[path:string]")
  .action(async (_, path) => {
    await publishAll(path ?? ".");
  });

async function main() {
  await command.parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
