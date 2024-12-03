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

export function trimIndent(s: string): string {
  return replaceIndent(s, "");
}

export function trimIndent2(text: string): string {
  // Normalize line endings to \n
  const normalizedText = text.replace(/\r\n?/g, "\n");

  // Split into lines
  const lines = normalizedText.split("\n");

  // Helper function to check if a line is blank (contains only whitespace)
  const isBlankLine = (line: string): boolean => /^\s*$/.test(line);

  // Remove leading/trailing blank lines
  let start = 0;
  let end = lines.length - 1;

  while (start <= end && isBlankLine(lines[start])) {
    start++;
  }

  while (end >= start && isBlankLine(lines[end])) {
    end--;
  }

  // If all lines are blank, return empty string
  if (start > end) {
    return "";
  }

  // Get the lines we'll process for indent detection
  const contentLines = lines.slice(start, end + 1);

  // Find common indent by looking at non-blank lines
  const commonIndent = contentLines
    .filter((line) => !isBlankLine(line))
    .reduce((indent: number | null, line: string) => {
      const lineIndent = line.match(/^\s*/)?.[0].length ?? 0;
      return indent === null ? lineIndent : Math.min(indent, lineIndent);
    }, null) ?? 0;

  // Remove common indent from all lines and join them back
  return contentLines
    .map((line) => isBlankLine(line) ? "" : line.slice(commonIndent))
    .join("\n");
}
