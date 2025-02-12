import { type LogResult, type SimpleGit, simpleGit } from "npm:simple-git";
import { Command } from "@cliffy/command";
import $ from "@david/dax";
import { exists } from "jsr:@std/fs@0.221.0/exists";

type Ref = {
  type: "versioned";
  major: number;
  minor: number;
  patch: number;
} | {
  type: "canary";
  hash: string;
};

function parseNumber(s: string): number {
  const result = Number(s);
  if (isNaN(result)) {
    throw new Error(`not a number: ${s}`);
  }
  return result;
}

function parseRef(s: string): Ref {
  s = s.trim();
  if (s.includes(".")) {
    // versioned
    if (s.startsWith("v")) {
      s = s.slice(1);
    }
    const parts = s.split(".");
    const [major, minor, patch] = parts.map(parseNumber);
    return {
      type: "versioned",
      major,
      minor,
      patch,
    };
  } else {
    return {
      type: "canary",
      hash: s.trim(),
    };
  }
}

type Commits = LogResult;

function assertNever(_never: never): never {
  throw new Error("unreachable");
}

function findCommitWith(
  commits: Commits,
  pattern: string | RegExp,
): string | undefined {
  if (typeof pattern === "string") {
    pattern.replaceAll(/\./g, "\\.");
  }
  for (const commit of commits.all) {
    if (commit.message.match(pattern)) {
      return commit.hash;
    }
  }
}

function refToMainCommit(commits: Commits, ref: Ref): string | undefined {
  switch (ref.type) {
    case "versioned": {
      const { major, minor, patch } = ref;
      const versionString = `${major}.${minor}.${patch}`;
      if (ref.patch === 0) {
        return findCommitWith(
          commits,
          `Bumped versions for ${versionString}`,
        );
      } else {
        return findCommitWith(
          commits,
          `forward v${versionString} release commit to main`,
        );
      }
    }
    case "canary": {
      return ref.hash;
    }
    default:
      assertNever(ref);
  }
}

async function candidateCanaries(
  git: SimpleGit,
  commits: Commits,
  from: Ref,
  to: Ref,
): Promise<string[]> {
  const fromCommit = refToMainCommit(commits, from);
  const toCommit = refToMainCommit(commits, to);

  console.log("TO FROM COMMIT", fromCommit, toCommit);

  if (!fromCommit || !toCommit) {
    throw new Error("couldn't find commits");
  }

  const between = await git.log({ from: fromCommit, to: toCommit });
  const hashes = between.all.map((c) => c.hash);
  hashes.push(fromCommit);
  hashes.reverse();
  return hashes;
}

const enum Result {
  Good,
  Bad,
  SourceBad,
}

async function runScript(script: string): Promise<Result> {
  const res = await $`deno run -A --no-lock ${script}`.noThrow();
  if (res.code === 0) {
    return Result.Good;
  } else if (res.code === 125) {
    return Result.SourceBad;
  } else {
    return Result.Bad;
  }
}

const enum Satisfies {
  Yes,
  No,
  Unknown,
}

async function leastSatisfying<
  T,
  P extends (
    arg: T,
    remaining: number,
    estimate: number,
  ) => Promise<Satisfies> | Satisfies,
>(possible: T[], pred: P): Promise<number> {
  const cache = new Map<number, Satisfies>();
  const predicate = async (idx: number, rm: number, est: number) => {
    const range = est - rm + 1;
    const remaining = Math.trunc(range / 2);
    let estimate: number;
    if (range < 3) {
      estimate = 0;
    } else {
      estimate = Math.trunc(Math.log2(range));
    }
    const cached = cache.get(idx);
    if (cached !== undefined) {
      return cached;
    }
    const result = await pred(possible[idx], remaining, estimate);
    cache.set(idx, result);
    return result;
  };
  const unknownRanges: [number, number][] = [];
  let rmNo = 0;

  let lmYes = possible.length - 1;

  let next = Math.trunc((rmNo + lmYes) / 2);

  while (true) {
    if (rmNo + 1 === lmYes) {
      return lmYes;
    }
    for (const [left, right] of unknownRanges) {
      if (rmNo + 1 === left && right + 1 === lmYes) {
        return lmYes;
      }
      if (left <= next && next <= right) {
        if (rmNo < left - 1) {
          next = left - 1;
        } else if (right < lmYes) {
          next = right + 1;
        }
        break;
      }
    }
    const r = await predicate(next, rmNo, lmYes);
    switch (r) {
      case Satisfies.Yes: {
        lmYes = next;
        next = Math.trunc((rmNo + lmYes) / 2);
        break;
      }
      case Satisfies.No: {
        rmNo = next;
        next = Math.trunc((rmNo + lmYes) / 2);
        break;
      }
      case Satisfies.Unknown: {
        let left = next;
        while (
          left > 0 && (await predicate(left, rmNo, lmYes)) === Satisfies.Unknown
        ) {
          left -= 1;
        }
        let right = next;
        while (
          right + 1 < possible.length &&
          ((await predicate(right, rmNo, lmYes)) === Satisfies.Unknown)
        ) {
          right += 1;
        }
        unknownRanges.push([left + 1, right - 1]);
        next = left;
        break;
      }
      default:
        assertNever(r);
    }
  }
}

async function upgradeDeno(hash: string) {
  await $`deno upgrade --canary --version ${hash}`.quiet();
  // const result = await $`deno --version`;
  // console.log(result.stdout);
}

export const command = new Command().option(
  "-f, --from <from:string>",
  "last good version",
  { required: true },
).option("-t, --to <to:string>", "known bad version", { required: true })
  .option("--checkout <path:string>", "path to existing deno checkout")
  .arguments("<isGoodScript:string>")
  .action(
    async ({ from, to, checkout }, script: string) => {
      if (checkout && !(await exists(checkout))) {
        throw new Error("bad checkout path, doesn't exist");
      } else if (checkout) {
        await $`git pull`.cwd(checkout);
      } else {
        const temp = await Deno.makeTempDir();
        await $`git clone --no-checkout https://github.com/denoland/deno ${temp}`;
        checkout = temp;
      }
      const foo = simpleGit(checkout);

      const fromRef = parseRef(from);
      const toRef = parseRef(to);
      const log = await foo.log();
      const canaries = await candidateCanaries(foo, log, fromRef, toRef);

      const regressed = await leastSatisfying(
        canaries,
        async (hash, remaining, estimated) => {
          console.log(
            `on ${hash}: ${remaining} versions to test after this (roughly ${estimated} steps)`,
          );
          try {
            await upgradeDeno(hash);
          } catch (_) {
            console.error("canary build doesn't exist, skipping");
            return Satisfies.Unknown;
          }
          const result = await runScript(script);
          switch (result) {
            case Result.Good:
              return Satisfies.No;
            case Result.Bad:
              return Satisfies.Yes;
            case Result.SourceBad:
              return Satisfies.Unknown;
          }
        },
      );

      console.log("Bisection complete, regressed in", canaries[regressed]);
    },
  );
