import { isCmsError, mediaUrl, type Principal } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import type { MediaPreview } from './content';

/** Store uploaded files, one at a time, within the Media settings' size limit. */
export async function uploadFiles(cms: CmsHost, files: readonly File[], principal: Principal, signal?: AbortSignal): Promise<{ files: MediaPreview[]; errors: string[] }> {
    const service = cms.files;
    if (!service) return { files: [], errors: ['File storage is not configured.'] };
    const maxBytes = (await cms.settings.get('media.maxUploadMb')) * 1024 * 1024;
    const uploaded: MediaPreview[] = [];
    const errors: string[] = [];
    for (const file of files.slice(0, 20)) {
        try {
            const stored = await service.upload({ name: file.name, contentType: file.type, size: file.size, body: file.stream() }, { principal, maxBytes, ...(signal ? { signal } : {}) });
            uploaded.push({ id: stored.id, url: mediaUrl(stored), title: stored.title, alt: stored.alt, contentType: stored.contentType, width: stored.width, height: stored.height });
        } catch (error) {
            errors.push(`${file.name}: ${isCmsError(error) ? error.message : 'the upload failed.'}`);
        }
    }
    return { files: uploaded, errors };
}

/** Files from a submitted form's `file` fields. */
export function formFiles(form: FormData): File[] {
    return form.getAll('file').filter((entry): entry is File => typeof entry === 'object' && entry !== null && 'stream' in entry && (entry as File).size > 0);
}
