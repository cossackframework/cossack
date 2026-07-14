#!/usr/bin/env tsx
/*
 * @cossackframework/ui — icon build pipeline
 *
 * Reads SVG source files from a Solar icons tree and emits:
 *   - src/icons/generated/<Pascal>.ts    one module per icon
 *   - src/icons/registry.ts              aggregated lookup map
 *
 * Solar source layout (the canonical @solar-icons/core tree):
 *   <SRC_DIR>/
 *     <Category>/<Style>/<Name>.svg
 *
 * where <Style> is one of: Linear, Bold, BoldDuotone, Broken, Outline,
 * LineDuotone. <Name> is the raw Solar filename (e.g. "alt-arrow-down.svg").
 * It is converted to kebab-case for the registry key and PascalCase for the
 * module export.
 *
 * Usage:
 *   pnpm run build:icons                                              # uses ./vendor/solar-icons
 *   SRC_DIR=/path/to/solar-icons/packages/core/svgs pnpm run build:icons
 *
 * Each emitted icon's inner SVG markup (everything inside <svg>...</svg>) is
 * extracted and `currentColor`-ified so the Icon component can recolor via CSS.
 * Duotone accent paths keep their `opacity` attribute (the secondary layer).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = process.env.SRC_DIR
    ? path.resolve(process.env.SRC_DIR)
    : path.resolve(PKG_ROOT, "vendor", "solar-icons");
const GEN_DIR = path.resolve(PKG_ROOT, "src", "icons", "generated");
const REGISTRY_FILE = path.resolve(PKG_ROOT, "src", "icons", "registry.ts");

/**
 * Optional allowlist of kebab-case icon names. When set (via the ICONS env
 * var, comma-separated), only those icons are emitted — useful for curating a
 * small set from the full ~7,476-icon Solar tree. When unset, every icon in
 * the tree is emitted.
 */
const ICONS_FILTER = process.env.ICONS
    ? new Set(
          process.env.ICONS.split(",")
              .map((s) => s.trim())
              .filter(Boolean),
      )
    : null;

/** Canonical style → Solar source folder name. */
const STYLE_DIR_MAP = {
    line: "Linear",
    bold: "Bold",
    duotone: "BoldDuotone",
    broken: "Broken",
    outline: "Outline",
    "line-duotone": "LineDuotone",
} as const;

const STYLES = Object.keys(STYLE_DIR_MAP) as (keyof typeof STYLE_DIR_MAP)[];

function toKebab(raw: string): string {
    return String(raw)
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[_\s]+/g, "-")
        .replace(/-+/g, "-")
        .toLowerCase()
        .replace(/^-|-$/g, "");
}

