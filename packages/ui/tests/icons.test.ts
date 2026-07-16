import { describe, it, expect } from "vitest";
import { renderToString } from "@cossackframework/renderer";
import { Icon } from "../src/icons/Icon";
import { NamedIcon, type NamedIconProps } from "../src/icons/NamedIcon";
import { normalizeStyle, type IconEntry } from "@cossackframework/solar-icons/types";
import { ArrowRightIcon } from "@cossackframework/solar-icons/arrow-right";

function renderEntry(entry: IconEntry | undefined, props: Record<string, any> = {}): string {
    const instance = new Icon();
    (instance as any).props = { entry, ...props };
    const result = instance.render();
    if (result === null) return "";
    return renderToString(result);
}
function renderNamed(props: NamedIconProps): string {
    const instance = new NamedIcon();
    instance.props = props;
    const result = instance.render();
    if (result === null) return "";
    return renderToString(result);
}

describe("Icon (entry)", () => {
    it("renders an <svg> from an all-styles entry", () => {
        const out = renderEntry(ArrowRightIcon, { size: 24 });
        expect(out).toContain("<svg");
        expect(out).toContain('width="24"');
        expect(out).toContain("<path");
    });
    it("uses the requested style", () => {
        expect(renderEntry(ArrowRightIcon, { style: "bold" })).toContain('fill="currentColor"');
    });
    it("falls back to line when a style is missing", () => {
        const out = renderEntry({ line: ArrowRightIcon.line }, { style: "bold" });
        expect(out).toContain("<svg");
    });
    it("renders nothing when entry is undefined/empty", () => {
        expect(renderEntry(undefined)).toBe("");
        expect(renderEntry({})).toBe("");
    });
});

describe("NamedIcon", () => {
    it("renders an <svg> by name", () => {
        expect(renderNamed({ name: "check-circle", size: 20 })).toContain('width="20"');
    });
    it("renders nothing for unknown name", () => {
        expect(renderNamed({ name: "nope" })).toBe("");
    });
});

describe("normalizeStyle", () => {
    it("maps canonical + aliases", () => {
        expect(normalizeStyle("line")).toBe("line");
        expect(normalizeStyle("solid")).toBe("bold");
        expect(normalizeStyle("nonsense")).toBe("line");
    });
});
