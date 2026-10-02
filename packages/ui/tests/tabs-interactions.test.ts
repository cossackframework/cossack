import { afterAll, describe, expect, it, vi } from "vitest";

// Client decorators preserve method bodies only in a browser environment.
vi.stubGlobal("window", { document: {} });
const { Tabs } = await import("../src/components/Tabs");
const { renderToString } = await import("@cossackframework/renderer");
afterAll(() => vi.unstubAllGlobals());

describe("Tabs underline", () => {
    it("positions one underline using the selected trigger's width and offset", () => {
        const tabs = new Tabs();
        tabs.props = { variant: "underline", value: "a",
            items: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
        tabs.tablistRef.value = { querySelector: (selector: string) => selector === "#tab-a"
            ? { offsetLeft: 4, offsetWidth: 80 }
            : { offsetLeft: 88, offsetWidth: 60 } } as unknown as HTMLDivElement;
        tabs.onMount();
        expect(renderToString(tabs.render())).toContain("left:4px;width:80px;bottom:0;height:2px;");
        tabs.props.value = "b";
        tabs.onMount();
        const out = renderToString(tabs.render());
        expect(out).toContain("left:88px;width:60px;bottom:0;height:2px;");
        expect(out.match(/cs-tabs__indicator/g)).toHaveLength(1);
        expect(out).not.toContain("border-b-2");
    });
});
