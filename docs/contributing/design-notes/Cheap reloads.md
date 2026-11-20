# Cheap reloads

> [!NOTE]
> **Status: implemented.** This note describes how the web client asks the server again
> only for what may have changed, and how an unchanged answer costs a small request
> and no rendering. It builds on [Cached reads](Cached%20reads.md), which gives the
> server's largest answers an ETag and a 304.

## Contents

- [Why](#why)
- [What it delivers](#what-it-delivers)
- [ETags that name the content](#etags-that-name-the-content)
- [Bookkeeping writes leave the revision alone](#bookkeeping-writes-leave-the-revision-alone)
- [More answers cached on the server](#more-answers-cached-on-the-server)
- [Asking with the ETag held](#asking-with-the-etag-held)
- [Keeping what didn't change](#keeping-what-didnt-change)
- [When the side reads run](#when-the-side-reads-run)
- [Interfaces](#interfaces)
- [Boundary cases](#boundary-cases)
- [Testing](#testing)
- [Measuring](#measuring)
- [Deferred: changed songs announced](#deferred-changed-songs-announced)
- [Open questions](#open-questions)

## Why

The client reloads more than it needs to, and each reload renders everything again.

- **A heart click sends twelve reads.** Six *side reads* run again whenever the
  songs `Map` changes identity: artist names, names to tidy, split offers, artist
  splits, shared names, and artists missing a photo. A favorite or rating write
  changes that identity twice, once when the click shows and again when the server
  answers. Each change starts all six reads, and the first six answers are thrown
  away. Four of the six take 0.35–0.66 s on the server when they arrive together.
- **Returning to the tab sends seventeen reads.** The page becoming visible runs
  the full load: the songs, favorites, Playlists, the Mode, five enrichers, the
  Downloads, and the features. A new songs `Map` then starts the six side reads.
  This happens even when nothing has changed.
- **An unchanged answer still costs a full parse and render.** The browser
  revalidates the songs and gets a 304, but `fetch` hides it. The client parses
  1.2 MB of JSON and builds a new `Map` of 1,738 Tracks. No view is memoized, so
  every view on the page renders again.
- **The revision moves more often than the content.** Any row change moves the
  revision: a session's last-seen time, written once a minute by every signed-in
  request; a play; a Job's state. Each move changes every ETag of
  [Cached reads](Cached%20reads.md), even when the answer is the same.

## What it delivers

- [x] **ETags that name the content:** a rebuilt answer with the same bytes keeps
      its ETag, so it still answers 304.
- [x] **Bookkeeping writes leave the revision alone:** the last-seen times of
      sessions and devices don't trigger rebuilds.
- [x] **Five more cached answers:** names to tidy, artist splits, split offers,
      shared names, and artists missing a photo.
- [x] **Conditional reads in the client:** for each cached answer, the client keeps
      the last answer and its ETag, sends `If-None-Match`, and gets back the *same
      object* on a 304. One read per path runs at a time, and the newest answer
      wins.
- [x] **Unchanged songs keep their identity:** a list the server sends again keeps
      every Track that is equal, and keeps the `Map` when all are equal and in the
      same order.
- [x] **Side reads follow the Library, not the Account's own writes:** they run
      with each reload and after any Job ends, never because of a heart or a
      rating. Their 2 s polls keep running through 304s.
- [x] Before-and-after counts and timings: see [Measuring](#measuring).

Left out: per-view reads, caching favorites, and the enricher reads. See
[Open questions](#open-questions).

## ETags that name the content

Today an ETag hashes the boot mark, the revision, and the key, so any write changes
it. Instead the ETag hashes the key and the answer's bytes; the revision only
decides when to rebuild.

```mermaid
flowchart TD
  A[Request] --> B{Cached at the current revision?}
  B -- yes --> C{If-None-Match matches its ETag?}
  C -- yes --> N[304, no build]
  C -- no --> F[Send cached bytes]
  B -- no --> E[Build, hash the bytes into the ETag, cache]
  E --> C
```

- **A rebuild that changed nothing still answers 304.** After a play or a Job's
  state change, the side reads rebuild and find the same bytes, and the client
  gets a 304.
- **The boot mark is no longer needed.** An ETag from before a restart that
  matches the bytes now is still true.
- **The key stays in the hash,** so two Accounts with the same songs never share
  an ETag.
- **Hashing costs little:** SHA-256 of the 1.2 MB songs takes a few milliseconds,
  against the 0.18 s build.

## Bookkeeping writes leave the revision alone

Two writes run on nearly every request and change nothing any cached answer shows:
a session's `last_seen_at` in `AccountService.authenticate`, and a device's
last-seen time and address. Both are written at most once a minute, so after the
tab has been hidden a minute, the first request moves the revision and every cached
answer rebuilds.

`DatabaseRevision.ignoring()` is a static context manager that marks the current
thread, so a service needs no revision of its own to use it. A connection checked in
while the mark is set doesn't bump. Each bookkeeping write runs inside it:

```python
with DatabaseRevision.ignoring(), self._units.begin() as db:
    ...  # write last_seen_at
```

- **The rule:** a write may be ignored only if no cached answer reads what it
  changes. A test lists the tables each cached answer reads and fails if an
  ignored write touches one of them.
- **Scoped to the thread,** as `heavy_read` is, so another request's write on
  another thread still counts.

## More answers cached on the server

| Read | Key | Takes the heavy-read lock | Why it can be cached |
| --- | --- | --- | --- |
| `GET /api/names-to-tidy` | revision | no, as today | Built from Tracks and the names kept |
| `GET /api/artist-splits` | revision | no, as today | Built from artist names and decisions |
| `GET /api/split-offers` | revision | no, as today | Built from song lists found and files kept; the setting is in the database |
| `GET /api/shared-names` | revision | yes, as today | Built from Tracks, artists, and MusicBrainz flags |
| `GET /api/artist-photos/missing` | revision | yes, as today | Built from artists and pictures; "finding" comes from Job rows |

Each depends only on the database, with no clock and no Mode. The review read each
service to confirm this.

- **`CachedAnswers.answer` gains `heavy: bool`.** Today every build takes the
  heavy-read lock. With the flag, each read keeps the locking it has, and the three
  light reads don't queue behind the songs.
- **The routes that hold `heavy_read` today drop it,** and pass `heavy=True`
  instead; holding both would raise `HeavyReadReenteredError`.

## Asking with the ETag held

`api.ts` gains a conditional read for the cached answers. It is a class, so each
test and each signed-in session starts with nothing held:

```ts
class HeldReads {
  /** The last answer of each path, and the ETag it came with. */
  private readonly held = new Map<string, { etag: string; value: unknown }>();
  /** The read under way for each path, and whether one more is wanted after it. */
  private readonly flying = new Map<string, { answer: Promise<unknown>; again: boolean }>();

  read<T>(path: string): Promise<T>; // sends If-None-Match; a 304 gives the held object
  forget(): void;                    // drops everything; called on every sign-out
}
```

- **Why send it ourselves.** `fetch` turns a browser revalidation's 304 into a 200
  holding the cached body, so the client can't tell an unchanged answer from a new
  one. A request that carries `If-None-Match` skips the HTTP cache, as the Fetch
  standard requires, so the 304 reaches the client.
- **The first read on a page** has nothing held. It goes through the browser's
  cache as before, so a page refresh still revalidates instead of downloading.
- **One read per path at a time.** A read asked for while one runs waits for a
  single trailing read, which starts when the first ends. Two callers asking at
  once share it. So an older answer can never land after a newer one, in the store
  or in `held`. This covers every path to the songs: `load`, and `reloadTracks`
  after a split, an added link or file, or a setting change.
- **Identity is the signal.** Callers don't get an "unchanged" flag: they get the
  very object they had. React state set to the same object doesn't render again,
  and the store treats the same array as no change. Held answers are frozen in
  development, so code that changes one fails at once.
- **Forgotten on every sign-out,** including a 401 that signs the page out, as the
  server's `Clear-Site-Data` clears the browser's copy.

## Keeping what didn't change

The store's `loaded` action keeps what it can:

```ts
case "loaded": {
  if (action.tracks === store.listed) return store; // a 304: the same list
  const before = [...store.confirmed.values()];
  let same = action.tracks.length === before.length;
  const confirmed = new Map<number, Track>();
  action.tracks.forEach((track, index) => {
    const known = store.confirmed.get(track.id);
    const kept = known !== undefined && equalJson(known, track) ? known : track;
    same &&= before[index] === kept; // the same Track in the same place
    confirmed.set(track.id, kept);
  });
  return {
    ...store,
    confirmed: same ? store.confirmed : confirmed,
    listed: action.tracks,
    pending: /* as now */,
    loaded: true,
  };
}
```

- **An equal list keeps the `Map`,** so nothing renders. This still matters with
  content ETags: a play changes one Track's play count, and the list comes back
  with every other Track equal.
- **Order counts:** the same Tracks in a new order give a new `Map`, as the views
  show that order.
- **`equalJson` compares two JSON values deeply.** It is about fifteen lines,
  needs no upkeep when `Track` gains a field, and takes well under a millisecond
  for 1,738 Tracks.

## When the side reads run

Content ETags break one shortcut: the songs answering 304 no longer means the side
answers are unchanged. A Job that finds a split offer, for example, changes no
Track. So the side reads don't follow the songs; they follow a counter,
`library.refreshes`, that moves whenever the Library may have changed:

| Event | `refreshes` |
| --- | --- |
| A load (the page shown again, the event stream reconnecting, the Mode changing, a setting changing how songs show), once the songs answer | +1 |
| Any Job ending, a second after the last one ends; a load instead if one of them changes songs | +1 |
| An edited Track read back, or the songs read again after a change made here | +1 |
| A favorite or rating written | unchanged |

A load moves the counter once the songs answer, not as it starts, so the songs are
still read first and alone.

`Library` passes `library.loaded ? library.refreshes : undefined` to the six hooks.
Each side read is conditional, so a read that nothing changed answers 304 and keeps
its object: no render.

- **Any Job, not only those that change songs.** Finding pictures, finding an
  artist, and suggesting images change side answers but no Track. Six 304s cost
  little.
- **The polls follow a count of answers, not the answer.** `useArtistNames` and
  `FindPhotos` read again every few seconds while something is being found. A timer
  that depended on the answer object would stop at the first 304, which keeps it.
  Instead, each timer depends on `answered`, a count of the answers that came while
  something was still being found. An answer with nothing being found leaves the
  count alone, so an unchanged answer still renders nothing. `useReadAgain` keeps
  the count for `useMissingPhotos`, which passes it to `FindPhotos`.

```mermaid
flowchart TD
  T[Visible, reconnect, Mode, setting] --> S[Songs, conditional]
  J[A Job ends] --> W[Wait a second]
  W --> R
  T --> R[refreshes + 1]
  R --> V[Six side reads, conditional]
  S -- 304 --> X[Same store: nothing renders]
  S -- new list --> K[Keep equal Tracks]
  V -- 304 --> Y[Same object: nothing renders]
```

## Interfaces

| Type | Where | Change |
| --- | --- | --- |
| `CachedAnswers.etag` | `web/cached.py` | Hashes the key and the bytes; no boot mark |
| `CachedAnswers.answer(..., heavy=)` | `web/cached.py` | Takes the heavy-read lock only when asked |
| `DatabaseRevision.ignoring()` | `persistence/revision.py` | New, static: writes on this thread inside it don't bump |
| Five side-read routes | `web/*.py` | Answer through `CachedAnswers`, with `responses=NOT_MODIFIED` |
| `HeldReads`, `forgetHeldReads` | `web/src/api.ts` | New: conditional, one-at-a-time reads by path; `App` forgets them when the Account changes |
| `api.tracks`, `api.artistNames`, the five side reads | `web/src/api.ts` | Read through `HeldReads` |
| `Store.listed` | `web/src/library/store.ts` | New: the array last loaded, so a 304 is no change |
| `equalJson` | `web/src/library/store.ts` | New: deep equality of two JSON values |
| `Library.refreshes` | `web/src/library/useLibrary.ts` | New: the count the side reads follow |
| `useReadAgain(..., changing)` | `web/src/library/useReadAgain.ts` | New argument; returns `answered`, the count the polls follow |
| `serve()` routes' `etag` | `web/src/testing/server.ts` | New: a test server answers 304 to a request holding the ETag |

## Boundary cases

| Case | Behavior |
| --- | --- |
| The tab hidden for an hour, nothing changed | No revision move; the songs and every side read answer 304 |
| A song played meanwhile | The revision moves; the songs rebuild with one Track changed; side reads rebuild and answer 304 |
| The server restarts | Cached answers rebuild; equal bytes keep their ETags, so 304 |
| A read fails | The held answer stays; the next read sends its ETag again |
| A 304 arrives with nothing held | Treated as a refusal; the next read asks without an ETag |
| A read asked for during one under way | One trailing read after it, shared by every caller who asked |
| A favorite written during a load | The pending write overlays the list, as now; `refreshes` is unchanged |
| The same Tracks in a new order | A new `Map` |
| Two Accounts on one browser | Signing out forgets every held answer; their ETags differ anyway |
| The Mode goes Online or Offline | The songs' key changes on the server, so a new list |

## Testing

- **ETags:** a rebuild with the same bytes keeps the ETag and answers 304; one
  changed byte changes it; two Accounts never share one; a new boot no longer
  changes it.
- **`ignoring()`:** a write inside it leaves the revision alone, and one on another
  thread at the same time still bumps it; a signed-in request a minute later leaves
  the revision alone; no ignored write touches a table a cached answer reads.
- **Each newly cached read:** 304 for a matching `If-None-Match`; 200 after a write
  that changes it; the light ones never take the heavy-read lock; the cached bytes
  equal what the model serializes.
- **`HeldReads`:** no `If-None-Match` the first time, the held ETag after; a 304
  returns the very object held; a 200 replaces it; a refusal keeps it; reads asked
  during one under way share one trailing read; an older answer never replaces a
  newer one; `forget` drops all.
- **The store:** the same array gives the same store; an equal list keeps the `Map`
  and every Track; one changed Track keeps the rest; a new order gives a new `Map`;
  `equalJson` on nested arrays, objects, and `null`.
- **`useLibrary` and `Library`:** a heart click sends no side read; a load and a Job
  ending each send each side read once; two 304s in a row keep the 2 s polls going.
- **End to end:** returning to the tab with nothing changed sends the songs and the
  side reads, all answered 304, and the page doesn't render again.

## Measuring

On an Offline copy of the preview library of 1,738 songs, in headless Chromium, one
run each. *Return* is the page shown again after two minutes with nothing changed,
so the session's last-seen time is written first. *Heart* is one favorite given.
Main-thread time is Chromium's task time until the page is quiet.

| | Return, before | Return, after | Heart, before | Heart, after |
| --- | --- | --- | --- | --- |
| Requests | 17, all 200 | 17: 7 answered 304 | 13 | 1, the write |
| Bytes | 148 kB | 5.7 kB | 127 kB | 0.8 kB |
| Main-thread time | 187 ms | 104 ms | 136–206 ms | 63–148 ms |
| Last answer | 0.96 s | 0.40 s | 0.75–1.85 s | 0.08–0.13 s |

The ten reads still answered 200 on a return are the small uncached ones: favorites,
preferences, Playlists, the Mode, five enrichers, the Downloads, and the features.
The enricher reads are the next step named in [Open questions](#open-questions).

## Deferred: changed songs announced

When one song changes, the songs read answers in full: 1.24 MB, or 82 KB with
gzip, for 1,738 songs. The client keeps every unchanged Track, so it renders
little, but it still downloads and parses the whole list. On a home network that
costs a few milliseconds, so this step waits.

The planned design sends only what changed, without a change log on the server:

- **The event stream announces changed songs.** After a write, `GET /api/events`
  names the Track ids it changed, such as *songs 42 and 97 changed*.
- **The client reads just those songs** with `GET /api/tracks/{track_id}`, puts
  each into the store, and drops ids that answer 404.
- **The full read stays the resync.** After a reconnect, a Mode change, a missed
  event, or anything the client can't account for, it reads the songs with the
  held ETag as it does today, and gets a 304 when nothing changed.

Rejected for now: a `?since=revision` patch. It needs the revision that last
changed each row, a record of removed songs and when to prune it, and a "too old,
read it all" answer. It also has to cover each Account's hearts, ratings, and
plays, and the Mode changing which songs are listed.

**Trigger:** a songs answer measured above about 500 KB gzipped, or a reload
measured as slow because of it. Pick it up together with paging, whose trigger is
a library past about 20,000 songs.

## Open questions

- **Per-view reads.** The plan listed reading the side reads only when a view needs
  them. All six feed the Clean up count on the rail, and the artist names feed every
  artist link, so they are needed on every view. With this note, an unchanged side
  read costs a 304. A further step could replace the five Clean up reads with one
  cached `GET /api/clean-up`: one request, one ETag. I'd leave both out, and
  revisit them if the measurements still show the side reads.
- **The enricher reads.** Five heavy reads on each load, uncached because they
  report "asked in the last 24 hours" from the clock. Sending when each Track was
  asked, and letting the client apply the 24 hours, would make them cacheable. I'd
  take that as its own step after this one.
- **Favorites.** A heart moves the revision, and the client rebuilds its favorite
  groups from any answer, so caching them would buy nothing yet. Left out.
- **The name `refreshes`.** It counts the times the Library may have changed, as
  the side reads see it. Your call if another name reads better.
