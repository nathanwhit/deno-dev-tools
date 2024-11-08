import { findIncompleteOps } from "./main.ts";
import { assertEquals } from "@std/assert";

function tag<TValues extends unknown[]>(
  parts: TemplateStringsArray,
  ...values: TValues
): string {
  return parts
    .flatMap((part, i) =>
      i < values.length ? [part, String(values[i])] : [part]
    )
    .join("");
}

function getIndentFunction(indent: string) {
  if (indent.length === 0) {
    return (l: string) => l;
  } else {
    return (l: string) => indent + l;
  }
}
function reindent(
  lines: string[],
  indentAddFunction: (l: string) => string,
  indentCutFunction: (l: string) => string | undefined,
) {
  const lastIndex = lines.length - 1;
  return lines.map((value, index) => {
    if ((index === 0 || index === lastIndex) && value.trim().length === 0) {
      return undefined;
    } else {
      const res = indentCutFunction(value);
      return res ? indentAddFunction(res) : value;
    }
  }).filter((l) => l !== undefined).join("\n");
}

function min(v: number[]) {
  if (v.length === 0) {
    return;
  }
  let soFar = v[0];

  for (const n of v) {
    if (n > soFar) {
      soFar = n;
    }
  }
  return soFar;
}

function replaceIndent(s: string, newIndent: string) {
  const lines = s.split("\n");
  const minCommonIndent = min(
    lines.filter((l) => l.trim().length > 0).map((l) =>
      l.length - l.trimStart().length
    ),
  ) ?? 0;
  return reindent(
    lines,
    getIndentFunction(newIndent),
    (l) => l.slice(Math.min(minCommonIndent, l.length)),
  );
}

function trimIndent(s: string): string {
  return replaceIndent(s, "");
}

function indented<TValues extends unknown[]>(
  parts: TemplateStringsArray,
  ...values: TValues
): string {
  const res = tag(parts, ...values);

  return trimIndent(res);
}

Deno.test(function indentWorks() {
  assertEquals(
    indented`
      hello
      world`,
    "hello\nworld",
  );
});

function test(name: string, input: string, output: string | string[]) {
  if (typeof output === "string") {
    output = [output];
  }
  Deno.test({
    name,
    fn() {
      assertEquals(findIncompleteOps(input).sort(), output.sort());
    },
  });
}

test(
  "basic",
  indented`
  [     2.686] op_read                                            : Dispatched Async
  [     2.686] op_write                                            : Dispatched Async
  [     2.686] op_read                                            : CompletedAsync Async
  `,
  "op_write",
);
