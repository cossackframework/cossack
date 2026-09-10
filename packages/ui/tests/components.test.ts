import { describe, it, expect, vi } from "vitest";
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
    Collapsible,
    Toggle,
    ToggleGroup,
    Breadcrumb,
    Pagination,
    AspectRatio,
    Field,
    Form,
    Empty,
    Kbd,
    ButtonGroup,
    Command,
    NativeSelect,
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
        expect(out).toContain("cs-button--default");
        expect(out).toContain("cs-button--default");
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

    it("renders the icon size variant", () => {
        const out = renderComp(Button, { size: "icon" }, "X");
        expect(out).toContain("cs-button--icon");
    });

    it("uses shadcn hover/focus conventions", () => {
        const out = renderComp(Button, { variant: "default" }, "Save");
        expect(out).toContain("hover:bg-primary/90");
        expect(out).toContain("focus-visible:ring-ring/50");
    });

    it("keeps the outline surface transparent", () => {
        const out = renderComp(Button, { variant: "outline" }, "Outline");
        expect(out).toContain("bg-transparent");
        expect(out).not.toContain("bg-background");
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

describe("NativeSelect", () => {
    it("uses a transparent closed surface while preserving native color-scheme", () => {
        const out = renderComp(
            NativeSelect,
            {},
            html`<option value="one">One</option>`,
        );
        expect(out).toContain("bg-transparent");
        expect(out).not.toContain("bg-background");
        expect(out).toContain("[color-scheme:light_dark]");
        expect(out).toContain("dark:[color-scheme:dark]");
        expect(out).toContain("[&amp;&gt;option]:bg-popover");
        expect(out).toContain("[&amp;&gt;option]:text-popover-foreground");
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
        expect(out).toContain("text-success-text");
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
        expect(out).toContain("text-warning-text");
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

    it("passes accessibility and data attributes through to the dialog", () => {
        const out = renderComp(Modal, {
            "aria-label": "Release notes",
            "data-testid": "release-modal",
        });
        expect(out).toContain('aria-label="Release notes"');
        expect(out).toContain('data-testid="release-modal"');
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
    it("puts switch semantics on the hidden native checkbox", () => {
        const out = renderComp(Switch, { checked: true });
        expect(out).toMatch(/<label[^>]*>\s*<input[^>]*role="switch"/);
        expect(out).not.toMatch(/<label[^>]*role="switch"/);
        expect(out).toContain('type="checkbox"');
        expect(out).toContain("cs-switch");
        expect(out).toContain("sr-only");
    });

    it("reflects aria-checked from the checked prop", () => {
        expect(renderComp(Switch, { checked: true })).toContain('aria-checked="true"');
        expect(renderComp(Switch, { checked: false })).toContain('aria-checked="false"');
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
    it("renders an animate-spin svg with size", () => {
        const out = renderComp(Spinner, { size: 24, color: "text-primary" });
        expect(out).toContain("cs-spinner");
        expect(out).toContain("animate-spin");
        expect(out).toContain("<svg");
        expect(out).toContain('width="24"');
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
        expect(out).toContain('src="/me.png"');
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
    it("renders every controlled panel and hides only inactive panels", () => {
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
        expect(out).toContain("Content B");
        expect(out.match(/role="tabpanel"/g)).toHaveLength(2);
        expect(out).toContain('aria-hidden="true"');
        expect(out).toContain('aria-hidden="false"');
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
        expect(out).toContain('aria-selected="true"');
        expect(out).toContain('aria-selected="false"');
    });

    it("gives the selected underline trigger an SSR-visible active border", () => {
        const out = renderComp(Tabs, {
            variant: "underline",
            items: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
            ],
        });
        expect(out).toContain("border-b-2 border-primary");
        expect(out).toContain("border-b-2 border-transparent");
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
        expect(out).toContain('name="plan"');
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

    it("fills the viewport when fullScreen is enabled", () => {
        const horizontal = renderComp(Sheet, { side: "left", fullScreen: true });
        expect(horizontal).toContain("width:100vw;max-width:100vw");
        expect(horizontal).not.toContain("max-width:90vw");
        expect(horizontal).not.toContain("fullScreen");

        const vertical = renderComp(Sheet, { side: "top", fullScreen: true });
        expect(vertical).toContain("height:100vh;max-height:100vh");
        expect(vertical).not.toContain("max-height:85vh");
    });

    it("forwards accessible dialog attributes", () => {
        const out = renderComp(Sheet, { "aria-label": "Demo navigation" });
        expect(out).toContain('aria-label="Demo navigation"');
    });
});

describe("Command", () => {
    it("supports a controlled open state without changing its public item contract", () => {
        const out = renderComp(Command, {
            open: true,
            items: [{ id: "/docs", label: "Documentation", group: "Navigation" }],
        });
        expect(out).toContain("cs-command__panel");
        expect(out).toContain("Documentation");
    });
});

describe("Collapsible", () => {
    it("renders a trigger and hidden content", () => {
        const out = renderComp(Collapsible, { trigger: "Toggle" }, "Hidden text");
        expect(out).toContain("cs-collapsible");
        expect(out).toContain("Toggle");
        expect(out).toContain("Hidden text");
        expect(out).toContain("max-height: 0");
    });

    it("shows content when defaultOpen is true", () => {
        const out = renderComp(Collapsible, { trigger: "T", defaultOpen: true }, "X");
        expect(out).toContain("max-height: 200px");
    });
});

describe("Toggle", () => {
    it("renders a button with aria-pressed", () => {
        const out = renderComp(Toggle, { pressed: true }, "B");
        expect(out).toContain("cs-toggle");
        expect(out).toContain("aria-pressed");
        expect(out).toContain("B");
        expect(out).toContain("bg-primary");
    });

    it("renders unpressed state", () => {
        const out = renderComp(Toggle, { pressed: false }, "I");
        expect(out).toContain("bg-transparent");
    });
});

describe("ToggleGroup", () => {
    it("renders a group of toggle buttons", () => {
        const out = renderComp(ToggleGroup, {
            type: "single",
            value: "bold",
            items: [{ value: "bold", label: "B" }, { value: "italic", label: "I" }],
        });
        expect(out).toContain("cs-toggle-group");
        expect(out).toContain("B");
        expect(out).toContain("I");
    });
});

describe("Breadcrumb", () => {
    it("renders nav with items and separators", () => {
        const out = renderComp(Breadcrumb, {
            items: [
                { label: "Home", href: "/" },
                { label: "Settings" },
            ],
        });
        expect(out).toContain("cs-breadcrumb");
        expect(out).toContain("Home");
        expect(out).toContain("Settings");
        expect(out).toContain('href="/"');
        expect(out).toContain("/");
    });
});

describe("Pagination", () => {
    it("renders page buttons with current page highlighted", () => {
        const out = renderComp(Pagination, { page: 3, totalPages: 10 });
        expect(out).toContain("cs-pagination");
        expect(out).toContain("3");
        // Prev/next are now Icon components (arrows), not text glyphs.
        expect(out).toContain('aria-label="Previous page"');
        expect(out).toContain('aria-label="Next page"');
        expect(out).toContain("aria-current");
    });
});

describe("AspectRatio", () => {
    it("renders a container with padding-top for ratio", () => {
        const out = renderComp(AspectRatio, { ratio: 16 / 9 }, "Content");
        const pct = (9 / 16) * 100;
        expect(out).toContain("cs-aspect-ratio");
        expect(out).toContain(`padding-top:${pct}%`);
    });
});

describe("Field", () => {
    it("renders label, control, and hint", () => {
        const out = renderComp(Field, { label: "Email", hint: "We never share" }, "input");
        expect(out).toContain("cs-field");
        expect(out).toContain("Email");
        expect(out).toContain("We never share");
        expect(out).toContain("input");
    });

    it("renders error in destructive color when present", () => {
        const out = renderComp(Field, { label: "X", error: "Required" });
        expect(out).toContain("text-destructive");
        expect(out).toContain("Required");
    });
});

describe("Empty", () => {
    it("renders title and description", () => {
        const out = renderComp(Empty, { title: "No data", description: "Add something" });
        expect(out).toContain("cs-empty");
        expect(out).toContain("No data");
        expect(out).toContain("Add something");
    });
});

describe("Kbd", () => {
    it("renders a kbd element with classes", () => {
        const out = renderComp(Kbd, {}, "⌘");
        expect(out).toContain("<kbd");
        expect(out).toContain("cs-kbd");
        expect(out).toContain("⌘");
    });
});

describe("ButtonGroup", () => {
    it("renders a group container with role", () => {
        const out = renderComp(ButtonGroup, {}, "buttons");
        expect(out).toContain("cs-button-group");
        expect(out).toContain("role=");
        expect(out).toContain("group");
        expect(out).toContain("buttons");
    });
});

describe("Form", () => {
    it("renders a <form> that projects children", () => {
        const out = renderComp(Form, {}, html`<input name="email" />`);
        expect(out).toContain("<form");
        expect(out).toContain("</form>");
        expect(out).toContain('<input name="email"');
    });

    it("adds novalidate by default when a submit handler is provided (RPC path)", () => {
        const out = renderComp(Form, { submit: () => {} }, "fields");
        // novalidate is a boolean presence attribute.
        expect(out).toContain("novalidate");
    });

    it("does NOT add novalidate by default for native POST (no submit handler)", () => {
        const out = renderComp(Form, { method: "post" }, "fields");
        expect(out).not.toContain("novalidate");
        // method is forwarded via the spread.
        expect(out).toContain('method="post"');
    });

    it("lets novalidate be opt-in for native POST", () => {
        const out = renderComp(
            Form,
            { method: "post", novalidate: true },
            "fields",
        );
        expect(out).toContain("novalidate");
    });

    it("lets novalidate be opt-out for the RPC path", () => {
        const out = renderComp(
            Form,
            { submit: () => {}, novalidate: false },
            "fields",
        );
        expect(out).not.toContain("novalidate");
    });

    it("does not leak the submit handler as a DOM attribute", () => {
        const out = renderComp(Form, { submit: () => {} }, "fields");
        expect(out).not.toContain("submit");
        expect(out).not.toContain("function");
    });

    it("forwards arbitrary attributes via spread", () => {
        const out = renderComp(
            Form,
            { action: "/save", class: "my-form", autocomplete: "off" },
            "fields",
        );
        expect(out).toContain('action="/save"');
        expect(out).toContain('class="my-form"');
        expect(out).toContain('autocomplete="off"');
    });

    it("wraps the submit handler to prevent the default submit", () => {
        // Exercise the real production wrapper (Form.wrapSubmit), not a
        // reconstruction. The @submit handler is built in render() and bound
        // client-side via the spread (so it isn't visible in SSR output); this
        // calls the same wrapper render() installs and asserts that it prevents
        // the default before delegating to the caller's submit handler.
        let delegated: SubmitEvent | undefined;
        const instance = new Form();
        const submit = (e: SubmitEvent) => { delegated = e; };
        // @ts-expect-error wrapSubmit is private but always present.
        const wrapper = instance.wrapSubmit(submit) as (e: SubmitEvent) => void;

        const preventDefault = vi.fn();
        const event = { preventDefault } as unknown as SubmitEvent;
        wrapper(event);

        expect(preventDefault).toHaveBeenCalled();
        expect(delegated).toBe(event);
    });
});
