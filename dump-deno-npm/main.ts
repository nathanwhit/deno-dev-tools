import semver, { SemVer } from "semver";
import { Command } from "@cliffy/command";
import { type Static, type StaticDecode, Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { AssertError, Value } from "@sinclair/typebox/value";
import util from "node:util";

export const command = new Command().name("dump-deno-npm").arguments(
  "<package:string>",
).action(
  async (_opts, packageName) => {
    await dumpDenoNpm(packageName);
  },
);

interface Hashable {
  hash(): string;
}

class HashMap<K extends Hashable, V> {
  keys() {
    return this.hashMap.values();
  }
  private map: Map<string, V> = new Map();
  private hashMap: Map<string, K> = new Map();

  get(key: K): V | undefined {
    return this.map.get(key.hash());
  }

  set(key: K, value: V): void {
    this.map.set(key.hash(), value);
    this.hashMap.set(key.hash(), key);
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries().map((
      [hash, value],
    ) => [this.hashMap.get(hash)!, value]);
  }
}

class HashableSemVer extends SemVer implements Hashable {
  hash(): string {
    return this.version;
  }
}

function mapObject<T, U>(
  obj: Record<string, T>,
  fn: (key: PropertyKey, value: T) => [PropertyKey, U] | undefined,
): {
  [key: string]: U;
} {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => fn(key, value)).filter((entry) =>
      entry !== undefined
    ),
  );
}

function objectToHashMap<T, K extends Hashable, V>(
  obj: Record<PropertyKey, T>,
  fn: (key: PropertyKey, value: T) => [K, V] | undefined,
): HashMap<K, V> {
  const hashMap = new HashMap<K, V>();
  Object.entries(obj).forEach(([key, value]) => {
    const entry = fn(key, value);
    if (entry !== undefined) {
      hashMap.set(entry[0], entry[1]);
    }
  });
  return hashMap;
}

function hashMapToObject<T, K extends Hashable, V>(
  hashMap: HashMap<K, V>,
  fn: (key: K, value: V) => [PropertyKey, T] | undefined,
): Record<PropertyKey, T> {
  return Object.fromEntries(
    Array.from(hashMap.entries()).map(([key, value]) => fn(key, value)).filter(
      (entry) => entry !== undefined,
    ),
  );
}

const NpmPackageVersionInfo = Type.Transform(Type.Object({
  name: Type.String(),
  version: Type.String(),
  dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
  peerDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
  peerDependenciesMeta: Type.Optional(Type.Record(Type.String(), Type.Any())),
  // dist: Type.Object({
  //   tarball: Type.String(),
  // }),
})).Decode((value) => {
  return {
    ...value,
    dependencies: value.dependencies
      ? mapObject(
        value.dependencies,
        (dep, version) => {
          try {
            return [dep, parseDepEntry(dep.toString(), version)];
          } catch (_error) {
            return undefined;
          }
        },
      )
      : {},
    peerDependencies: value.peerDependencies
      ? mapObject(
        value.peerDependencies,
        (dep, version) => {
          try {
            return [dep, parseDepEntry(dep.toString(), version)];
          } catch (_error) {
            return undefined;
          }
        },
      )
      : {},
  };
}).Encode((value) => {
  return {
    ...value,
    dependencies: value.dependencies
      ? mapObject(
        value.dependencies,
        (dep, entry) => [dep, entry.range.toString()],
      )
      : undefined,
    peerDependencies: value.peerDependencies
      ? mapObject(
        value.peerDependencies,
        (dep, entry) => [dep, entry.range.toString()],
      )
      : undefined,
  };
});

type RawNpmPackageInfo = Static<typeof NpmPackageInfoSchema>;
type NpmPackageInfo = StaticDecode<typeof NpmPackageInfoSchema>;
type RawNpmPackageVersionInfo = Static<typeof NpmPackageVersionInfo>;
type NpmPackageVersionInfo = StaticDecode<typeof NpmPackageVersionInfo>;

const NpmPackageInfoSchema = Type.Transform(Type.Object({
  name: Type.Optional(Type.String()),
  // description: Type.String(),
  versions: Type.Record(Type.String(), NpmPackageVersionInfo),
  "dist-tags": Type.Record(Type.String(), Type.String()),
})).Decode((value) => {
  return {
    ...value,
    versions: objectToHashMap(
      value.versions,
      (version, info) => [new HashableSemVer(version.toString()), info],
    ),
    distTags: mapObject(
      value["dist-tags"],
      (tag, version) => [tag, new HashableSemVer(version)],
    ),
    getVersionInfo(
      version: string | HashableSemVer,
    ): NpmPackageVersionInfo | undefined {
      let semverVersion: HashableSemVer;
      if (typeof version === "string") {
        if (!isDigit(version[0])) {
          semverVersion = new HashableSemVer(this.distTags[version]);
        } else {
          semverVersion = new HashableSemVer(version);
        }
      } else {
        semverVersion = version;
      }
      return this.versions.get(semverVersion);
    },
  };
}).Encode((value) => {
  return {
    ...value,
    versions: hashMapToObject(
      value.versions,
      (version, info) => [version.toString(), info],
    ),
    "dist-tags": mapObject(
      value.distTags,
      (tag, version) => [tag, version.toString()],
    ),
  };
});