function toPascal(raw: string): string {
    return String(raw)
        .split(/[-_\s.]+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join("");
}

/**
 * Extract the inner markup of an <svg> and normalize colors to currentColor.
 *
 * Solar's default stroke/fill color is `#1C274C` (a dark navy); some icons use
 * `black`/`#000`. All of these are replaced with `currentColor` so the Icon
 * component can recolor via CSS. `fill="none"` / `stroke="none"` are preserved.
 * Duotone accent paths (those carrying an `opacity` attribute) keep their
 * opacity so the secondary layer remains visible.
 */
function extractInner(svg: string): string {
    const match = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (!match) return "";
    return match[1]
        .replace(
            /\s*(stroke|fill)\s*=\s*"#1[cC]274[cC]"/gi,
            '$1="currentColor"',
        )
        .replace(
            /\s*(stroke|fill)\s*=\s*"#?\s*(?:black|#000(?:000)?|rgb\(0\s*0\s*0\))?"/gi,
            '$1="currentColor"',
        )
        .replace(/\s*stroke\s*=\s*"none"/gi, ' stroke="none"')
        .trim();
}

async function exists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * Walk the Solar tree and collect, per canonical style, a map of
 * kebab-name → inner SVG markup. Icons may live under any category folder;
 * every style folder under every category is scanned.
 */
async function readStyleDirs(): Promise<
    Record<(typeof STYLES)[number], Map<string, string>>
> {
    const result = {} as Record<(typeof STYLES)[number], Map<string, string>>;
    for (const style of STYLES) result[style] = new Map();

    if (!(await exists(SRC_DIR))) {
        console.error(`[build-icons] Source dir not found: ${SRC_DIR}`);
        console.error(
            "Set SRC_DIR or place Solar SVGs under vendor/solar-icons/<Category>/<Style>/<Name>.svg.",
        );
        process.exit(1);
    }

    // Reverse map: Solar folder name → canonical style key.
    const folderToStyle: Record<string, (typeof STYLES)[number]> = {};
    for (const s of STYLES) folderToStyle[STYLE_DIR_MAP[s]] = s;

    // Top-level categories (arrows, settings, …).
    const categories = await fs.readdir(SRC_DIR, { withFileTypes: true });
    for (const cat of categories) {
        if (!cat.isDirectory()) continue;
        const catDir = path.join(SRC_DIR, cat.name);

        // Each category has one folder per Solar style.
        const styleDirs = await fs.readdir(catDir, { withFileTypes: true });
        for (const sd of styleDirs) {
            if (!sd.isDirectory()) continue;
            const style = folderToStyle[sd.name];
            if (!style) continue;

            const styleDir = path.join(catDir, sd.name);
            const files = await fs.readdir(styleDir);
            for (const file of files) {
                if (!file.toLowerCase().endsWith(".svg")) continue;
                const base = file.replace(/\.svg$/i, "");
                const svg = await fs.readFile(path.join(styleDir, file), "utf8");
                const inner = extractInner(svg);
                if (!inner) continue;
                const key = toKebab(base);
                // First-seen wins; later categories don't overwrite.
                if (!result[style].has(key)) result[style].set(key, inner);
            }
        }
    }
    return result;
}

async function main() {
    console.log(`[build-icons] Reading source: ${SRC_DIR}`);
    const byStyle = await readStyleDirs();

    // Union of all icon names across styles, optionally filtered to an allowlist.
    const names = new Set<string>();
    for (const style of STYLES) for (const n of byStyle[style].keys()) names.add(n);
    if (ICONS_FILTER) {
        for (const n of [...names]) if (!ICONS_FILTER.has(n)) names.delete(n);
        const missing = [...ICONS_FILTER].filter((n) => !names.has(n));
        if (missing.length > 0) {
            console.warn(
                `[build-icons] ${missing.length} requested icon(s) not found in source: ${missing.join(", ")}`,
            );
        }
    }
    if (names.size === 0) {
        console.warn("[build-icons] No SVGs found. Nothing to do.");
        return;
    }

    await fs.mkdir(GEN_DIR, { recursive: true });

    const sorted = [...names].sort();
    const imports: string[] = [];
    const registryEntries: string[] = [];

    for (const name of sorted) {
        const pascal = toPascal(name);
        // camelCase identifier for the export (alt-arrow-down → altArrowDown).
        const camelProp =
            pascal.charAt(0).toLowerCase() + pascal.slice(1);

        const styles: string[] = [];
        for (const style of STYLES) {
            const inner = byStyle[style].get(name);
            if (inner) {
                // Quote keys that aren't valid JS identifiers (e.g. "line-duotone").
                const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(style)
                    ? style
                    : JSON.stringify(style);
                styles.push(`    ${key}: ${JSON.stringify(inner)},`);
            }
        }

        const moduleSource = `/*
 * GENERATED by \`pnpm run build:icons\`. Do not edit by hand.
 * Source: Solar icon set (https://solar-icons.vercel.app/).
 */
import type { IconEntry } from "../types";

export const ${camelProp}: IconEntry = {
${styles.join("\n")}
};
`;

        const outFile = path.join(GEN_DIR, `${pascal}.ts`);
        await fs.writeFile(outFile, moduleSource, "utf8");
        imports.push(`import { ${camelProp} } from "./generated/${pascal}";`);
        registryEntries.push(`    ${JSON.stringify(name)}: ${camelProp},`);
    }

    const registrySource = `/*
 * GENERATED by \`pnpm run build:icons\`. Do not edit by hand.
 *
 * Aggregates all per-icon modules into a single lookup keyed by kebab name.
 * Add a new icon by dropping a module in ./generated and re-running the
 * build script.
 */
import type { IconRegistry } from "./types";
${imports.join("\n")}

export const iconRegistry: IconRegistry = {
${registryEntries.join("\n")}
};

/** All registered icon names. */
export const iconNames = Object.keys(iconRegistry);
`;

    await fs.writeFile(REGISTRY_FILE, registrySource, "utf8");
    console.log(
        `[build-icons] Emitted ${sorted.length} icon(s) → ${path.relative(PKG_ROOT, GEN_DIR)}`,
    );
    console.log(`[build-icons] Registry → ${path.relative(PKG_ROOT, REGISTRY_FILE)}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
