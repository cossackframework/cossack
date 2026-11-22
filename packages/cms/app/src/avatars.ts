// Where an uploaded profile picture goes, for the shared sign-in code (auth.ts): the site's
// media library.
import { getRequestContext } from '@cossackframework/core';
import { ANONYMOUS, type Principal } from '@cossackframework/cms';
import { currentCms } from './cms/index';

export const avatarUploads = true;

/** Store the picture in the media library, as the signed-in user, and answer its URL. */
export async function storeAvatar(userId: string, file: File): Promise<string> {
  const principal = (getRequestContext()?.get('principal') as Principal | undefined) ?? ANONYMOUS;
  return currentCms().uploadAvatar(userId, { name: file.name, contentType: file.type, size: file.size, body: file.stream() }, { principal });
}
