"use server";

import { updateCollectionItemRequestSchema } from "@mtg/schemas";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateCollectionItem } from "@/server/collection/items";
import { addTag, removeTag } from "@/server/collection/tags";
import { collectionHref, parseViewMode } from "./collection-view";

/**
 * Moves one stack to a different binder location (KAD-21 AC1).
 *
 * The item id is bound at render time; everything else arrives as form
 * fields and is treated as untrusted. Note in particular that the redirect
 * target is *rebuilt* from the submitted `q`/`view` rather than being
 * accepted as a URL - `collectionHref` always produces a `/collection` path,
 * so there is no shape of input that turns this into an open redirect.
 *
 * A collision with an existing stack comes back as `outcome: "conflict"`
 * (see `updateCollectionItem`) and is reported to the user instead of being
 * merged or swallowed. The page has no client component to hold an action's
 * return value, so the outcome travels as a query param on the redirect -
 * which also survives a reload and is linkable, unlike component state.
 */
/**
 * A form field as text. `FormData.get` can hand back a `File`, which
 * stringifies to "[object Object]" - a field that isn't a string is treated
 * as absent rather than laundered into a plausible-looking value.
 */
function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Next.js requires "use server" exports to be async regardless of whether
// the body awaits anything - the update is synchronous (better-sqlite3).
// eslint-disable-next-line @typescript-eslint/require-await
export async function updateBinderLocationAction(
  itemId: string,
  formData: FormData,
): Promise<void> {
  const query = formString(formData, "q");
  const view = parseViewMode(formString(formData, "view"));
  const binderLocation = formString(formData, "binderLocation");

  const patch = updateCollectionItemRequestSchema.parse({ binderLocation });
  const result = updateCollectionItem(itemId, patch);

  // `not_found` needs no notice: the only way to get it is a stack that was
  // deleted between render and submit, and the re-rendered list not
  // containing it says that more clearly than a banner would.
  revalidatePath("/collection");
  redirect(
    collectionHref(
      query,
      view,
      result.outcome === "conflict"
        ? // The attempted location rides along so the notice can name where
          // the stack was headed - the input has already snapped back to the
          // stored value by the time the user reads it.
          { conflict: itemId, conflictTo: binderLocation }
        : {},
    ),
  );
}

/**
 * Tags one stack (KAD-22).
 *
 * Unlike a binder move, none of `addTag`'s non-success outcomes need a
 * notice. `already_present` leaves the chip the user was looking at exactly
 * where it was; `invalid` (blank or over-length) can't be reached through
 * the UI, which marks the field `required` with a `maxLength`; `not_found`
 * means the stack was deleted between render and submit, which the
 * re-rendered list shows more plainly than a banner would. In every case
 * the page that comes back is an accurate picture of the tags that exist.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function addTagAction(itemId: string, formData: FormData): Promise<void> {
  addTag(itemId, formString(formData, "tag"));
  revalidatePath("/collection");
  redirect(collectionHref(formString(formData, "q"), parseViewMode(formString(formData, "view"))));
}

/**
 * Untags one stack. The tag rides in the form rather than being bound at
 * render time for the same reason the item id is bound: both are references
 * the client is entitled to name, and `removeTag` re-normalizes before it
 * deletes, so a stale spelling either matches the stored row or removes
 * nothing.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function removeTagAction(itemId: string, formData: FormData): Promise<void> {
  removeTag(itemId, formString(formData, "tag"));
  revalidatePath("/collection");
  redirect(collectionHref(formString(formData, "q"), parseViewMode(formString(formData, "view"))));
}
