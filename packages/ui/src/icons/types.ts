/*
 * @cossackframework/ui — icon type definitions
 *
 * Solar ships 4 visual styles. The registry maps a kebab-case icon name to a
 * per-style SVG-inner-content string (paths / elements, no outer <svg> wrapper).
 * The Icon component wraps the content in an <svg> sized via props.
 */

/** The four Solar visual styles. */
export type IconStyle = "line" | "bold" | "duotone" | "broken";

/**
 * Per-icon render record. Each value is the raw SVG inner markup (paths,
 * circles, etc.) for that style. Use `unsafeHTML` to interpolate it.
 */
export type IconEntry = Partial<Record<IconStyle, string>>;

/** Full registry: kebab-name -> per-style inner SVG markup. */
export type IconRegistry = Record<string, IconEntry>;

/** Normalize a user-provided style name to a canonical IconStyle. */
export function normalizeStyle(style: string): IconStyle {
    const s = String(style).toLowerCase();
    if (s === "bold" || s === "solid" || s === "b") return "bold";
    if (s === "duotone" || s === "d") return "duotone";
    if (s === "broken" || s === "brk") return "broken";
    return "line"; // default + fallback for unknown
}
