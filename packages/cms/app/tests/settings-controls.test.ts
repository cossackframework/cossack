import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { CmsError, systemPrincipal, userPrincipal } from '../../src/index';
import type { CmsHost } from '../../src/server';
import type { MediaPreview } from '../src/cms/field-controls';
import { uploadFile } from '../src/cms/media-chooser';
import { SettingsFile, type SettingsFileProps } from '../src/cms/settings-file';
import { findSettingsMedia, settingControl, settingPickerColor, settingRows, type SettingRow } from '../src/cms/settings-form';

vi.mock('@cossackframework/core', async importOriginal => ({
    ...await importOriginal<typeof import('@cossackframework/core')>(),
    Client: () => (_target: unknown, _name: unknown, descriptor: PropertyDescriptor) => descriptor,
}));
vi.mock('../src/cms/media-chooser', async importOriginal => ({
    ...await importOriginal<typeof import('../src/cms/media-chooser')>(),
    uploadFile: vi.fn(),
}));

const file: MediaPreview = { id: 'image', url: '/media/image/logo.png', title: 'Logo', alt: '', contentType: 'image/png', width: 1, height: 1 };
const row: SettingRow = { name: 'accent', namespace: 'plugin:design', label: 'Accent', description: '', kind: 'string', min: null, max: null,
    choices: [], required: false, nullable: true, section: '', control: 'color' };
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};
function control(overrides: Partial<SettingsFileProps> = {}) {
    const result = new SettingsFile();
    result.props = { attributes: { id: 'file', required: false, 'aria-describedby': undefined, 'aria-invalid': undefined }, label: 'Brand asset',
        value: '', disabled: false, media: { find: vi.fn().mockResolvedValue([file]), canUpload: true }, onChange: vi.fn(), ...overrides };
    return result;
}
const uploadEvent = () => ({ currentTarget: { files: [new File(['file'], 'logo.png', { type: 'image/png' })], value: 'logo.png' } }) as unknown as Event;

