/**
 * @file What the player keeps in IndexedDB: the queue and its position, and plays not yet sent.
 *
 * Best effort: the browser may refuse IndexedDB or clear it, and then the player
 * starts with an empty queue and sends plays only while the page is open.
 */

import { EMPTY, type Queue, type Repeat } from "./queue";

/** The queue as it was saved, with how far into the current Track it was. */
export interface Saved {
  readonly queue: Queue;
  readonly seconds: number;
}

/** A play the server hasn't accepted yet, or whose latest time it hasn't. */
export interface Play {
  readonly id: string;
  readonly trackId: number;
  readonly playedAt: string;
  /** How long it has been listened to; missing in a play kept before pages measured. */
  readonly listenedMs?: number;
  /** Whether the server has the play, so only its time is left to send. */
  readonly recorded?: boolean;
}

const NAME = "medleyplay";
const STATE = "state";
const OUTBOX = "outbox";
const QUEUE_KEY = "queue";

let opening: Promise<IDBDatabase | undefined> | undefined;

function database(): Promise<IDBDatabase | undefined> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STATE);
        request.result.createObjectStore(OUTBOX, { keyPath: "id" });
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
  return opening;
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objects: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await database();
  if (db === undefined) {
    return undefined;
  }
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
}

/** Save the queue and the position in its current Track. */
export async function saveQueue(saved: Saved): Promise<void> {
  await run(STATE, "readwrite", (objects) => objects.put(saved, QUEUE_KEY));
}

/** Return the saved queue, if the browser kept one. */
export async function loadQueue(): Promise<Saved | undefined> {
  const saved = await run(
    STATE,
    "readonly",
    (objects) => objects.get(QUEUE_KEY) as IDBRequest<Saved | undefined>,
  );
  return saved === undefined ? undefined : { ...saved, queue: withModes(saved.queue) };
}

const REPEATS: readonly unknown[] = ["off", "all", "one"] satisfies Repeat[];

/**
 * Return `queue` with play modes it can keep: one saved before they existed plays in
 * order, and an own order that doesn't hold exactly its entries is dropped.
 */
export function withModes(queue: Partial<Queue> & Pick<Queue, "entries" | "position">): Queue {
  const keys = queue.entries.map((entry) => entry.key).sort();
  const order: readonly unknown[] | undefined = Array.isArray(queue.order)
    ? queue.order
    : undefined;
  const whole =
    order?.length === keys.length && [...order].sort().every((key, i) => key === keys[i]);
  return {
    entries: queue.entries,
    position: queue.position,
    repeat: REPEATS.includes(queue.repeat) ? (queue.repeat ?? EMPTY.repeat) : EMPTY.repeat,
    order: whole ? queue.order : undefined,
  };
}

/** Keep a play until the server accepts it. */
export async function keepPlay(play: Play): Promise<void> {
  await run(OUTBOX, "readwrite", (objects) => objects.put(play));
}

/** Return the plays not yet sent. */
export async function keptPlays(): Promise<readonly Play[]> {
  return (await run(OUTBOX, "readonly", (objects) => objects.getAll() as IDBRequest<Play[]>)) ?? [];
}

/** Forget a play the server accepted. */
export async function forgetPlay(id: string): Promise<void> {
  await run(OUTBOX, "readwrite", (objects) => objects.delete(id));
}

/**
 * Keep a longer time for the kept play `id`, and return it as kept now; a play
 * not kept, such as one the server accepted, is left so and `undefined` returned.
 */
export async function keepPlayTime(id: string, listenedMs: number): Promise<Play | undefined> {
  return change(id, (kept) =>
    kept === undefined
      ? undefined
      : { ...kept, listenedMs: Math.max(kept.listenedMs ?? 0, listenedMs) },
  );
}

/**
 * Settle a play the server accepted as `sent`: forget it, unless a longer time
 * was kept since, which then is all that is left to send.
 */
export async function settlePlay(sent: Play): Promise<void> {
  await change(sent.id, (kept) =>
    kept === undefined || (kept.listenedMs ?? 0) <= (sent.listenedMs ?? 0)
      ? null
      : { ...kept, recorded: true },
  );
}

/**
 * Change the kept play `id` in one transaction, so no other change comes between:
 * `next` returns its new copy, `undefined` to leave it, or `null` to forget it.
 * Returns the copy kept after.
 */
async function change(
  id: string,
  next: (kept: Play | undefined) => Play | null | undefined,
): Promise<Play | undefined> {
  const db = await database();
  if (db === undefined) {
    return undefined;
  }
  return new Promise((resolve) => {
    try {
      const objects = db.transaction(OUTBOX, "readwrite").objectStore(OUTBOX);
      const read = objects.get(id) as IDBRequest<Play | undefined>;
      read.onsuccess = () => {
        const kept = next(read.result);
        if (kept === null) {
          objects.delete(id);
          resolve(undefined);
        } else if (kept === undefined) {
          resolve(read.result);
        } else {
          objects.put(kept);
          resolve(kept);
        }
      };
      read.onerror = () => {
        resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
}
