---
title: 'CMS Settings'
description: 'Declare plugin settings, edit and transfer settings as JSON, and read and write site settings.'
---

# CMS Settings

Site settings are typed values in groups, such as General, Reading or SEO. Each setting
has a key `<group>.<field>`, such as `general.siteTitle`. The host stores one row per key,
checks every write against the group's declaration and fills in defaults when it reads.

## Reading settings

`cms.settings.all()` returns every declared setting with defaults applied, as a
`SiteSettings` object. `cms.settings.get(key)` returns one value. Reads are cached per
isolate and the cache is cleared on every write.

```ts
const cms = c.get('cms');
const title = await cms.settings.get('general.siteTitle');
const settings = await cms.settings.all();
if (settings['discussion.enabled']) { /* ... */ }
```

Before setup, reads return the defaults.

## Writing settings

`cms.settings.update(group, values, { principal })` writes some or all fields of one group.
Fields that the input leaves out keep their value.

```ts
await cms.settings.update('general', { siteTitle: 'Acme', logo: '/media/abc/logo.svg' }, { principal });
```

- The principal needs the group's `permission`: `cms:settings` by default, and
  `cms:appearance` for the Appearance groups.
- A field the group does not declare, or a value its declaration refuses, fails with
  `CMS_VALIDATION`. `error.fields` names each field and its problem. Nothing is written then.
- The result is the new `SiteSettings`.

## The dashboard menu

Appearance holds the theme, its colors and the site's additional CSS (edited under Appearance →
Customize).

Settings → Interface holds what applies site-wide rather than to a theme:

