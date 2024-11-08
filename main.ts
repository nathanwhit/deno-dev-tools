#!/usr/bin/env deno run -A

import $ from "@david/dax";
import { pooledMap } from "@std/async";
import { Command } from "@cliffy/command";
import { split } from "npm:shlex";

let c = 0;
async function runIt(test: string, args?: string[]) {
  // const testPath = $.path(test).resolve();

  const filterArg = args ? args : [];
  const child = $`${test} ${filterArg}`.stderr("piped").stdout(
    "piped",
  )
    .noThrow(true).env({ "RUST_BACKTRACE": "1" }).spawn();
  c++;
  if (c % 5 == 0) {
    // console.log("Spawned " + c);
  }
  const out = await child;
  if (out.code !== 0) {
    throw new Error(
      `Command failed (code ${out.code}): \n  ${out.stderr}\n  ${out.stdout}`,
    );
  }
}

function* seq(n: number) {
  for (let i = 0; i < n; i++) {
    yield i;
  }
}

async function consume<T>(iter: AsyncIterableIterator<T>, len: number) {
  const pb = $.progress("Runs", { length: len });
  let i = 0;
  for await (const _ of iter) {
    pb.increment();
    i++;
    // if (i % 5 === 0) {
    //   console.log("On run " + i);
    // }
    // do nothing
  }
  pb.finish();
}

async function pooled<T>(
  concurrencyLimit: number,
  n: number,
  fn: () => Promise<T>,
) {
  const iter = pooledMap(concurrencyLimit, seq(n), fn);
  await consume(iter, n);
}

async function main() {
  await new Command()
    .arguments("<testBin:string> [...args]")
    .stopEarly()
    .option("-n, --count <count:number>", "Number of times to run the test", {
      default: 250,
    })
    .option("--raw", "Split args by space")
    .option(
      "--limit <limit:number>",
      "Max number of tests to run concurrently",
      {
        default: 25,
      },
    ).action(async (
      {
        limit,
        count,
        raw,
      },
      testBin,
      ...args
    ) => {
      await pooled(
        limit,
        count,
        () => runIt(testBin, raw ? split(args[0]) : args),
      );
      console.log("DONE");
    }).parse(Deno.args);
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(e);
    await $`killall deno`;
  }
}
