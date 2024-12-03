#!/usr/bin/env deno -A

import { Command } from "@cliffy/command";
import { HelpCommand } from "@cliffy/command/help";
import { command as flaky } from "@nathan/dev-tools-flaky";
import { command as bisect } from "@nathan/dev-tools-bisect";
import { command as registry } from "@nathan/devtools-registry";
import { command as findRefed } from "@nathan/unpaired-ops";

async function main() {
  await new Command()
    .name("dev-tools")
    .default("help")
    .command("flaky", flaky)
    .command("bisect", bisect)
    .command("registry", registry)
    .command("find-refed-ops", findRefed)
    .command("help", new HelpCommand().global())
    .parse(Deno.args);
}

if (import.meta.main) {
  await main();
}