- *Icon style*: the Solar style every icon is drawn in on the site and in the dashboard
  (`interface.iconStyle`: `line`, `bold`, `duotone`, `broken`, `outline` or `line-duotone`; see
  [Icons](/docs/cms/blocks.md#icons)), with a preview row.
- *Dashboard colors* and *Dashboard accent*: the dashboard's palettes, shown as swatches
  (`interface.palette`: `neutral`, `zinc`, `gray`, `slate` or `stone`; `interface.accent`:
  `neutral`, `blue`, `green` or `red`). They are the UI package's palettes, applied through
  `@cossackframework/ui/theme/palettes.css` and a `ui-palette` meta tag in the dashboard's head,
  in light and dark mode. The site keeps its theme's colors. Saving reloads the page.

Appearance → Dashboard menu arranges the dashboard's sidebar for everyone: hide modules,
change their order and add links (a dashboard screen, a page of the site or an http(s) URL,
with an icon of the dashboard's set). It is the `dashboard.menu` setting, a JSON value
`{ order: string[], hidden: string[], links: { id, label, href, icon? }[] }` behind
`cms:appearance`, so it is not part of the Settings page or the settings documents.

The application builds the default navigation for the signed-in user, then
`applyDashboardMenu` hides the listed modules, adds the links (modules `link-<id>`) and sorts
the listed IDs first in their order, the rest after in the default order. A user never gains a
module their permissions withhold, whatever the order says; the account menu is untouched. An
unusable stored value counts as no menu (`dashboardMenuOf`); `dashboardMenuProblems` checks a
value before it is saved. Module IDs are `collection-<name>`, `media`, `calendar`,
`comments`, `forms`, `plugin-<plugin>-<href>`, `resource-<plugin>-<name>`, `appearance`,
`collections`, `plugins`, `users`, `sessions`, `roles`, `tools`, `site-settings`, `network`
and `my-sites`.

## Declaring a group

A module or the host options declare groups with `settings`. A group is data: an `id`
(lowercase letters, digits and hyphens), a `label`, an optional `description` and `fields`.
The fields are field declarations, such as `field.boolean()` or `field.enum()`.

```ts
import { field, type SettingsGroup } from '@cossackframework/cms';

export const shop: SettingsGroup = {
  id: 'shop',
  label: 'Shop',
  fields: {
    currency: { ...field.enum(['usd', 'eur'], { default: 'usd', label: 'Currency' }), choices: { usd: 'US dollar', eur: 'Euro' } },
    logo: { ...field.string({ max: 2000, default: '', label: 'Invoice logo' }), source: 'media' },
  },
};

createCMS({ /* ... */ settings: [shop] });
```

- `choices` gives labels for enum values.
- `source` fills a field's choices when the form renders: `roles`, `pages`, `categories`,
  `timezones`, or `media`, which opens the media library on images and stores a file URL.
- `control` gives a string field a `color` or `file` editor. The value rules below apply
  to host groups and plugin groups.
- `permission` sets who may change the group.
- `parent` nests the group beneath another group in the sidebar. Its keys keep the group's own ID.
  For example, Crawlers (`crawlers.*`) and IndexNow (`indexnow.*`) have `parent: 'seo'`. They
  appear beneath SEO and have their own sections on the settings page.
- `json: true` includes a host or module group in the JSON editor and export. Only opt in
  when its fields are supported scalar settings and the shared save operation covers all
  validation and effects. Custom groups are excluded by default.

Theme options are a separate group, `<plugin>.<option>`, which Appearance → Customize edits.
See [Themes](/docs/cms/themes.md).

## The Settings screens

Settings shows the groups behind `cms:settings` on one scrolling page. The sidebar fills
the page height, and its links jump to sections on that page. SEO groups appear beneath
SEO. Every installed plugin that declares valid settings has its own entry beneath Plugins.
Languages and Permalinks are sections on the same page and keep their own save operations.

**Search settings** in the top bar filters both the sidebar and the settings shown on the
page. Search by group, plugin, section, field label, description, or setting key. Matching
groups show how many settings were found. Parent entries remain visible when a child
matches. Clearing search restores the other settings without discarding their edits.
The code icon in the same bar opens the JSON editor. Save changes stays in the top bar
while you scroll. Save includes edits hidden by the current search.
The active sidebar entry follows the section you scroll to.

Settings sections create their field controls as they enter the viewport. Sidebar links
open the selected section immediately, including sections whose controls have not yet
loaded. This keeps the initial page small when many plugins declare settings. Draft
values are separate from the rendered controls, so filtering or switching to JSON keeps
unsaved changes.

Disabled plugins can be configured before activation. Saving their settings does not
enable them or run their hooks.
Enable, disable, and grant plugins on the separate dashboard Plugins screen.

## Plugin settings

Declare settings in the plugin manifest. The CMS supplies their form, validation, storage,
and `cms:settings` permission. No custom settings page or registration callback is needed.

```json
{
  "settings": {
    "label": "Newsletter",
    "description": "Control newsletter delivery.",
    "sections": [{ "id": "delivery", "label": "Delivery" }],
    "fields": {
      "enabled": {
        "kind": "boolean", "label": "Enable delivery", "default": false,
        "section": "delivery"
      },
      "senderName": {
        "kind": "string", "label": "Sender name", "default": "", "max": 120,
        "section": "delivery"
      },
      "accentColor": {
        "kind": "string", "control": "color", "label": "Accent color", "default": "#336699"
      },
      "brandAsset": {
        "kind": "string", "control": "file", "fileKinds": ["image"],
        "label": "Brand asset", "default": ""
      }
    }
  }
}
```

A plugin named `newsletter` owns the namespace `plugin:newsletter`. Its sender name is
stored as `plugin:newsletter.senderName`. Sections organize the form and do not change
the key. Field names are unique across the plugin, including fields in different sections.

Supported kinds are `string`, `text`, `boolean`, `integer`, `number`, and `enum`.
Use their usual labels, descriptions, defaults, required/nullable rules, bounds, patterns,
and enum choices. Nested values, arrays, resource options, dynamic choice sources, and
executable validators are unsupported. The host checks declarations and defaults before
it registers the plugin.

String fields can use `control: "color"` or `control: "file"`. A color control combines
a color picker with a text input. It accepts `#RGB`, `#RGBA`, `#RRGGBB`, and `#RRGGBBAA`.
The text input preserves alpha values. The picker selects a color without alpha.

A file control accepts a URL, chooses an existing media file, or uploads a new file.
It stores a root-relative or HTTP(S) URL as a string, so JSON and runtime reads use the
same value. Optional `fileKinds` sets the initial library filter: `image`, `video`,
`audio`, `document`, or `archive`. It does not restrict URLs pasted into the field.
Browsing and uploading require the corresponding media permissions.

An upload adds the file to the media library immediately. Save changes attaches its URL
to the setting. Clearing or discarding the setting does not delete the file.
An optional color or file field can be empty. Use `nullable: true` to also allow `null`.

Plugin server handlers read their own settings through `PluginContext`:

```ts
import type { PluginContext } from '@cossackframework/cms/server';

export function register(context: PluginContext) {
  context.commands.add('delivery-status', async () => ({
    enabled: await context.settings.get('enabled'),
    settings: await context.settings.all(),
  }));
}
```

The example assumes a declared `delivery-status` command. Read values inside handlers,
after activation, rather than during registration. The context applies defaults and
returns detached values. It cannot read another plugin's settings or write settings.
These server reads require an active plugin and do not publish values to visitors.

Disabled plugins retain their values. Removed fields and absent plugins also retain
their stored rows, but the dashboard and JSON export omit them. If an upgrade makes a
stored value invalid, the settings surface reports the problem for correction.
Theme options remain under Appearance → Customize with their existing keys and permission.

## JSON editing, import, and export

The **Edit settings JSON** code button opens a two-level document: a namespace containing
named scalar values.
The editor supplies completion and field descriptions from the authorized declarations.

```json
{
  "general": {
    "siteTitle": "Acme"
  },
  "plugin:newsletter": {
    "enabled": true,
    "senderName": "Acme updates"
  }
}
```

The same server validation handles ordinary forms, JSON edits, and imports. An Apply
operation saves every changed value or none. Invalid or oversized input is rejected
before any settings are written.

- Input is strict JSON. Comments, trailing commas, duplicate keys, unknown settings,
  unsafe property names, arrays, and nested field values are refused.
- Missing groups and fields remain unchanged. Removing a key from the editor does not
  delete its stored value. An empty document makes no changes.
- `null` is allowed only for nullable fields. It assigns null, rather than resetting a
  field. Nullable form controls keep null distinct from empty text, zero, and false.
- Export contains saved, authorized effective values, including declared defaults. It
  excludes unsaved drafts and unset values that have no valid default.
- Export sorts keys and uses two-space indentation. Importing exported defaults pins
  those values in the receiving site.

Form and JSON views retain the same draft when switching within Settings. Invalid JSON
stays in the editor until it is fixed or discarded. Leaving Settings with unsaved changes
requires saving or discarding the draft. Concurrent changes to the same field use the
last successful save; unchanged fields are not submitted again.

Selecting an import file creates a preview. Review the changed keys, then select Apply
changes. Selecting a file or opening its preview does not write settings. Export always
downloads the saved state. Documents contain at most 2,048 fields and 48 KiB of UTF-8 text.
The encoded database statement and parameters must fit within 60 KiB. Oversized operations
fail before writing. Formatted exports obey the same file-size limit as imports.

Settings reads use pagination and retry when the database changes during the read.
The complete-read limit is 20,000 stored rows. Exceeding it reports a limit error instead
of returning a truncated export or replacing unread values with defaults.

Appearance, theme options, Languages, and Permalinks use dedicated operations and are
excluded from this JSON surface. Keep deployment credentials in server configuration.
This file is a settings export, not a complete site backup. References to pages, roles,
categories, or media are not remapped when imported into another site.

### Server APIs for settings documents

Use the current principal for every dashboard-facing operation:

```ts
import { parseSettingsDocument, settingsJsonSchema } from '@cossackframework/cms';

const context = { principal: c.get('principal') };
const groups = cms.settings.catalog(context);
const schema = settingsJsonSchema(groups);
const saved = await cms.settings.snapshot(context);
const patch = parseSettingsDocument(jsonText);
cms.settings.validateDocument(patch, context); // No write.
await cms.settings.applyDocument(patch, context);
const exported = await cms.settings.exportDocument(context);
```

`catalog` returns authorized groups that opt into JSON. `snapshot` returns their effective
values. `validateDocument` checks a patch without saving it. `applyDocument` validates and
commits it atomically. `exportDocument` serializes the saved snapshot.
Do not expose the unrestricted server `all()` result through a browser method.

## Discussions

`discussion.enabled` ("Allow discussions") turns comments off for the whole site. When it
is off:

- The site shows no comments and no comment forms: `EntryView.comments` is null.
- `cms.postComment()` and `POST /api/cms/comments` refuse new comments with
  `CMS_FORBIDDEN`.
- The entry editor hides the entry's "Allow comments" switch.
- Stored comments are kept. The Comments screen shows a notice and still moderates them.

`cms.discussions(settings)` tells whether discussions are on, and
`cms.commentsOpen(collection, record, settings)` tells whether one entry takes comments.

## Site icon, app icon and logo

General has three images, each chosen from the media library:

| Key | Use |
| --- | --- |
| `general.favicon` | Site icon: browser tabs and bookmarks. An SVG or a square PNG. |
| `general.appIcon` | App icon: home screens and the web app manifest. A square PNG of at least 512 pixels. |
| `general.logo` | Logo, in any shape: the site header, the sign-in pages and the dashboard sidebar. |

`seo.logo` stays separate. Search engines want a square image in structured data, while a
header logo is usually wide.

Themes get the logo as `site.logo` (a URL or null). They render it with `helpers.logo(site)`,
which returns an image with the site title as its alternative text, or null when no logo is
set:

```ts
export default function layout(site: SiteView, content: TemplateResult, helpers: ThemeHelpers) {
  return html`<header>
    <a href=${site.homeUrl}>${helpers.logo(site, { class: 'h-10 w-auto' }) ?? site.title}</a>
  </header>${content}`;
}
```

The dashboard and the sign-in pages read the logo through `siteLogo()` in `src/brand.ts`.
They show the bundled `/logo.svg` until a logo is set.
