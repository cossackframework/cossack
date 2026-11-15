/**
 * The route ID of a page by its application path (`/src/pages/auth/login/index.ts`). A page that
 * a mounted package serves is listed by its path from the project, which ends the same way.
 */
export function routeId(manifest, applicationPath) {
  const key = Object.keys(manifest.filePathToId).find(file => file === applicationPath || file.endsWith(applicationPath));
  return key ? manifest.filePathToId[key] : undefined;
}
