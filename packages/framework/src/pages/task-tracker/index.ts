import { html, type TemplateResult } from '@cossackframework/renderer';
import {
    Cossack,
    Page,
    State,
    Store,
    Task,
    Client,
    ClientState,
    HeadContext,
    HeadValue,
} from '@cossackframework/core';

/**
 * TaskTrackerDemo — demonstrates `@Task({ track })` dependency filtering and
 * React-style automatic cleanup.
 *
 * Each task on this page keeps a counter so you can see exactly when it fires:
 *  - `untrackedTask()` has no `track` → runs on EVERY state change (legacy).
 *  - `trackedNameTask()` tracks `['name']` → runs only when `name` changes.
 *  - `trackedStoreTask()` tracks `['form.email']` → runs only when the nested
 *    `form.email` field (or an ancestor of it) changes — NOT when a sibling
 *    field like `form.password` changes.
 *  - `cleanupTask()` tracks `['symbol']` and returns a cleanup function that
 *    runs before the next re-run and on unmount (React `useEffect` style).
 *
 * All four tasks also run once on mount (bootstrap), regardless of `track`.
 */
@Page({ transport: 'http' })
export default class TaskTrackerDemo extends Cossack {
    // Tracked scalar states used by the simple-tracking demos.
    @State()
    name = 'World';

    @State()
    theme = 'light'; // unrelated to trackedNameTask — changing it must NOT run it

    // A nested store used to demonstrate dot-path tracking.
    @Store()
    form = {
        email: '',
        password: '',
    };

    // Run counters exposed to the template so each task's fire count is visible.
    @ClientState()
    untrackedCount = 0;

    @ClientState()
    trackedNameCount = 0;

    @ClientState()
    trackedStoreCount = 0;

    @ClientState()
    cleanupCount = 0;

    @ClientState()
    cleanupLog: string[] = [];

    // A mutable value the cleanup task toggles, to prove the cleanup ran.
    @ClientState()
    timerActive = false;

    public head(_context: HeadContext): HeadValue {
        return { title: 'Task Tracker Demo' };
    }

    /**
     * No `track` → runs on EVERY state change (legacy behavior). Use this as
     * the baseline to compare against the tracked tasks below.
     */
    @Task()
    untrackedTask() {
        this.untrackedCount++;
    }

    /**
     * `track: ['name']` → runs on mount and only when `name` changes.
     * Changing `theme` (a sibling scalar) must NOT re-run this.
     */
    @Task({ track: ['name'] })
    trackedNameTask() {
        this.trackedNameCount++;
    }

    /**
     * `track: ['form.email']` → runs on mount and only when the nested
     * `form.email` field (or an ancestor — a whole-store reassign) changes.
     * Editing `form.password` (a sibling field in the same store) must NOT
     * re-run this.
     */
    @Task({ track: ['form.email'] })
    trackedStoreTask() {
        this.trackedStoreCount++;
    }

    /**
     * `track: ['name']` → returns a cleanup function (React `useEffect` style).
     * The cleanup runs before the NEXT re-run and once on unmount/destroy.
     * Here it flips a flag and appends a log line so the teardown is visible.
     */
    @Task({ track: ['name'] })
    cleanupTask() {
        this.cleanupCount++;
        this.timerActive = true;
        this.cleanupLog = [
            `run #${this.cleanupCount} started for "${this.name}"`,
            ...this.cleanupLog,
        ].slice(0, 6);
        // Returned cleanup runs before the next tracked re-run and on destroy().
        return () => {
            this.timerActive = false;
            this.cleanupLog = [
                `cleanup ran (after run #${this.cleanupCount})`,
                ...this.cleanupLog,
            ].slice(0, 6);
        };
    }

    // --- Event handlers (client-only) -------------------------------------

    @Client()
    setName(value: string) {
        this.name = value;
    }

