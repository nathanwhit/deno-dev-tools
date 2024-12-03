import { findIncompleteOps } from "./main.ts";
import { assertEquals } from "@std/assert";
import { trimIndent } from "@nathan/dev-tools-util";

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