beforeEach(() => { vi.stubGlobal('__', (value: string) => value); vi.mocked(uploadFile).mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('rich setting controls', () => {
    it('preserves typed hex and alpha while providing a native opaque picker', () => {
        expect(settingPickerColor('#abc')).toBe('#aabbcc');
        expect(settingPickerColor('#abcd')).toBe('#aabbcc');
        expect(settingPickerColor('#112233aa')).toBe('#112233');
        const html = renderToString(settingControl(row, '#abc8', undefined, () => {}));
        expect(html).toContain('type="color"');
        expect(html).toContain('id="setting-plugin%3Adesign-accent-picker"');
        expect(html).toContain('value="#aabbcc"');
        expect(html).toContain('value="#abc8"');
        expect(html).toContain('Choose color: Accent');
    });

    it('retains null separately and disables both color inputs', () => {
        const html = renderToString(settingControl(row, null, 'is invalid.', () => {}));
        expect(html.match(/<input[^>]*\sdisabled(?:\s|>)/g)).toHaveLength(2);
        expect(html).toContain('aria-invalid="true"');
        expect(html).toContain('Set to null: Accent');
    });

    it('carries author controls through server rows without loading media on render', async () => {
        const cms = { settings: { all: vi.fn().mockResolvedValue({ 'plugin:design.color': '#abcdef', 'plugin:design.file': null }) }, files: { list: vi.fn() } } as unknown as CmsHost;
        const result = await settingRows(cms, { id: 'plugin:design', label: 'Design', fields: {
            color: { kind: 'string', control: 'color' }, file: { kind: 'string', control: 'file', fileKinds: ['image'], nullable: true },
        } }, systemPrincipal('settings form test'));
        expect(result.rows.map(field => [field.control, field.fileKinds])).toEqual([['color', undefined], ['file', ['image']]]);
        expect(result.values).toEqual({ color: '#abcdef', file: null });
        expect(cms.files!.list).not.toHaveBeenCalled();
    });

    it('uses the media permission boundary and reports unconfigured storage', async () => {
        const cms = {} as CmsHost;
        await expect(findSettingsMedia(cms, userPrincipal('settings-only', [], ['cms:settings']), '', '')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(findSettingsMedia(cms, systemPrincipal('settings form test'), '', '')).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
    });
});

describe('file setting interactions', () => {
    it('uses fileKinds as the initial library filter and stores the selected URL', async () => {
        const field = control({ kinds: ['image'] });
        await field.open();
        expect(field.props.media!.find).toHaveBeenCalledWith('', 'image');
        await field.filter('document');
        expect(field.props.media!.find).toHaveBeenLastCalledWith('', 'document');
        field.choose(file);
        expect(field.props.onChange).toHaveBeenCalledWith(file.url);
    });

    it('hides file upload without permission while keeping text and clear controls', () => {
        const field = control({ value: '/media/old/file.txt', media: { find: vi.fn(), canUpload: false } });
        const html = renderToString(field.render());
        expect(html).not.toContain('type="file"');
        expect(html).toContain('Choose file');
        expect(html).toContain('Clear file: Brand asset');
    });

    it('uses the shared upload pipeline and writes only the completed file URL', async () => {
        const pending = deferred<MediaPreview>();
        vi.mocked(uploadFile).mockReturnValue(pending.promise);
        const field = control();
        const event = uploadEvent();
        const uploaded = field.upload(event);
        expect(field.props.onChange).not.toHaveBeenCalled();
        expect((event.currentTarget as HTMLInputElement).value).toBe('');
        pending.resolve(file);
        await uploaded;
        expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'logo.png' }), expect.any(AbortSignal));
        expect(field.props.onChange).toHaveBeenCalledWith(file.url);
    });

    it('does not write a late upload into a discarded draft', async () => {
        let epoch = 0;
        const pending = deferred<MediaPreview>();
        vi.mocked(uploadFile).mockReturnValue(pending.promise);
        const field = control({ media: { find: vi.fn(), canUpload: true, epoch: () => epoch } });
        const uploaded = field.upload(uploadEvent());
        epoch++;
        pending.resolve(file);
        await uploaded;
        expect(field.props.onChange).not.toHaveBeenCalled();
    });

    it('does not transfer an upload when filtering reuses a component for another setting', async () => {
        const pending = deferred<MediaPreview>();
        vi.mocked(uploadFile).mockReturnValue(pending.promise);
        const field = control();
        const uploaded = field.upload(uploadEvent());
        field.props = { ...field.props, attributes: { ...field.props.attributes, id: 'another-setting' } };
        pending.resolve(file);
        await uploaded;
        expect(field.props.onChange).not.toHaveBeenCalled();
    });

    it('keeps newer text edits and aborts uploads when their control unmounts', async () => {
        const pending = deferred<MediaPreview>();
        vi.mocked(uploadFile).mockReturnValue(pending.promise);
        const field = control();
        const uploaded = field.upload(uploadEvent());
        field.props = { ...field.props, value: '/edited.txt' };
        pending.resolve(file);
        await uploaded;
        expect(field.props.onChange).not.toHaveBeenCalled();

        const second = deferred<MediaPreview>();
        vi.mocked(uploadFile).mockReturnValue(second.promise);
        const removed = field.upload(uploadEvent());
        const signal = vi.mocked(uploadFile).mock.lastCall![1]!;
        field.onCleanup();
        expect(signal.aborted).toBe(true);
        second.resolve(file);
        await removed;
        expect(field.props.onChange).not.toHaveBeenCalled();
    });

    it('keeps the value after an upload failure and shows the server message', async () => {
        vi.mocked(uploadFile).mockRejectedValue(new CmsError('CMS_FORBIDDEN', 'You cannot upload files.'));
        const field = control({ value: '/existing.png' });
        await field.upload(uploadEvent());
        expect(field.props.onChange).not.toHaveBeenCalled();
        expect(renderToString(field.render())).toContain('You cannot upload files.');
    });
});
