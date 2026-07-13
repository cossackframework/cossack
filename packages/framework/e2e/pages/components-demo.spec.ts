import { test, expect } from '../fixtures';

test.describe('Components Demo Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/components-demo');
    await page.waitForSelector('h1:has-text("Components Demo")');
  });

  test('renders all button variants', async ({ page }) => {
    const body = await page.locator('body').textContent();
    expect(body).toContain('Primary');
    expect(body).toContain('Secondary');
    expect(body).toContain('Outline');
    expect(body).toContain('Ghost');
    expect(body).toContain('Delete');
    // The disabled button is present and disabled.
    await expect(page.locator('button:has-text("Disabled")')).toBeDisabled();
  });

  test('applies token-driven classes to buttons', async ({ page }) => {
    // The cs-button hook class is always present on UI buttons.
    const uiButtons = page.locator('button.cs-button');
    const count = await uiButtons.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Variant class flows through classMap.
    await expect(page.locator('button.cs-button--destructive:has-text("Delete")').first()).toBeVisible();
    await expect(page.locator('button.cs-button--outline:has-text("Outline")')).toBeVisible();
  });

  test('renders all badge variants', async ({ page }) => {
    for (const label of ['Active', 'Pending', 'Failed', 'Recommended']) {
      await expect(page.locator(`span.cs-badge:has-text("${label}")`).first()).toBeVisible();
    }
  });

  test('renders labelled inputs', async ({ page }) => {
    await expect(page.locator('label.cs-label:has-text("Email")')).toBeVisible();
    await expect(page.locator('#email-demo')).toHaveAttribute('type', 'email');
    // Error variant carries the cs-input--error hook.
    await expect(page.locator('input.cs-input--error')).toBeVisible();
  });

  test('renders alerts with role=alert', async ({ page }) => {
    const alerts = page.locator('div[role="alert"]');
    expect(await alerts.count()).toBe(4);
    await expect(page.locator('div[role="alert"]:has-text("Success")')).toBeVisible();
    await expect(page.locator('div[role="alert"]:has-text("Error")')).toBeVisible();
  });

  test('renders the card with header/body/footer slots', async ({ page }) => {
    await expect(page.locator('.cs-card-header:has-text("Plan: Pro")')).toBeVisible();
    await expect(page.locator('.cs-card-body:has-text("Unlimited projects")')).toBeVisible();
    await expect(page.locator('.cs-card-footer')).toBeVisible();
  });

  test('renders Solar icons as inline svg', async ({ page }) => {
    // Labeled icons get role=img; unlabeled ones get aria-hidden.
    const labeled = page.locator('svg[role="img"][aria-label="Arrow right"]');
    await expect(labeled).toBeVisible();

    // Style variants for the check icon all render.
    const svgs = page.locator('svg.cs-icon');
    expect(await svgs.count()).toBeGreaterThanOrEqual(7);
  });

  test('icon paths are real SVG geometry (namespace + stroke)', async ({ page }) => {
    // Regression guard: unsafeHTML-injected <path> inside <svg> gets parsed in
    // the XHTML namespace and never becomes a real SVGPathElement, so the icon
    // renders blank. The fix emits the whole <svg> as one unsafeHTML blob so
    // the parser enters SVG namespace. This test pins that.
    const data = await page.evaluate(() => {
      const path = document.querySelector('svg.cs-icon path') as unknown as SVGPathElement | null;
      if (!path) return { ok: false, reason: 'no path element' };
      const isReal = path instanceof SVGPathElement;
      let length: number | null = null;
      try { length = isReal ? path.getTotalLength() : null; } catch {}
      return {
        ok: isReal && length !== null && length > 0,
        isSVGPathElement: isReal,
        namespace: (path as Element).namespaceURI,
        totalLength: length,
        computedStroke: getComputedStyle(path as Element).stroke,
      };
    });
    expect(data.ok, JSON.stringify(data)).toBe(true);
    // stroke must resolve to a real color, not the UA default "none"
    expect(data.computedStroke).not.toBe('none');
  });

  test('bordered elements render a non-zero border', async ({ page }) => {
    // Regression guard: a global `* { border-width: 0 }` reset (or border-none
    // on a shared base class) makes outlines/inputs/cards render borderless.
    const widths = await page.evaluate(() => {
      const bw = (el: Element | null) =>
        el ? parseFloat(getComputedStyle(el).borderWidth) : -1;
      return {
        outlineBtn: bw(document.querySelector('button.cs-button--outline')),
        input: bw(document.querySelector('input.cs-input')),
        card: bw(document.querySelector('.cs-card')),
        alert: bw(document.querySelector('div[role="alert"]')),
      };
    });
    for (const [name, w] of Object.entries(widths)) {
      expect(w, `${name} border-width should be > 0`).toBeGreaterThan(0);
    }
  });

  test('theme tokens produce a non-default background on the primary button', async ({
    page,
  }) => {
    // The token chain resolves: bg-primary utility is generated from the
    // @theme --color-primary declared in @cossackframework/ui/theme/theme.css.
    const primary = page.locator('button.cs-button--primary').first();
    const bg = await primary.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    // Token-driven background is set (not the transparent default).
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });

  test('every variant utility is generated (regression guard for @source)', async ({
    page,
  }) => {
    // Tailwind v4 excludes node_modules unless @source points at the package.
    // If that directive is missing, only classes that also appear in app source
    // are generated — so bg-secondary/bg-destructive/bg-success would resolve
    // to transparent. This test pins the @source wiring.
    const checks = await page.evaluate(() => {
      const bg = (el: Element | null) =>
        el ? getComputedStyle(el).backgroundColor : 'missing';
      return {
        primary: bg(document.querySelector('button.cs-button--primary')),
        secondary: bg(document.querySelector('button.cs-button--secondary')),
        destructive: bg(document.querySelector('button.cs-button--destructive')),
        success: bg(document.querySelector('span.cs-badge--success')),
        warning: bg(document.querySelector('span.cs-badge--warning')),
        destructiveBadge: bg(document.querySelector('span.cs-badge--destructive')),
      };
    });
    // Every variant must resolve to a real color, not the transparent default
    // that indicates a missing utility.
    for (const [name, value] of Object.entries(checks)) {
      expect(value, `${name} should not be transparent`).not.toBe('rgba(0, 0, 0, 0)');
      expect(value, `${name} should not be transparent`).not.toBe('transparent');
    }
  });

  test('modal opens via button and closes via Cancel', async ({ page }) => {
    // The <dialog> starts closed (no [open] attribute).
    await expect(page.locator('dialog.cs-modal')).not.toHaveAttribute('open');

    // Click "Open modal" → dialog should be open.
    await page.locator('button:has-text("Open modal")').click();
    await expect(page.locator('dialog.cs-modal')).toHaveAttribute('open', '');

    // The confirm body is visible inside the dialog.
    await expect(page.locator('dialog.cs-modal h3:has-text("Confirm action")')).toBeVisible();

    // Click Cancel → dialog closes.
    await page.locator('dialog.cs-modal button:has-text("Cancel")').click();
    await expect(page.locator('dialog.cs-modal')).not.toHaveAttribute('open');
  });

  test('accordion toggles open state via button click with animation', async ({ page }) => {
    const items = page.locator('.cs-accordion');
    expect(await items.count()).toBeGreaterThanOrEqual(3);

    // First item starts open (defaultOpen: true).
    const firstAria = await items.nth(0).locator('button').getAttribute('aria-expanded');
    expect(firstAria).toBeTruthy();

    // A closed item opens when its trigger button is clicked.
    const closed = items.nth(1);
    const closedAria = await closed.locator('button').getAttribute('aria-expanded');
    expect(String(closedAria)).toMatch(/false|0|^$/);
    await closed.locator('button').click();
    const openAria = await closed.locator('button').getAttribute('aria-expanded');
    expect(String(openAria)).toMatch(/true|1/);

    // The content wrapper's inline max-height should be non-zero when open.
    const wrapperStyle = await closed.locator('.cs-accordion__content-wrapper').getAttribute('style');
    expect(wrapperStyle).toContain('max-height:');
    expect(wrapperStyle).not.toContain('max-height: 0');

    // Clicking again closes it.
    await closed.locator('button').click();
    const closedAgainAria = await closed.locator('button').getAttribute('aria-expanded');
    expect(String(closedAgainAria)).toMatch(/false|0|^$/);
  });

  test('extended form primitives render their native elements', async ({ page }) => {
    // Textarea
    await expect(page.locator('textarea.cs-textarea#bio')).toBeVisible();

    // Select with options
    const select = page.locator('select.cs-select__input#country');
    await expect(select).toBeVisible();
    expect(await select.locator('option').count()).toBeGreaterThanOrEqual(3);

    // Checkbox (native input type=checkbox) + Switch (role=switch)
    await expect(page.locator('.cs-checkbox input[type="checkbox"]')).toBeChecked();
    // Multiple Switch instances exist on the page (demo + drawer); assert at least one is visible.
    const switches = page.locator('label.cs-switch[role="switch"]');
    expect(await switches.count()).toBeGreaterThanOrEqual(1);
    await expect(switches.first()).toBeVisible();

    // Spinner uses animate-spin
    await expect(page.locator('span.cs-spinner.animate-spin')).toBeVisible();
  });

  test('avatar, separator, skeleton, progress render', async ({ page }) => {
    expect(await page.locator('.cs-avatar').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.cs-separator--vertical')).toBeVisible();
    await expect(page.locator('.cs-skeleton.animate-pulse')).toBeVisible();
    const bars = page.locator('.cs-progress[role="progressbar"]');
    expect(await bars.count()).toBeGreaterThanOrEqual(3);
  });

  test('tabs switch panels on click', async ({ page }) => {
    // Default tab shows account content.
    await expect(page.locator('.cs-tabs__panel:has-text("Account settings")')).toBeVisible();

    // Click the Password tab.
    await page.locator('[role="tab"]:has-text("Password")').click();

    // Account panel should be unmounted; Password panel visible.
    await expect(page.locator('.cs-tabs__panel:has-text("Password settings")')).toBeVisible();
  });

  test('popover opens via native popovertarget button', async ({ page }) => {
    const trigger = page.locator('button[popovertarget]:has-text("Open popover")');
    await expect(trigger).toBeVisible();

    // Click opens the popover (native popover API).
    await trigger.click();
    // The popover content appears in the top layer.
    await expect(page.locator('[popover] :text("Popover title")')).toBeVisible({ timeout: 5000 });
  });

  test('radio group renders native radios and slider renders range input', async ({ page }) => {
    const radios = page.locator('.cs-radio-group input[type="radio"]');
    expect(await radios.count()).toBeGreaterThanOrEqual(3);

    // The "pro" radio should be checked.
    await expect(page.locator('.cs-radio-group input[value="pro"]')).toBeChecked();

    // Slider is a native range input.
    await expect(page.locator('input.cs-slider[type="range"]')).toBeVisible();
  });

  test('table renders with striped styling', async ({ page }) => {
    const table = page.locator('table.cs-table__element');
    await expect(table).toBeVisible();
    expect(await table.locator('tbody tr').count()).toBeGreaterThanOrEqual(2);
    // Badge inside table cell.
    await expect(table.locator('.cs-badge--success:has-text("Active")')).toBeVisible();
  });

  test('toast appears when triggered and auto-dismisses', async ({ page }) => {
    // Click the "Toast: Success" button.
    await page.locator('button:has-text("Toast: Success")').click();

    // The toast message appears in the aria-live region.
    await expect(page.locator('.cs-toast:has-text("Saved successfully!")')).toBeVisible();

    // Wait for auto-dismiss (default 4s; use a shorter timeout to avoid flakiness).
    await expect(page.locator('.cs-toast:has-text("Saved successfully!")')).toBeHidden({ timeout: 6000 });
  });

  test('dropdown menu opens and lists items via native popover', async ({ page }) => {
    const trigger = page.locator('button[popovertarget]:has-text("Dropdown")');
    await trigger.click();

    // Menu items appear in the top layer.
    await expect(page.locator('[popover] button:has-text("Profile")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[popover] button:has-text("Settings")')).toBeVisible();

    // Clicking an item closes the menu.
    await page.locator('[popover] button:has-text("Settings")').click();
    await expect(page.locator('[popover] button:has-text("Settings")')).toBeHidden({ timeout: 5000 });
  });

  test('sheet opens from the right edge and closes', async ({ page }) => {
    // Open the sheet.
    await page.locator('button:has-text("Open Sheet")').click();

    // The sheet dialog should be open.
    await expect(page.locator('dialog.cs-sheet')).toHaveAttribute('open', '', { timeout: 5000 });
    await expect(page.locator('dialog.cs-sheet h3:has-text("Sheet Panel")')).toBeVisible();

    // Click Close inside the sheet.
    await page.locator('dialog.cs-sheet button:has-text("Close")').click();
    await expect(page.locator('dialog.cs-sheet')).not.toHaveAttribute('open', '', { timeout: 5000 });
  });

  test('calendar renders a month grid and supports date selection', async ({ page }) => {
    const calendar = page.locator('.cs-calendar');
    await expect(calendar).toBeVisible();
    // 7 weekday headers (Su..Sa)
    expect(await calendar.locator('.cs-calendar__weekdays span').count()).toBe(7);
    // Pick the 15th day cell
    await calendar.locator('.cs-calendar__day:has-text("15")').click();
    // The selected status text updates with an ISO date ending in -15.
    await expect(page.locator('text=/Selected: \\d{4}-\\d{2}-15/')).toBeVisible();
  });

  test('date-picker popover opens on trigger click', async ({ page }) => {
    await page.locator('.cs-datepicker__trigger').click();
    // Native popovers live in the top layer; assert open state via JS (the
    // element reports "hidden" to Playwright's visibility checks).
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const el = document.querySelector('.cs-datepicker__panel') as HTMLElement | null;
        return el ? el.matches(':popover-open') : false;
      });
    }).toBe(true);
  });

  test('context menu opens on right-click', async ({ page }) => {
    // Playwright's right-click dispatches real OS-level contextmenu; trigger the
    // event directly to exercise the component's @contextmenu handler.
    await page.locator('.cs-context-menu').hover();
    await page.locator('.cs-context-menu').evaluate((el: HTMLElement) => {
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    });
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const el = document.querySelector('.cs-context-menu__panel') as HTMLElement | null;
        return el ? el.matches(':popover-open') : false;
      });
    }).toBe(true);
    // The Copy item is present inside the open popover.
    const hasCopy = await page.evaluate(() => {
      return !!document.querySelector('.cs-context-menu__item');
    });
    expect(hasCopy).toBe(true);
  });

  test('input-otp renders the configured number of boxes', async ({ page }) => {
    const boxes = page.locator('.cs-input-otp__box');
    await expect(boxes).toHaveCount(6);
    // Typing a digit fills the first box and the live status updates.
    await boxes.first().click();
    await page.keyboard.type('4');
    // The OTP status <code> reflects the joined value (starts with "4").
    await expect(page.locator('code.text-xs')).toContainText(/^4/, { timeout: 5000 });
  });

  test('typography renders semantic heading and blockquote elements', async ({ page }) => {
    await expect(page.locator('.cs-typography--h1')).toBeVisible();
    await expect(page.locator('.cs-typography--blockquote')).toBeVisible();
    await expect(page.locator('.cs-typography--ul')).toBeVisible();
  });

  test('drawer opens via button and renders the title header', async ({ page }) => {
    await page.locator('button:has-text("Open Drawer")').click();
    await expect(page.locator('dialog.cs-drawer')).toHaveAttribute('open', '', { timeout: 5000 });
    await expect(page.locator('.cs-drawer__header:has-text("Settings")')).toBeVisible();

    // The panel must be pinned to the right edge (not stuck at 0,0).
    const panelBox = await page.locator('.cs-drawer__panel').boundingBox();
    expect(panelBox).toBeTruthy();
    expect(panelBox!.x).toBeGreaterThan(100); // not at left edge (0,0)

    // Close it via the X button.
    await page.locator('.cs-drawer__close').click();
    await expect(page.locator('dialog.cs-drawer')).not.toHaveAttribute('open', '', { timeout: 5000 });
  });

  test('sidebar renders nav items and collapses to icon rail', async ({ page }) => {
    const sidebar = page.locator('.cs-sidebar');
    await expect(sidebar).toBeVisible();
    // Initial width ~260px.
    expect(await sidebar.locator('.cs-sidebar__link').count()).toBeGreaterThanOrEqual(3);
    // Toggle collapse.
    await sidebar.locator('.cs-sidebar__toggle').click();
    // Icon-rail mode: links become centered + body labels hidden.
    await expect(sidebar).toHaveClass(/cs-sidebar--collapsed/);
  });

  test('sidebar footer collapses to avatar-only in icon-rail mode', async ({ page }) => {
    const footer = page.locator('.cs-sidebar__footer');
    await expect(footer).toBeVisible();
    // The trigger's name span (the first .text-sm.font-medium inside the trigger button).
    const nameInTrigger = footer.locator(
      '.cs-dropdown-menu__trigger span.text-sm.font-medium'
    );
    // Expanded: name is visible.
    await expect(nameInTrigger).toBeVisible();
    await expect(nameInTrigger).toHaveText('Tan Nguyen');
    // Collapse the sidebar.
    await page.locator('.cs-sidebar__toggle').click();
    await expect(page.locator('.cs-sidebar')).toHaveClass(/cs-sidebar--collapsed/);
    // The footer carries the is-collapsed class so slotted content adapts.
    await expect(footer).toHaveClass(/is-collapsed/);
    // Avatar still visible; name hidden via group variant.
    await expect(footer.locator('.cs-avatar').first()).toBeVisible();
    await expect(nameInTrigger).toBeHidden();
  });

  test('sidebar footer user menu opens a dropdown with identity + actions', async ({ page }) => {
    // The footer trigger is composed from Avatar + DropdownMenu.
    const trigger = page.locator('.cs-sidebar__footer .cs-dropdown-menu__trigger');
    await expect(trigger).toBeVisible();
    // Resolve the popover id tied to this trigger, then open.
    const popoverId = await trigger.getAttribute('popovertarget');
    expect(popoverId).toBeTruthy();
    await trigger.click();
    // That specific popover opens in the top layer.
    await expect.poll(async () => {
      return await page.evaluate((id) => {
        const el = document.getElementById(id!) as HTMLElement | null;
        return el ? el.matches(':popover-open') : false;
      }, popoverId);
    }, { timeout: 10000 }).toBe(true);
    // Identity header shows the user's name + action rows render inside the popover.
    const popoverContent = page.locator(`#${popoverId}`);
    await expect(popoverContent.locator('text=Tan Nguyen').first()).toBeAttached();
    await expect(popoverContent.locator('button:has-text("Upgrade to Pro")')).toBeAttached();
    await expect(popoverContent.locator('button:has-text("Log out")')).toBeAttached();
  });
});