    @Client()
    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
    }

    @Client()
    setEmail(value: string) {
        // Nested store mutation — reported path is 'form.email'.
        this.form.email = value;
    }

    @Client()
    setPassword(value: string) {
        // Sibling nested mutation — reported path is 'form.password'. Tracked
        // tasks that watch 'form.email' must NOT fire.
        this.form.password = value;
    }

    @Client()
    resetCounts() {
        this.untrackedCount = 0;
        this.trackedNameCount = 0;
        this.trackedStoreCount = 0;
        this.cleanupCount = 0;
        this.cleanupLog = [];
    }

    render(): TemplateResult {
        return html`
            <div class="max-w-3xl mx-auto">
                <h1 class="text-3xl font-bold mb-2">Task Tracker Demo</h1>
                <p class="text-gray-600 mb-6">
                    <code>@Task(&#123; track: [...] &#125;)</code> runs a task only when its
                    tracked dependencies change, plus once on mount. Tasks may also
                    <code>return</code> a cleanup function (React
                    <code>useEffect</code> style).
                </p>

                <!-- Controls -->
                <section class="mb-8 space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                            Name (tracked by <code>trackedNameTask</code> and <code>cleanupTask</code>)
                        </label>
                        <input
                            type="text"
                            class="border border-gray-300 rounded px-3 py-2 w-full"
                            .value="${this.name}"
                            @input="${(e: Event) =>
                                this.setName((e.target as HTMLInputElement).value)}"
                        />
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                            Theme: <strong>${this.theme}</strong> — unrelated to any tracked task
                        </label>
                        <button
                            @click="${() => this.toggleTheme()}"
                            class="py-1.5 px-3 bg-gray-200 rounded text-sm"
                        >
                            Toggle theme (should NOT fire tracked tasks)
                        </button>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">
                                form.email (tracked by <code>trackedStoreTask</code>)
                            </label>
                            <input
                                type="text"
                                class="border border-gray-300 rounded px-3 py-2 w-full"
                                .value="${this.form.email}"
                                @input="${(e: Event) =>
                                    this.setEmail((e.target as HTMLInputElement).value)}"
                            />
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">
                                form.password (sibling — should NOT fire tracked tasks)
                            </label>
                            <input
                                type="text"
                                class="border border-gray-300 rounded px-3 py-2 w-full"
                                .value="${this.form.password}"
                                @input="${(e: Event) =>
                                    this.setPassword((e.target as HTMLInputElement).value)}"
                            />
                        </div>
                    </div>
                </section>

                <!-- Run counters -->
                <section class="mb-8">
                    <div class="flex items-center justify-between mb-3">
                        <h2 class="text-xl font-semibold">Run counts</h2>
                        <button
                            @click="${() => this.resetCounts()}"
                            class="py-1 px-3 text-sm border border-gray-300 rounded"
                        >
                            Reset
                        </button>
                    </div>
                    <p class="text-sm text-gray-500 mb-3">
                        Each started at <code>1</code> from the mount run. Change the inputs
                        above and watch which counters move.
                    </p>
                    <div class="space-y-2">
                        ${this.renderCounter(
                            '@Task() — no track (runs on EVERY change)',
                            this.untrackedCount,
                            'bg-gray-100',
                        )}
                        ${this.renderCounter(
                            "@Task({ track: ['name'] })",
                            this.trackedNameCount,
                            'bg-blue-50',
                        )}
                        ${this.renderCounter(
                            "@Task({ track: ['form.email'] })",
                            this.trackedStoreCount,
                            'bg-green-50',
                        )}
                        ${this.renderCounter(
                            "@Task({ track: ['name'] }) with cleanup()",
                            this.cleanupCount,
                            'bg-purple-50',
                            this.timerActive ? '● active' : '○ cleaned up',
                        )}
                    </div>
                </section>

                <!-- Cleanup log -->
                <section class="mb-8">
                    <h2 class="text-xl font-semibold mb-3">Cleanup log</h2>
                    <p class="text-sm text-gray-500 mb-3">
                        Editing <strong>Name</strong> re-runs <code>cleanupTask</code>; the
                        previous run's returned function fires first (React
                        <code>useEffect</code> style). The final cleanup runs on unmount.
                    </p>
                    ${this.cleanupLog.length === 0
                        ? html`<p class="text-sm text-gray-400 italic">No cleanups yet.</p>`
                        : html`
                              <ul class="font-mono text-xs space-y-1 bg-gray-900 text-gray-100 p-4 rounded">
                                  ${this.cleanupLog.map(
                                      (line) => html`<li>${line}</li>`,
                                  )}
                              </ul>
                          `}
                </section>
            </div>
        `;
    }

    /** Small helper to render a labeled counter row with a badge. */
    private renderCounter(
        label: string,
        count: number,
        bg: string,
        badge?: string,
    ): TemplateResult {
        return html`
            <div class="flex items-center justify-between ${bg} rounded px-4 py-2">
                <code class="text-sm">${label}</code>
                <div class="flex items-center gap-3">
                    ${badge
                        ? html`<span class="text-xs text-gray-500">${badge}</span>`
                        : null}
                    <span class="font-bold text-lg tabular-nums">${count}</span>
                </div>
            </div>
        `;
    }
}
