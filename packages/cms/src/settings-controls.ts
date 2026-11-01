/** Rich settings controls keep portable scalar values and share validation across editors. */
import { FIELD_MEDIA_KINDS, validateValue } from './fields';
import type { SettingControl, SettingDeclaration } from './settings';

const COLOR_PATTERN = '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})';
const FILE_PATTERN = '(?:https?://[^\\s\\\\\\u0000-\\u001f\\u007f]+|/(?![/\\\\])[^\\s\\\\\\u0000-\\u001f\\u007f]*)';

/** JSON Schema checks syntax; the server also parses absolute file URLs. */
export function settingControlPattern(control: SettingControl): string {
    // Unlike $, the final assertion does not permit a trailing line break.
    return `^(?:${control === 'color' ? COLOR_PATTERN : FILE_PATTERN})?(?![\\s\\S])`;
}

function controlValueProblem(declaration: SettingDeclaration, value: unknown): string | undefined {
    if (value === null || value === '' || typeof value !== 'string') return;
    if (declaration.control === 'color' && !new RegExp(settingControlPattern('color')).test(value)) {
        return 'must be a hex color such as #2563eb, optionally with alpha.';
    }
    if (declaration.control === 'file') {
        const message = 'must be an HTTP(S) URL or a root-relative file path.';
        if (!new RegExp(settingControlPattern('file')).test(value)) return message;
        try {
            const url = new URL(value, 'https://settings.invalid');
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return message;
        } catch { return message; }
    }
    return;
}

/** Apply the same rules to form saves, JSON imports, stored overrides and defaults. */
export function validateSettingValue(name: string, declaration: SettingDeclaration, value: unknown): string | undefined {
    return validateValue(name, declaration, value) ?? controlValueProblem(declaration, value);
}

/** Extra declaration rules for settings; resource media fields retain their ID contract. */
export function settingControlProblems(name: string, declaration: SettingDeclaration): string[] {
    const problems: string[] = [];
    const at = `field ${name}`;
    if (declaration.control !== undefined && (!['color', 'file'].includes(declaration.control)
        || declaration.kind !== 'string' || declaration.multiple || declaration.media || declaration.source !== undefined)) {
        problems.push(`${at}: control is color or file and applies to a single string without a source.`);
    }
    if (declaration.fileKinds !== undefined && (declaration.control !== 'file' || !Array.isArray(declaration.fileKinds)
        || !declaration.fileKinds.length || declaration.fileKinds.some(kind => !(FIELD_MEDIA_KINDS as readonly string[]).includes(kind))
        || new Set(declaration.fileKinds).size !== declaration.fileKinds.length)) {
        problems.push(`${at}: fileKinds applies to file controls and lists distinct ${FIELD_MEDIA_KINDS.join(', ')} kinds.`);
    }
    if (!problems.length && declaration.control !== undefined && declaration.default !== undefined) {
        const problem = validateSettingValue(name, declaration, declaration.default);
        if (problem) problems.push(`${at}: default ${problem}`);
    }
    return problems;
}
