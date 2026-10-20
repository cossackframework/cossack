/** The front page when it lists the latest posts. */
import type { TemplateResult } from '@cossackframework/renderer';
import type { ArchiveView } from '@cossackframework/cms';
import { list } from '../parts/list';

export default function home(view: ArchiveView): TemplateResult {
    return list(view, __('Nothing published yet.'));
}
