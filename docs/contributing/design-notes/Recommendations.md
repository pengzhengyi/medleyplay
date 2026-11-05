# Recommendations

> [!NOTE]
> **Status: the Radio tab and its stations are built, in the web client; *Start
> radio* in a song's menu and the mixes are proposed.** This note describes how
> medleyplay suggests what to play
> next from an Account's own Library: a Radio tab of albums for the Account and
> a station of its own, a radio from a song, and a few mixes. It
> builds on plays, favorites, and ratings ([Playback](Playback.md),
> [Web client](Web%20client.md)) and on Track details
> ([Track details](Track%20details.md)). Everything here works Offline and sends
> nothing anywhere.

## Contents

- [What it offers](#what-it-offers)
- [What it learns from](#what-it-learns-from)
- [Which songs can be suggested](#which-songs-can-be-suggested)
- [How songs are scored](#how-songs-are-scored)
- [The Radio tab](#the-radio-tab)
- [Radio](#radio)
- [Mixes](#mixes)
- [Sources considered](#sources-considered)
- [What the API shows](#what-the-api-shows)
- [Testing](#testing)
- [Left for later](#left-for-later)

## What it offers

- **The Radio tab:** *My station*, a radio from the Account's own taste, and
  shelves of albums to play: *More like …*, *Not played yet*, *Rediscover*, and
  *Just added*.
- **Radio:** *Start radio* in a song's menu and in Now Playing fills the queue
  with songs like it, and keeps adding more as it plays.
- **Mixes:** a *For you* view holds three mixes per Account: *On repeat*,
  *Rediscover*, and *Just added*.

## What it learns from

- **One Account's own signals.** One Account's plays never shape another's
  radio or mixes.
- **Taste, per Track,** from `track_state`, so nothing scans the plays:

  | Signal | Reads as |
  | --- | --- |
  | Favorite | strongly liked |
  | Rating 4–5 | liked; 3, and no rating, are neutral |
  | Rating 1–2 | disliked: never suggested, by radio or a mix |
  | Play count | liked, on a log scale |

  A play is what [Playback](Playback.md) records: half the song or four minutes
  of playing, never a Track under 30 seconds, so a song skipped early never
  counts.
- **Likeness, between two Tracks,** from their shown details: artist, album,
  album artist, genre, and year.

## Which songs can be suggested

- **Songs that play now:** a Track with a file in a Library or a Download. A
  site Track without a Download is never suggested, so a radio or mix never
  starts a Download nobody asked for.
- **Songs, not album files:** a segment is a song; a split album file is never
  suggested whole, and neither is an unsplit file over 20 minutes.
- **Never a song rated 1–2.**

## How songs are scored

Scoring is a small, explainable sum, not a model:

```text
likeness = 3·same artist + 2·same album + 1·same album artist
         + 2·shared genre + 1·exp(−|year difference| / 5)
taste    = favorite + (rating − 3) / 2 + log(1 + plays) / 4      (no rating counts as 3)
score    = likeness + taste − recency                            (a song with likeness 0 is no candidate)
recency  = 2 if played in the last 2 hours, 1 if in the last day
```

- **Values are compared as smart-playlist rules compare text:** folded for
  case and width (`rules.fold`). An empty value matches nothing, so untagged
  Tracks don't all look alike, and an album artist of *Various Artists* counts
  as empty.
- **Genre is split** on `;`, `,`, and `/`, and two Tracks share a genre when
  their parts overlap.
- **Taste only breaks ties between like songs:** a song must be like the seed to
  be a candidate at all, and taste is worth less than one matching field, so a
  favorite does not crowd into every radio.
- **Weights are constants in the domain,** tuned by tests on hand-made
  libraries, not settings. A missing value adds nothing rather than counting
  against a song.
- **Each suggestion says why** in one short line, from its largest term:
  *Same artist*, *Same album*, *Same genre*, *A favorite*.

## The Radio tab

A tab of its own, after Songs, with *My station* at the top and shelves of
album cards below, each card with its cover, name, album artist, and a line
saying why it is there.

- **An album** is its name and its album artist (the artist when there is
  none), compared folded with the client's own `fold`, as the Albums view
  groups them; the songs of one split file are one album, whatever artists they
  name, called by their album or else by the file's title. A song with no album,
  or one named only by a video's id (`BV…`), is on none. Only albums of at
  least 2 songs that play now are suggested, so a single and an album file are
  not.
- **An album's taste** is the mean taste of its 3 best-liked songs, so a few
  favorites make an album loved; **its last play** the latest of its songs';
  **its added** the earliest *added* of theirs. An album where most rated songs
  are rated 1–2 is never suggested.
- **The Account's affinity** for an album artist or a genre is the log of the
  summed taste of the Account's songs by that artist or with that genre, so
  playing an artist's songs makes its other albums likelier without the artist
  with the most songs crowding out the rest; a genre most albums share counts
  for less, as rarely as it is found. An empty artist or genre is never one.

| Shelf | Albums | Ranked by | Says |
| --- | --- | --- | --- |
| *More like …* | Like the most played of the albums played in the last 30 days: same album artist 3, each shared genre 2, years at most 5 apart up to 1 | Likeness | *Like 生如夏花* |
| *Not played yet* | No song played, by an album artist or with a genre the Account likes | Affinity for the artist, then half the genre's | *New to you, from 朴树* |
| *Rediscover* | Album taste of at least 0.75, not played in 60 days | Taste times the months since, up to 12 | *Not played since March 2026* |
| *Just added* | Added in the last 30 days, not every song played | Newest first | *Added 3 days ago* |

- **The client knows lifetime plays, not plays by day:** *played most in the
  last 30 days* is the album with the most plays among those played in the last
  30 days.
- **Each album shows once,** on the first shelf in the table's order that takes
  it, with at most 2 albums by one album artist on a shelf and at most 12 a
  shelf. A shelf with none is not shown; when the Account has played and liked
  nothing, a last shelf, *From your Library*, shows the newest added albums.
- **Stable for a day:** ties break by a generator seeded by the Account and the
  date, so the tab doesn't reshuffle on every visit.
- **A card opens its album** when its songs name one; its play button plays the
  album's songs that play now, and *Start a station* starts a radio from the
  album's most played song.
- ***My station*** is a radio from the Account's taste: its first song is drawn
  from the Account's 20 best-liked songs, at most 2 by one artist and 2 from one
  album, never one still titled by a video's id. When songs like it run out, it
  goes on from another liked song.
- **Computed in the web client,** which already holds every Track with the
  Account's favorite, rating, plays, last play, and added: the tab needs no new
  route, works the moment the Library loads, and goes on working with the server
  out of reach. Folded names and genres are remembered, and each pick walks one
  list sorted once: 20,000 Tracks shelve in about 80 ms and give ten picks in
  about 60.

## Radio

- **The seed is a song;** radio from an album or artist seeds from its most
  played song, or its first if none was played.
- **A candidate shares an artist, album, album artist, or genre with the seed;**
  a close year only adds to that. A seed with nothing tagged has no radio.
- **Picks are drawn, not ranked:** the next song is drawn from the top 30
  candidates, each weighted by its score (all candidates score above 0), so two
  radios from one seed differ. The draw uses a generator seeded by the Account
  and the moment the station starts, so a test fixes it.
- **Variety:** never the same song twice in one radio, at most two songs in a
  row by one artist, and at most three from one album. The rules filter the
  candidates before the top 30 are taken; when none remains, the album rule is
  dropped first, then the artist rule. When no candidate remains, the radio
  ends.
- **The client keeps the radio:** it draws from the Tracks it holds, with the
  seed, the generator, and the songs the radio already queued. The queue holds
  the next ten and draws more when four remain; *Play next* and *Add to queue*
  leave it running. Playing a song it didn't queue, or turning shuffle on, ends
  it. It lives in the page alone, so a reload ends it, and the queue it filled
  plays on as an ordinary queue.

## Mixes

- **On repeat:** the Account's 25 most played songs of the last 30 days.
- **Rediscover:** favorites and songs rated 4 or more, not played in 90 days,
  25 drawn by taste.
- **Just added:** up to 25 songs added in the last 14 days and never played by
  the Account, newest first, so new music has a way in before it has plays.
- **A mix is not a Playlist.** It is a drawn list the server stores in its own
  `mix` and `mix_entry` tables, one row per Account and kind, and serves at
  `/api/mixes`; it can't be edited or marked *Keep downloaded*, and *Save as
  playlist* copies it into a new Playlist.
- **Rebuilt once a day:** when an Account opens *For you* and its mixes were
  built before today, they are rebuilt then, and *Rebuild* does it on request.
  So a machine asleep overnight misses nothing.

An empty mix says why, such as *Play some songs and they'll show here*.

## Sources considered

| Source | Used for | Why |
| --- | --- | --- |
| The Account's own plays, favorites, ratings, and details | Radio and mixes | Already held, works Offline, sends nothing |
| ListenBrainz | Not yet; see below | Public API from the MusicBrainz project, keyed by MusicBrainz artist ids, which medleyplay doesn't record yet |
| Rate Your Music | Not used | No API; its terms forbid scraping, and it is guarded against bots |
| Last.fm, Discogs | Not used | Need a key; a look only if a later step needs more |

## What the API shows

- **Radio and the Radio tab need no route:** the web client draws them from the
  Tracks of `GET /api/tracks`.
- `GET /api/mixes`: the Account's mixes, each with when it was built, its songs,
  and their reasons; `POST /api/mixes/rebuild` rebuilds them now.

## Testing

- **Example-based, in Vitest:** hand-made libraries where the expected pick is
  obvious (one artist's songs, an album, an untagged pair that must not match,
  a song sharing only a year, a disliked song, a site Track without a
  Download, a split file's songs), each scoring term and shelf on its own.
- **Invariants over many generators:** a radio never repeats a song, never
  suggests a song rated 1–2, one that cannot play now, or an album file; it
  plays no three songs in a row by one artist while others remain; the same
  generator gives the same radio.
- **Degenerate libraries:** no plays, nothing tagged, albums named for a video,
  singles only.
- **Performance:** shelves and ten picks for 20,000 Tracks, bounded at 5 seconds
  to catch quadratic work without failing on a busy machine.

## Left for later

- **Played together:** how often the Account played two songs close together,
  as likeness. It needs a bounded table built by a daily Job, a cap on long
  shuffled sessions, and enough play history to show it is worth that.
- **Artists you don't have,** opt-in: the MusicBrainz artist ids of the artists
  the Account plays most, sent to ListenBrainz's radio data
  (`GET https://api.listenbrainz.org/1/lb-radio/artist/{artist id}`, one request a
  second, waiting out `X-RateLimit-Reset-In` on a 429), answering artists like
  them. It waits on medleyplay recording MusicBrainz artist ids, which the
  MusicBrainz enricher doesn't, and is worth little while most artists here are
  Bilibili channels and collaborations that MusicBrainz doesn't list. What it
  would reveal: the household's most played artists, from its address.
- **Mixes per artist** (*Like …*), which overlap radio.
- **Skips** as a dislike, and *Not this* in a radio, once the client records
  them.
- **Likeness from the audio itself** (tempo, loudness, embeddings).
