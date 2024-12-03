import { Command } from "@cliffy/command";

function updateOrDefault<K, V>(
  map: Map<K, V>,
  key: K,
  def: V,
  update: (v: V) => V,
) {
  const res = update(map.get(key) ?? def);
  map.set(key, res);
}

export function findIncompleteOps(contents: string): string[] {
  const lines = contents.split("\n").map((l) => l.trim()).filter((l) =>
    l.length > 0
  );

  const startRe = /(op_[\w_]+)\s*:\s*Dispatched\s+Async/;
  const completeRe = /(op_[\w_]+)\s*:\sCompleted(?:Async)?\s+Async/;

  const counts = new Map<string, number>();

  for (const line of lines) {
    const maybeStart = line.match(startRe);
    if (maybeStart) {
      const opName = maybeStart[1];
      updateOrDefault(counts, opName, 0, (n) => n + 1);
      continue;
    }
    const maybeComplete = line.match(completeRe);
    if (maybeComplete) {
      const opName = maybeComplete[1];
      updateOrDefault(counts, opName, 0, (n) => n - 1);
    }
  }

  const incomplete = [];
  for (const [op, count] of counts.entries()) {
    if (count < 0) {
      throw new Error(`Bug: ${op} ${count}`);
    }
    if (count > 0) {
      incomplete.push(op);
    }
  }
  return incomplete;
}

export const command = new Command().name("find-refed-ops").arguments(
  "<logfile:string>",
).action(
  async (_, logFile) => {
    const contents = await Deno.readTextFile(logFile);
    const incomplete = findIncompleteOps(contents);
    console.log(`Incomplete ops: ${incomplete}`);
  },
);

if (import.meta.main) {
  await command.parse(Deno.args);
}
