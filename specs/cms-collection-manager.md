# Collection manager: features, field groups and the content template

Status: implemented on branch `cms-foundation`, 2026-10-27. Follows [field groups](cms-meta-boxes.md). See [Outcome](#outcome).

Currently, in Collections (posts, pages, etc), we have "Fields" that define the available fields for the collection items and "Content template" that defines the starter content for new items.

However, since we have "Fields group" feature, which is like WordPress ACF plugin, I think we should revise the Collections manager to better integrate with fields groups and provide a more flexible and organized way to manage collection fields.

## Proposed Changes
In the collection manager page (`/dashboard/collections/:id`), we will have 3 sections:

1. **Features**: Define default core features or settings for the collection, such as `title`, `slug`, `status`, `content`, `revisions`, `featured_image`, etc. Users can enable or disable these features as needed.
2. **Fields Groups**: This section will list all the available fields groups that can be attached to the collection. Users can add, remove, or reorder the groups here.
3. **Content Template**: This section will define the starter layout and content for new items in the collection, similar to the current implementation.

### Why need both `Features`, `Fields Groups` and `Content`
We can totally remove any of them and the collection will still function, but each serves a distinct purpose and provides different benefits.

- Features: Enforce the presence and behavior of core collection attributes, such as `title`, `slug`, `status`, `content`, `revisions`, and `featured_image`. This bring standardization and consistency to all collection items so developers can rely on these attributes being available and behaving predictably. 
- Fields Groups: Allow attaching reusable sets of custom fields to the collection. Mainly for structuring and organizing custom data that goes beyond the core features, making it easier to manage complex content requirements.
- Content Template: Define the starter layout and content for new items in the collection. This helps maintain a consistent structure and provides a convenient starting point for content creators.

Questions:
Q: Developer can just use `Content Template` for both defining the starter content and structuring custom fields, why do we need `Fields Groups` then?
A: Using Content Template is ok, but it has some limitations:
    - It is not as reusable and structured as Fields Groups. If you want to use the same set of custom fields across multiple collections, you would need to duplicate the content template for each collection.
    - Some fields needs to be in the dashboard only and not part of the content template, such as `SKU`, `inventory`, or other administrative fields that are not meant to be part of the content itself.
Q: Can't we just use `Fields Groups` for everything and skip `Content Template`?
A: Fields Groups are great for structuring and reusing custom fields, but they don't define the actual starter content for new items. Content Template provides a convenient way to pre-fill new items with a consistent layout and initial content, which Fields Groups alone cannot achieve. Of course, there is an usecase where you only use `Fields Groups` without a Content Template, like creating a new theme where the content structure is entirely hardcoded and you don't need predefined starter content.
Q: So when should we use each of them?
A: Use Features to enforce core attributes and standardize behavior across all collection items. Use Fields Groups to structure and reuse custom fields, especially for complex content requirements. Use Content Template to define the starter layout and initial content for new items, ensuring consistency and providing a convenient starting point for content creators.
Q: So if I put both Fields Groups and Content Template in a collection, how do they interact?
A: Use linked feature to connect Content Template with the relevant Fields Groups. Then when you fill out a new item using Fields Groups, the Content Template will automatically populate the initial content based on the predefined layout and starter content, ensuring consistency while still allowing the flexibility to manage custom fields separately.

## Proposal (written 2026-10-27, after reading the code)

What exists today, so the plan builds on it rather than beside it:

- The builder page (`collections/[name]`) already has four parts: Settings and Taxonomies in a sidebar, a **Fields** card (the collection's own layout tree, stored as `CollectionDefinition.layout` and compiled to `fields`), and a **Content template** card shown only when the layout has a blocks field.
- Field groups are a separate screen. A group owns its attachment (`targets`), a global `order` and a `placement`. The entry editor already renders the own layout plus the attached groups as boxes.
- "Linking" the template to fields already exists: data blocks in the template bind to entry fields (`{{ $.price }}`), and the editor resolves them against the collection's own fields and its groups' fields.

So the revision is mostly about removing one concept, not adding three.

### Decisions

1. **Fields live only in field groups.** The builder's own Fields card and `CollectionDefinition.layout` go. A collection with custom fields attaches groups; a collection with none is just features. One place to define a field, one place to reuse it. `fields` stays in the model for hand-written definitions (modules, plugins, manifests): the manager shows those as read-only "Declared fields", it does not edit them.
   - Migration: a host upgrade step turns each stored collection's `layout` into a field group titled "<Label> fields", targeted at that collection. Alpha, one-way.
   - "Add fields" in the manager creates a group pre-targeted at the collection and opens its editor (`/dashboard/field-groups/new?collection=<name>`). Groups made this way are ordinary groups; nothing is "owned" by a collection.

2. **Features = the standard fields and behaviours, as toggles with fixed names.** The existing settings (`slug`, `publishable`, `hierarchical`, `comments`, `path`, taxonomies) are already features; the section adds the fields posts and pages declare by hand today:
   - `content` (blocks, searchable), `excerpt` (text), `featuredImage` (media, sidebar), `password` (string, sidebar: visitors type it to read the entry; on for posts and pages, see `specs/cms-appearance.md`), `author` (shown in the editor; ownership already exists), `revisions` (already on the resource, default on; exposed), `menuOrder` stays tied to `hierarchical`.
   - `title` stays always on: lists, search, slugs and `titleField` depend on it. Not a toggle.
   - Model: `CollectionDefinition.features?: { content?, excerpt?, featuredImage?, author?, revisions? }`, derived in `collectionResource` like `slug` is now, with fixed labels and placements. Posts and pages declare them as features instead of `fields`; `sticky` stays a declared built-in field of posts.
   - Rule: a feature name is reserved; no group may declare `content`, `excerpt` or `featuredImage` (extend the `scope` check in `fieldGroupProblems`).

3. **Attachment stays on the group; order moves onto the target.** `targets` already serves taxonomies, users and menus, so it remains the source of truth. `FieldGroupTarget` gains `order?: number`, replacing the group-wide `order` for collections (the global `order` stays as the fallback and for the other target kinds). The collection manager edits the targets of the groups it touches: attach adds a target, remove drops it, drag writes `order`. Save goes through one host call, `saveCollection(definition, { groups: [{ id, order }] })`, which rewrites those targets, re-resolves the resource and plans the schema once. No second list on the collection, so nothing can disagree.

4. **Content template applies to the `content` feature only.** Today it targets "the first blocks field"; with fields in groups that would be ambiguous. The card shows when `content` is on. Bindings may name any field of the attached groups, so the builder's `bindings()` reads them from the groups instead of the own layout. When a group is detached or a bound field renamed, the template keeps the binding and the manager shows a warning per unresolved binding; the site renders an unresolved binding as empty, as it does now. Starter patterns stay as the alternative for a new entry.

5. **Page layout.** Sidebar: identity (names, description, icon, URL path, who can read) and Delete. Main column, in order: **Features** (toggles, taxonomies), **Field groups** (attached list with title, placement, field count, edit link, drag handle, Remove; "Attach a group" picker of groups not yet attached; "New field group"), **Content template** (unchanged card). Built-in collections keep their locked features and show their declared fields under Features.

### Also worth deciding now

- **Placement per attachment?** A group is main or sidebar everywhere. If a "Product details" group should sit in the sidebar for products and in the main column for pages, placement would move onto the target too. Recommendation: keep placement on the group until someone needs it; the target shape allows adding it later.
- **Groups page.** Keep `/dashboard/field-groups` as the global list (it is the only place for taxonomy, user and menu targets) and show each group's targets there, with a link back to each collection.
- **Entry editor.** Needs no new layout code: it already renders boxes from groups; the own-layout box is simply gone, and `content`, `excerpt` and `featuredImage` take their fixed places (main after title, main after content, sidebar).

### Order of work

1. Model: `features`, target `order`, reserved feature names, `fieldGroupProblems` scope, remove `layout` from the builder path (keep the type for one upgrade cycle). Unit tests.
2. Host: upgrade step (layout → group), `saveCollection` with group attachments, `fieldGroupsFor` ordered by target order. Live RomeDB tests.
3. Dashboard: the three sections, `field-groups/new?collection=`, template bindings from groups and the unresolved-binding warning.
4. Specs (`cms-meta-boxes.md`, `cms-editing.md`), README, `agent-docs.json`, the generated-runtime CMS test.

### Done when

- A new "Products" collection with content, featured image and no groups publishes an entry from the editor with only those boxes.
- "Pricing" and "Specifications" groups attach to products from the collection manager, reorder by drag, and the product editor shows them in that order; detaching one keeps old values and drops its index.
- The products template holds a data block bound to `{{ $.price }}`; detaching Pricing shows the warning in the manager and renders empty on the site.
- Posts and pages after upgrade have the same fields and the same editor as before, and an older stored collection's layout appears as a group named after it.

## Outcome

Implemented 2026-10-27. Attached groups are reordered with arrow buttons rather than drag; the
content feature declared by hand may restrict its block types (`content: { blocks }`), which the
dashboard does not edit.

Also the same day: `CollectionDefinition.managed` marks a collection that ships with screens of
its own (forms). The manager does not list it, `saveCollection` refuses it, and groups cannot
target it; a module or plugin declares the flag, so end users cannot reach a collection its
owner keeps for itself.

Two follow-up decisions the same day: the default theme no longer prints a label/value list of
every field (`entry.details` stays for themes that want one); a field reaches the site through
a block's text with `{{ $.price }}`, so dashboard-only fields such as a SKU stay off the page.
And bindings keep only that inline form: the bare `$.price` whole-value form is gone, so words
and formatting can always surround a value.

| Area | Delivered | Verified by |
| --- | --- | --- |
| Model (`packages/cms`) | `CollectionFeatures` and `CollectionDefinition.features` (`content`, `excerpt`, `featuredImage`, `revisions`), `FEATURE_FIELDS`, `RESERVED_FIELDS` (core fields and features, which no field or group may take), `contentBlocks`; features derived in `collectionResource`, locked by `extendCollection`; the template needs `content`; posts, pages and patterns declare features; `FieldGroupTarget.order`, `targetOrder`, `groupsForTarget`, `withTarget` | `essentials-unit.test.ts`, `field-groups-unit.test.ts` |
| Host | `saveCollection(definition, principal, { groups })` attaches, orders and detaches groups and plans the schema once; group fields that take a core or feature name are left out; `deleteCollection` detaches its groups; `#convertLayouts` turns a stored `layout` into `<name>-fields` on load and promotes content, excerpt and featured image fields to features | `field-groups.test.ts`, `collections.test.ts`, `essentials.test.ts` (live RomeDB) |
| Dashboard (`packages/cms/app`) | The manager's Features, Field groups (attach, order, remove, New field group) and Content template sections with unresolved-binding warnings; the entry editor renders groups alone; `/dashboard/field-groups/new?collection=` attaches on creation; the group editor keeps a target's order | `generated-runtime-cms-fields.test.js`, `generated-runtime-cms.test.js`, `generated-runtime-cms-plugins.test.js` |
| Docs | README, `agent-docs.json` (`cms-collections`, `cms-field-groups`), notes in `cms-meta-boxes.md` and `cms-editing.md` | — |
