import { slugOfKey } from "../../scripts/lib/page.js";
import type { RemoteObject } from "../../scripts/lib/sync-plan.js";
import type { PageEntry } from "./pages-request.js";

/** sync が置く形（pages/<slug>/index.html）のキーだけをページとして扱い、ほかのオブジェクトは出さない。 */
export function pageEntries(objects: readonly RemoteObject[]): PageEntry[] {
  return objects.flatMap(({ key, lastModified }) => {
    const slug = slugOfKey(key);
    return slug === undefined ? [] : [{ slug, lastModified: lastModified?.toISOString() ?? "" }];
  });
}
