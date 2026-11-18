/**
 * Shared rule for the R and Python bindings when new options arrive.
 *
 * Components merge new options over the old ones (`{ ...prev, ...next }`, with
 * `theme` and similar objects merged one level down). That keeps the view when
 * a value changes, but an option the caller stopped sending keeps its old
 * value: an R argument set back to `NULL` is left out of the payload, and a key
 * removed from a Python `options` dict is simply missing. When that happens the
 * binding builds the component again, so the defaults apply.
 */

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !ArrayBuffer.isView(v)
  );
}

/**
 * Whether `next` leaves out a key that `prev` had, at any depth of plain
 * objects. Arrays and other values are compared only by presence: a changed
 * value is not a dropped key.
 */
export function dropsOptionKeys(prev: unknown, next: unknown): boolean {
  if (!isPlainObject(prev)) return false;
  if (!isPlainObject(next)) return Object.keys(prev).length > 0;
  for (const key of Object.keys(prev)) {
    const before = prev[key];
    if (before === undefined) continue;
    const after = next[key];
    if (after === undefined) return true;
    if (isPlainObject(before) && dropsOptionKeys(before, after)) return true;
  }
  return false;
}
