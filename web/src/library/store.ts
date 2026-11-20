/**
 * @file The Tracks the client knows: what the server confirmed, and the writes still under way.
 *
 * A pure reducer, so the races between quick writes, their answers, and a fresh
 * list are unit tested. Each write has a number; only the answer to a field's
 * latest write ends it, and a refused write falls back to what the server
 * confirmed. A list equal to the one held changes nothing, and a Track equal to
 * the one held is kept, so views don't work again for what didn't change.
 */

import type { Track } from "../api";

/** A field of a Track the client writes. */
export type Field = "favorite" | "rating";

type Value<F extends Field> = Track[F];

/** A write the server hasn't answered yet. */
interface Pending {
  readonly seq: number;
  readonly value: Value<Field>;
}

/** The confirmed Tracks, the writes under way, and whether the server has answered yet. */
export interface Store {
  readonly confirmed: ReadonlyMap<number, Track>;
  /** Keyed by Track id and field, such as `7:favorite`. */
  readonly pending: ReadonlyMap<string, Pending>;
  readonly loaded: boolean;
  /** The list last loaded, so the same list read again is known at once. */
  readonly listed: readonly Track[];
}

/** A change to the store. */
export type StoreAction =
  | { readonly type: "loaded"; readonly tracks: readonly Track[] }
  | { readonly type: "details"; readonly track: Track }
  | {
      readonly type: "write";
      readonly id: number;
      readonly field: Field;
      readonly value: Value<Field>;
      readonly seq: number;
    }
  | {
      readonly type: "answered";
      readonly id: number;
      readonly field: Field;
      readonly value: Value<Field>;
      readonly seq: number;
    }
  | { readonly type: "refused"; readonly id: number; readonly field: Field; readonly seq: number };

/** The fields of a Track the household edits, what follows from them, and what a lookup finds. */
const DETAILS = [
  "title",
  "artist",
  "album",
  "album_artist",
  "track_number",
  "disc_number",
  "year",
  "genre",
  "cover",
  "kind",
  "kind_reason",
  "community",
] as const satisfies readonly (keyof Track)[];

/** A store before the server has listed any Tracks. */
export const EMPTY: Store = { confirmed: new Map(), pending: new Map(), loaded: false, listed: [] };

const keyOf = (id: number, field: Field) => `${String(id)}:${field}`;

/** Apply `action` to `store`. */
export function reduce(store: Store, action: StoreAction): Store {
  switch (action.type) {
    case "loaded":
      return loaded(store, action.tracks);
    case "details": {
      // A Track read after its details were edited: only its details are taken, as
      // the Account's own state may have changed since it was read.
      const track = store.confirmed.get(action.track.id);
      if (track === undefined) {
        return store;
      }
      const details = Object.fromEntries(DETAILS.map((field) => [field, action.track[field]]));
      const confirmed = new Map(store.confirmed);
      confirmed.set(track.id, { ...track, ...details });
      return { ...store, confirmed };
    }
    case "write": {
      if (!store.confirmed.has(action.id)) {
        return store;
      }
      const pending = new Map(store.pending);
      pending.set(keyOf(action.id, action.field), { seq: action.seq, value: action.value });
      return { ...store, pending };
    }
    case "answered": {
      const track = store.confirmed.get(action.id);
      if (track === undefined) {
        return store;
      }
      // Any answer is what the server holds now; only the latest ends the write.
      const confirmed = new Map(store.confirmed);
      confirmed.set(action.id, { ...track, [action.field]: action.value });
      return { ...store, confirmed, pending: ended(store, action.id, action.field, action.seq) };
    }
    case "refused":
      return { ...store, pending: ended(store, action.id, action.field, action.seq) };
  }
}

/** Take the server's list, keeping each Track equal to the one held, and the store if all are. */
function loaded(store: Store, tracks: readonly Track[]): Store {
  if (tracks === store.listed) {
    // The very list held, as a read the server said is unchanged gives back.
    return store;
  }
  const before = [...store.confirmed.values()];
  let same = store.loaded && tracks.length === before.length;
  const confirmed = new Map<number, Track>();
  tracks.forEach((track, index) => {
    const known = store.confirmed.get(track.id);
    const kept = known !== undefined && equalJson(known, track) ? known : track;
    // The same Track in the same place: views show the order, so it counts.
    same &&= before[index] === kept;
    confirmed.set(track.id, kept);
  });
  if (same) {
    return store;
  }
  const pending = new Map(
    [...store.pending].filter(([key]) => confirmed.has(Number(key.split(":")[0]))),
  );
  return {
    confirmed,
    pending: pending.size === store.pending.size ? store.pending : pending,
    loaded: true,
    listed: tracks,
  };
}

/** Whether two values read from JSON hold the same, all the way down. */
export function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      equalJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function ended(store: Store, id: number, field: Field, seq: number): ReadonlyMap<string, Pending> {
  const key = keyOf(id, field);
  if (store.pending.get(key)?.seq !== seq) {
    return store.pending;
  }
  const pending = new Map(store.pending);
  pending.delete(key);
  return pending;
}

const shown = new WeakMap<Store, ReadonlyMap<number, Track>>();

/** Return the Tracks as the client shows them: confirmed, with the writes under way. */
export function tracksOf(store: Store): ReadonlyMap<number, Track> {
  const known = shown.get(store);
  if (known !== undefined) {
    return known;
  }
  let tracks = store.confirmed;
  if (store.pending.size > 0) {
    const changed = new Map(store.confirmed);
    for (const [key, { value }] of store.pending) {
      const [id, field] = key.split(":") as [string, Field];
      const track = changed.get(Number(id));
      if (track !== undefined) {
        changed.set(track.id, { ...track, [field]: value });
      }
    }
    tracks = changed;
  }
  shown.set(store, tracks);
  return tracks;
}
