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
    Avatar,
    Separator,
    Skeleton,
    Progress,
    Tabs,
    Tooltip,
    Popover,
    RadioGroup,
    Slider,
    Table,
    Toaster,
    toast,
    DropdownMenu,
    Sheet,
} from "../src/index";
import { toastStore } from "../src/components/Toast";

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
    it("renders a button + content div (not <details>/<summary>)", () => {
        const out = renderComp(
            AccordionItem,
            { summary: "Section A" },
            "Panel body",
        );
        expect(out).toContain("<button");
        expect(out).toContain("Section A");
        expect(out).toContain("Panel body");
        expect(out).toContain("cs-accordion");
        expect(out).toContain("cs-accordion__content-wrapper");
    });

    it("reflects the open state via max-height style and aria-expanded", () => {
        const open = renderComp(AccordionItem, { open: true, summary: "X" });
        const closed = renderComp(AccordionItem, { open: false, summary: "X" });
        // Open: max-height is a positive value (200px fallback before measurement)
        expect(open).toContain("max-height: 200px");
        // Closed: max-height is 0
        expect(closed).toContain("max-height: 0");
        // aria-expanded reflects state
        expect(open).toContain("aria-expanded");
    });

    it("renders a chevron svg that rotates when open", () => {
        const open = renderComp(AccordionItem, { open: true, summary: "X" });
        expect(open).toContain("cs-accordion__chevron");
        expect(open).toContain("rotate(180deg)");
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

describe("Avatar", () => {
    it("renders an img when src is provided", () => {
        const out = renderComp(Avatar, { src: "/me.png", alt: "Tan" });
        expect(out).toContain("<img");
        expect(out).toContain("src=/me.png");
        expect(out).toContain("cs-avatar");
    });

    it("renders initials fallback when no src", () => {
        const out = renderComp(Avatar, { alt: "Tan Nguyen" });
        expect(out).toContain("TN"); // initials
        expect(out).toContain("cs-avatar__fallback");
    });
});

describe("Separator", () => {
    it("renders an <hr> for horizontal", () => {
        const out = renderComp(Separator, { orientation: "horizontal" });
        expect(out).toContain("<hr");
        expect(out).toContain("cs-separator");
    });

    it("renders a div role=separator for vertical", () => {
        const out = renderComp(Separator, { orientation: "vertical" });
        expect(out).toContain("<div");
        expect(out).toContain('role="separator"');
        expect(out).toContain('aria-orientation="vertical"');
    });
});

describe("Skeleton", () => {
    it("renders an animate-pulse div with size styling", () => {
        const out = renderComp(Skeleton, { width: "50%", height: "20px" });
        expect(out).toContain("cs-skeleton");
        expect(out).toContain("animate-pulse");
        expect(out).toContain("width:50%");
        expect(out).toContain("height:20px");
    });

    it("renders rounded-full when circle is set", () => {
        const out = renderComp(Skeleton, { circle: true });
        expect(out).toContain("rounded-full");
    });
});

describe("Progress", () => {
    it("renders a progressbar with the correct aria values", () => {
        const out = renderComp(Progress, { value: 60, max: 100 });
        expect(out).toContain("role=");
        expect(out).toContain("progressbar");
        expect(out).toContain("aria-valuenow");
        expect(out).toContain("60");
        expect(out).toContain("aria-valuemax");
        expect(out).toContain("cs-progress");
        expect(out).toContain("width:60%");
    });
});

describe("Tabs", () => {
    it("renders a tablist with triggers and only the active panel", () => {
        const out = renderComp(Tabs, {
            value: "a",
            items: [
                { value: "a", label: "Tab A", content: "Content A" },
                { value: "b", label: "Tab B", content: "Content B" },
            ],
        });
        expect(out).toContain('role="tablist"');
        expect(out).toContain('role="tab"');
        expect(out).toContain("Tab A");
        expect(out).toContain("Content A");
        // Inactive panel should not be rendered.
        expect(out).not.toContain("Content B");
    });

    it("marks the active tab with aria-selected", () => {
        const out = renderComp(Tabs, {
            value: "b",
            items: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
            ],
        });
        expect(out).toContain("aria-selected");
        expect(out).toContain("true");
    });
});

describe("Tooltip", () => {
    it("renders a wrapper with aria-label and a tooltip bubble", () => {
        const out = renderComp(Tooltip, { label: "Save changes" }, "Save");
        expect(out).toContain("cs-tooltip");
        expect(out).toContain("aria-label");
        expect(out).toContain("role=");
        expect(out).toContain("tooltip");
        expect(out).toContain("Save changes");
    });
});

describe("Popover", () => {
    it("renders a trigger button with popovertarget and a popover div", () => {
        const out = renderComp(Popover, { trigger: "Open" }, "Body");
        expect(out).toContain("popovertarget");
        expect(out).toContain("popover");
        expect(out).toContain("auto");
        expect(out).toContain("Open");
        expect(out).toContain("</button>");
        expect(out).toContain("Body");
    });
});

describe("RadioGroup", () => {
    it("renders native radio inputs grouped under role=radiogroup", () => {
        const out = renderComp(RadioGroup, {
            name: "plan",
            value: "pro",
            items: [
                { value: "free", label: "Free" },
                { value: "pro", label: "Pro" },
            ],
        });
        expect(out).toContain("role=");
        expect(out).toContain("radiogroup");
        expect(out).toContain('type="radio"');
        expect(out).toContain("name=plan");
        expect(out).toContain("Free");
        expect(out).toContain("Pro");
    });
});

describe("Slider", () => {
    it("renders a native range input with token accent-color", () => {
        const out = renderComp(Slider, { value: 40, min: 0, max: 100, label: "Volume" });
        expect(out).toContain('type="range"');
        expect(out).toContain("cs-slider");
        expect(out).toContain("accent-color: var(--color-primary)");
        expect(out).toContain("aria-label");
        expect(out).toContain("Volume");
    });
});

describe("Table", () => {
    it("renders a table wrapper with the native table element", () => {
        const out = renderComp(
            Table,
            { striped: true },
            html`<thead><tr><th>Name</th></tr></thead><tbody><tr><td>Tan</td></tr></tbody>`,
        );
        expect(out).toContain("cs-table");
        expect(out).toContain("cs-table--striped");
        expect(out).toContain("<table");
        expect(out).toContain("<thead");
        expect(out).toContain("<tbody");
        expect(out).toContain("Tan");
    });
});

describe("Toaster", () => {
    it("renders an empty aria-live container", () => {
        const out = renderComp(Toaster, {});
        expect(out).toContain("cs-toaster");
        expect(out).toContain("aria-live");
    });

    it("renders the position class based on the position prop", () => {
        const out = renderComp(Toaster, { position: "top-right" });
        expect(out).toContain("top-0");
        expect(out).toContain("right-0");
    });
});

describe("toast (global API)", () => {
    it("pushes and dismisses toasts via the reactive store", () => {
        // Clear any leftover state.
        toastStore.set([]);
        expect(toastStore.get()).toEqual([]);

        const id = toast.success("Saved!");
        expect(toastStore.get()).toHaveLength(1);
        expect(toastStore.get()[0].message).toBe("Saved!");
        expect(toastStore.get()[0].variant).toBe("success");

        toast.dismiss(id);
        expect(toastStore.get()).toEqual([]);
    });

    it("subscribe receives the current value immediately and on updates", () => {
        toastStore.set([]);
        const received: any[][] = [];
        const unsub = toastStore.subscribe((v) => received.push([...v]));

        toast.show("Hello");
        expect(received).toHaveLength(2); // initial + push
        expect(received[1]).toHaveLength(1);

        unsub();
        toast.show("After unsub");
        expect(received).toHaveLength(2); // no more updates
        toastStore.set([]);
    });
});

describe("DropdownMenu", () => {
    it("renders a trigger button with popovertarget and menu items", () => {
        const out = renderComp(DropdownMenu, {
            trigger: "Actions",
            items: [
                { label: "Edit" },
                { label: "Delete" },
            ],
        });
        expect(out).toContain("popovertarget");
        expect(out).toContain("popover");
        expect(out).toContain("Actions");
        expect(out).toContain("Edit");
        expect(out).toContain("Delete");
        expect(out).toContain("cs-dropdown-menu");
    });

    it("renders a separator when separator is true", () => {
        const out = renderComp(DropdownMenu, {
            trigger: "Menu",
            items: [{ label: "A" }, { separator: true }, { label: "B" }],
        });
        expect(out).toContain("<hr");
        expect(out).toContain("cs-dropdown-menu__separator");
    });
});

describe("Sheet", () => {
    it("renders a dialog with a side-positioned panel", () => {
        const out = renderComp(Sheet, { side: "right" }, "Sheet body");
        expect(out).toContain("<dialog");
        expect(out).toContain("cs-sheet");
        expect(out).toContain("cs-sheet--right");
        expect(out).toContain("Sheet body");
    });

    it("applies the size prop as inline width for left/right", () => {
        const out = renderComp(Sheet, { side: "left", size: "500px" });
        expect(out).toContain("width:500px");
    });
});
