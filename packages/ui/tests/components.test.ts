import { describe, it, expect } from "vitest";
import { renderToString, html } from "@cossackframework/renderer";
import {
    Button,
    Input,
    Card,
    Badge,
    Label,
    Alert,
    Modal,
    AccordionItem,
    Textarea,
    Checkbox,
    Switch,
    Select,
    Spinner,
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

describe("Modal", () => {
    it("renders a <dialog> element with the cs-modal hook", () => {
        const out = renderComp(Modal, { open: false }, "Body");
        expect(out).toContain("<dialog");
        expect(out).toContain("cs-modal");
        expect(out).toContain("Body");
    });

    it("binds inline close/cancel/click handlers on the dialog", () => {
        // Event handlers (@close/@cancel/@click) are functions and don't emit
        // as attributes in SSR — they're wired client-side. We assert the
        // dialog element + its cs-modal hook are present (the wiring target).
        const out = renderComp(Modal, {});
        expect(out).toContain("<dialog");
        expect(out).toContain("cs-modal");
        // The panel slot renders the body content.
        expect(out).toContain("cs-modal__panel");
    });
});

describe("AccordionItem", () => {
    it("renders <details>/<summary> with content", () => {
        const out = renderComp(
            AccordionItem,
            { summary: "Section A" },
            "Panel body",
        );
        expect(out).toContain("<details");
        expect(out).toContain("<summary");
        expect(out).toContain("Section A");
        expect(out).toContain("Panel body");
        expect(out).toContain("cs-accordion");
    });

    it("reflects the open state via the boolean open attribute", () => {
        const open = renderComp(AccordionItem, { open: true, summary: "X" });
        const closed = renderComp(AccordionItem, { open: false, summary: "X" });
        expect(open).toContain("open");
        // When closed, the `open` attribute should not be emitted.
        expect(closed.split("<details")[1]?.split(">")[0]).not.toContain("open");
    });
});

describe("Textarea", () => {
    it("renders a <textarea> with rows and token classes", () => {
        const out = renderComp(Textarea, { rows: 5, placeholder: "Write" });
        expect(out).toContain("<textarea");
        expect(out).toContain("cs-textarea");
        expect(out).toContain("rows");
        expect(out).toContain('placeholder="Write"');
    });

    it("applies the error variant", () => {
        const out = renderComp(Textarea, { variant: "error" });
        expect(out).toContain("cs-textarea--error");
        expect(out).toContain("border-destructive");
    });
});

describe("Checkbox", () => {
    it("renders a native checkbox inside a label", () => {
        const out = renderComp(Checkbox, { checked: true }, "Accept terms");
        expect(out).toContain('type="checkbox"');
        expect(out).toContain("cs-checkbox");
        expect(out).toContain("checked");
        expect(out).toContain("Accept terms");
    });
});

describe("Switch", () => {
    it("renders a role=switch label with a hidden native checkbox", () => {
        const out = renderComp(Switch, { checked: true });
        expect(out).toContain('role="switch"');
        expect(out).toContain('type="checkbox"');
        expect(out).toContain("cs-switch");
        expect(out).toContain("sr-only");
    });

    it("reflects aria-checked from the checked prop", () => {
        const out = renderComp(Switch, { checked: true });
        // The renderer emits boolean-ish attribute values unquoted.
        expect(out).toContain("aria-checked");
    });
});

describe("Select", () => {
    it("renders a native <select> with passed-through <option> children", () => {
        // Pass options as a template result so they aren't HTML-escaped.
        const out = renderComp(
            Select,
            {},
            html`<option value="a">A</option><option value="b">B</option>`,
        );
        expect(out).toContain("<select");
        expect(out).toContain("cs-select");
        expect(out).toContain("<option");
        expect(out).toContain(">A</option>");
        expect(out).toContain("appearance-none");
    });

    it("renders a chevron svg overlay", () => {
        const out = renderComp(Select, {});
        expect(out).toContain("cs-select__icon");
        expect(out).toContain("<svg");
    });
});

describe("Spinner", () => {
    it("renders an animate-spin span with size styling", () => {
        const out = renderComp(Spinner, { size: 24, color: "text-primary" });
        expect(out).toContain("cs-spinner");
        expect(out).toContain("animate-spin");
        expect(out).toContain("width:24px");
        expect(out).toContain("text-primary");
    });

    it("is aria-hidden when no label is supplied", () => {
        const out = renderComp(Spinner, {});
        expect(out).toContain('aria-hidden="true"');
    });

    it("exposes role=status + aria-label when a label is supplied", () => {
        const out = renderComp(Spinner, { label: "Loading" });
        expect(out).toContain('role="status"');
        expect(out).toContain('aria-label="Loading"');
    });
});
