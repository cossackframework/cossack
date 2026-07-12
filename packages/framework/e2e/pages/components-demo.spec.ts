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
    await expect(page.locator('button.cs-button--destructive:has-text("Delete")')).toBeVisible();
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

  test('accordion renders <details> and toggles open state natively', async ({ page }) => {
    const items = page.locator('details.cs-accordion');
    expect(await items.count()).toBeGreaterThanOrEqual(3);

    // First item starts open (open prop was true).
    await expect(items.nth(0)).toHaveAttribute('open', '');

    // A closed item opens when its <summary> is clicked (native behavior).
    const closed = items.filter({ hasNotText: '' }).nth(1);
    await closed.locator('summary').click();
    await expect(closed).toHaveAttribute('open', '');
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
    await expect(page.locator('label.cs-switch[role="switch"]')).toBeVisible();

    // Spinner uses animate-spin
    await expect(page.locator('span.cs-spinner.animate-spin')).toBeVisible();
  });

  test('avatar, separator, skeleton, progress render', async ({ page }) => {
    await expect(page.locator('.cs-avatar')).toHaveCount(2);
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
});
