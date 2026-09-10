/** Render driver diagnostics without dumping connection options or parameters. */
export function formatError(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const value = typeof current === "object"
      ? current as Record<string, unknown>
      : undefined;
    const message = typeof value?.["message"] === "string" ? value["message"] : String(current);
    lines.push(`${lines.length ? "Caused by: " : ""}${message}`);
    for (const [field, label] of [["sql", "SQL"], ["code", "Code"], ["detail", "Detail"], ["hint", "Hint"]] as const) {
      const diagnostic = value?.[field];
      if (typeof diagnostic === "string" && diagnostic) lines.push(`${label}: ${diagnostic}`);
    }
    current = value?.["cause"];
  }
  return lines.join("\n") || String(error);
}
