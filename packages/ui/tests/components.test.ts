import { describe, it, expect } from "vitest";
import { renderToString } from "@cossackframework/renderer";
import {
    Button,
    Input,
    Card,
    Badge,
    Label,
    Alert,
} from "../src/index";

/** Instantiate a component, assign props, and render its template to a string. */
function renderComp<T extends { props: Record<string, unknown> }>(
    Clazz: new () => T,
    props: Record<string, unknown> = {},
    children: unknown = null,
): string {
    const instance = new Clazz();
    instance.props = props;
    // @ts-expect-error children is set by the framework at compose-time.
    instance.children = children;
    // @ts-expect-error render is protected/internal but always present.
    const result = instance.render();
    if (result === null) return "";
    return renderToString(result);
}

describe("Button", () => {
    it("applies the default variant/size classes", () => {
        const out = renderComp(Button, {}, "Save");
        expect(out).toContain("cs-button");
        expect(out).toContain("cs-button--primary");
        expect(out).toContain("cs-button--md");
        expect(out).toContain("Save");
        expect(out).toContain("</button>");
    });

    it("switches variant + size and block", () => {
        const out = renderComp(
            Button,
            { variant: "destructive", size: "lg", block: true },
            "Delete",
        );
        expect(out).toContain("cs-button--destructive");
        expect(out).toContain("cs-button--lg");
        expect(out).toContain("w-full");
        expect(out).toContain("Delete");
    });

    it("forwards arbitrary attributes via spread", () => {
        const out = renderComp(Button, { id: "save-btn", disabled: true }, "Save");
        expect(out).toContain('id="save-btn"');
        expect(out).toContain("disabled");
    });
});

describe("Input", () => {
    it("renders an <input> with token classes", () => {
        const out = renderComp(Input, { type: "email", placeholder: "x@y.z" });
        expect(out).toContain("<input");
        expect(out).toContain("cs-input");
        expect(out).toContain('type="email"');
        expect(out).toContain('placeholder="x@y.z"');
    });

    it("applies the error variant", () => {
        const out = renderComp(Input, { variant: "error" });
        expect(out).toContain("cs-input--error");
        expect(out).toContain("border-destructive");
    });
});

describe("Card", () => {
    it("renders a div surface with children", () => {
        const out = renderComp(Card, {}, "body-content");
        expect(out).toContain("cs-card");
        expect(out).toContain("body-content");
    });

    it("applies interactive classes when requested", () => {
        const out = renderComp(Card, { interactive: true });
        expect(out).toContain("hover:shadow-md");
        expect(out).toContain("cursor-pointer");
    });
});

describe("Badge", () => {
    it("renders a span with the variant class", () => {
        const out = renderComp(Badge, { variant: "success" }, "Active");
        expect(out).toContain("<span");
        expect(out).toContain("cs-badge--success");
        expect(out).toContain("Active");
        expect(out).toContain("</span>");
    });
});

describe("Label", () => {
    it("renders a <label> element with children", () => {
        const out = renderComp(Label, { for: "email" }, "Email");
        expect(out).toContain("<label");
        expect(out).toContain('for="email"');
        expect(out).toContain("Email");
        expect(out).toContain("</label>");
    });

    it("supports muted styling", () => {
        const out = renderComp(Label, { muted: true });
        expect(out).toContain("text-muted-foreground");
    });
});

describe("Alert", () => {
    it("renders role=alert with the variant tone", () => {
        const out = renderComp(Alert, { variant: "warning" }, "Heads up");
        expect(out).toContain('role="alert"');
        expect(out).toContain("cs-alert--warning");
        expect(out).toContain("Heads up");
        expect(out).toContain("</div>");
    });

    it("adds an accent stripe when accent=true", () => {
        const out = renderComp(Alert, { accent: true });
        expect(out).toContain("border-l-4");
    });
});
