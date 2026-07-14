import { describe, it, expect } from "vitest";
import { renderToString } from "@cossackframework/renderer";
import { Icon, type IconProps } from "../src/icons/Icon";
import { iconRegistry, iconNames } from "../src/icons/registry";
import { normalizeStyle } from "../src/icons/types";

function renderIcon(props: IconProps): string {
    const instance = new Icon();
    instance.props = props;
    const result = instance.render();
    if (result === null) return "";
    return renderToString(result);
}

describe("icon registry", () => {
    it("ships a non-empty set of icons", () => {
        expect(iconNames.length).toBeGreaterThan(0);
    });

    it("includes the curated sample icons", () => {
        expect(iconNames).toEqual(
            expect.arrayContaining([
                "arrow-right",
                "alt-arrow-down",
                "check-circle",
                "close-circle",
                "magnifier",
                "settings",
            ]),
        );
    });

    it("each curated icon has at least the line style", () => {
        for (const name of [
            "arrow-right",
            "alt-arrow-down",
            "check-circle",
            "close-circle",
        ]) {
            const entry = iconRegistry[name];
            expect(entry.line).toBeTruthy();
        }
    });

    it("exposes the full six-style set where Solar provides them", () => {
        // alt-arrow-down exists in all six Solar styles.
        const entry = iconRegistry["alt-arrow-down"];
        expect(entry.line).toBeTruthy();
        expect(entry.bold).toBeTruthy();
        expect(entry.duotone).toBeTruthy();
        expect(entry.broken).toBeTruthy();
        expect(entry.outline).toBeTruthy();
        expect(entry["line-duotone"]).toBeTruthy();
    });
});

describe("Icon component", () => {
    it("renders an <svg> with the requested size", () => {
        const out = renderIcon({ name: "check-circle", size: 20 });
        expect(out).toContain("<svg");
        expect(out).toContain('width="20"');
        expect(out).toContain('height="20"');
        // line style emits a <path>
        expect(out).toContain("<path");
    });

    it("uses the requested style", () => {
        const out = renderIcon({ name: "arrow-right", style: "bold" });
        // bold emits a fill-based path using currentColor
        expect(out).toContain('fill="currentColor"');
    });

    it("falls back to line when a style is missing for an icon", () => {
        // Request an outline style; the component falls back to line if absent.
        const out = renderIcon({ name: "arrow-right", style: "outline" });
        expect(out).toContain("<svg");
        expect(out).toContain("<path");
    });

    it("adds aria-label and role=img when a label is supplied", () => {
        const out = renderIcon({ name: "check-circle", label: "Confirm" });
        expect(out).toContain('role="img"');
        expect(out).toContain('aria-label="Confirm"');
        expect(out).not.toContain("aria-hidden");
    });

    it("hides from assistive tech when no label is supplied", () => {
        const out = renderIcon({ name: "check-circle" });
        expect(out).toContain('aria-hidden="true"');
    });

    it("renders nothing for an unknown icon name", () => {
        const out = renderIcon({ name: "does-not-exist" });
        expect(out).toBe("");
    });
});

describe("normalizeStyle", () => {
    it("maps canonical names through unchanged", () => {
        expect(normalizeStyle("line")).toBe("line");
        expect(normalizeStyle("bold")).toBe("bold");
        expect(normalizeStyle("duotone")).toBe("duotone");
        expect(normalizeStyle("broken")).toBe("broken");
        expect(normalizeStyle("outline")).toBe("outline");
        expect(normalizeStyle("line-duotone")).toBe("line-duotone");
    });

    it("maps aliases to canonical styles", () => {
        expect(normalizeStyle("solid")).toBe("bold");
        expect(normalizeStyle("d")).toBe("duotone");
        expect(normalizeStyle("brk")).toBe("broken");
        expect(normalizeStyle("o")).toBe("outline");
        expect(normalizeStyle("ld")).toBe("line-duotone");
    });

    it("falls back to line for unknown input", () => {
        expect(normalizeStyle("nonsense")).toBe("line");
        expect(normalizeStyle("B")).toBe("bold");
    });
});