const NpmPackageInfoCompiler = TypeCompiler.Compile(NpmPackageInfoSchema);

function parseNpmPackageInfo(
  packageName: string,
  data: unknown,
): NpmPackageInfo {
  try {
    const ok = NpmPackageInfoCompiler.Check(data);
    if (ok) {
      const result = NpmPackageInfoCompiler.Decode(
        data,
      );
      return result;
    } else {
      throw new Error(
        `Failed to parse npm package info for ${packageName}, data: "${
          util.inspect(data)
        }", errors: ${
          JSON.stringify(NpmPackageInfoCompiler.Errors(data).First())
        }`,
      );
    }
  } catch (error) {
    if (error instanceof AssertError) {
      throw new Error(
        `Failed to parse npm package info for ${packageName}, data: "${
          util.inspect(data)
        }", errors: ${
          JSON.stringify(Value.Errors(NpmPackageInfoSchema, data).First())
        }`,
      );
    }
    throw error;
  }
}

class NpmRegistry {
  packages: Map<string, NpmPackageInfo> = new Map();

  async fetch(packageName: string) {
    if (this.packages.has(packageName)) {
      return this.packages.get(packageName)!;
    }
    const npmPackageInfo = await fetchNpmPackageInfo(packageName);
    if (npmPackageInfo) {
      this.packages.set(packageName, npmPackageInfo);
    }
    return npmPackageInfo;
  }
}

async function fetchNpmPackageInfo(packageName: string) {
  const url = `https://registry.npmjs.org/${packageName}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) {
    return undefined;
  }
  return parseNpmPackageInfo(packageName, data);
}

function isDigit(str: string) {
  return !isNaN(Number(str));
}

function parseDepEntry(key: string, value: string): DepEntry {
  if (value.startsWith("npm:")) {
    const rest = value.slice(4);
    if (rest.startsWith("@")) {
      const [name, range] = rest.slice(1).split("@");
      return {
        name: `@${name}`,
        alias: key,
        range: new semver.Range(range),
      };
    } else {
      const [name, range] = rest.split("@");
      return {
        name,
        alias: key,
        range: new semver.Range(range),
      };
    }
  } else {
    return {
      name: key,
      range: new semver.Range(value),
    };
  }
}

interface DepEntry {
  name: string;
  alias?: string;
  range: semver.Range;
}

async function dumpDenoNpm(packageNv: string) {
  let [packageName, version] = packageNv.split("@");
  if (!version) {
    version = "latest";
  }

  const npmRegistry = new NpmRegistry();

  const allDeps = new Set<string>();
  const npmPackageInfo = await npmRegistry.fetch(packageName);
  if (!npmPackageInfo) {
    throw new Error(`Package ${packageName} not found`);
  }
  const versionInfo = npmPackageInfo.getVersionInfo(version);

  if (!versionInfo) {
    throw new Error(`Package ${packageName} does not have version ${version}`);
  }

  const seen = new Set<string>();

  const queue: [string, semver.Range][] = [];
  for (const dep of Object.values(versionInfo.dependencies)) {
    queue.push([dep.name, dep.range]);
  }
  while (queue.length > 0) {
    const [dep, range] = queue.shift()!;
    console.log("on", dep);
    const depPackageInfo = await npmRegistry.fetch(dep);
    if (!depPackageInfo) {
      console.log(`Package ${dep} not found`);
      continue;
    }
    for (const [version, info] of depPackageInfo.versions.entries()) {
      const semverVersion = new HashableSemVer(version);
      if (range.test(semverVersion)) {
        const deps: string[] = [];
        const dependencies = Object.values(info.dependencies);
        dependencies.push(...Object.values(info.peerDependencies));
        for (const dep of dependencies) {
          const key = `${dep.name}@${dep.range.toString()}`;
          if (seen.has(key)) {
            continue;
          }
          deps.push(dep.name);
          seen.add(key);
          queue.push([dep.name, dep.range]);
        }
        if (deps.length > 0) {
          const proms = deps.map(async (dep) => {
            await npmRegistry.fetch(dep);
          });
          await Promise.all(proms);
        }
      }
    }
  }

  console.log("---- packages --- ", npmRegistry.packages.size, " ------ ");

  for (const [packageName, packageInfo] of npmRegistry.packages.entries()) {
    const json = Value.Encode(NpmPackageInfoSchema, packageInfo);
    Deno.writeTextFileSync(
      `./packages/${packageName.replace("/", "__")}.json`,
      JSON.stringify(json, null, 2),
    );
    // console.log(packageInfo.versions.keys());
  }
}
// console.log(new semver.Range(">1.2.3"));
