// Where an uploaded profile picture goes. Without file storage there is nowhere: users enter
// an image URL instead. A package with storage (the CMS, with its media library) replaces
// this module.

/** Whether profile pictures can be uploaded. */
export const avatarUploads = false;

/** Store the picture and answer the URL to keep as the user's avatar. */
export async function storeAvatar(_userId: string, _file: File): Promise<string> {
  throw new Error('Picture uploads need file storage.');
}
