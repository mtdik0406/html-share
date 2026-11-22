import type { PageEntry } from "../../core/api-types.js";
import { slugOfKey } from "../../core/page.js";
import type { RemoteObject } from "../../core/sync-plan.js";

/** sync が置く形（pages/<slug>/index.html）のキーだけをページとして扱い、ほかのオブジェクトは出さない。 */
export function pageEntries(objects: readonly RemoteObject[]): PageEntry[] {
  return objects.flatMap(({ key, lastModified }) => {
    const slug = slugOfKey(key);
    return slug === undefined ? [] : [{ slug, lastModified: lastModified?.toISOString() ?? "" }];
  });
}
