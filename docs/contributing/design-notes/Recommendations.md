# Recommendations

> [!NOTE]
> **Status: proposed.** This note describes how medleyplay suggests what to play
> next from an Account's own Library: a radio from a song, and a few mixes. It
> builds on plays, favorites, and ratings ([Playback](Playback.md),
> [Web client](Web%20client.md)) and on Track details
> ([Track details](Track%20details.md)). Everything here works Offline and sends
> nothing anywhere.

## Contents

- [What it offers](#what-it-offers)
- [What it learns from](#what-it-learns-from)
- [Which songs can be suggested](#which-songs-can-be-suggested)
- [How songs are scored](#how-songs-are-scored)
- [Radio](#radio)
- [Mixes](#mixes)
- [Sources considered](#sources-considered)
- [What the API shows](#what-the-api-shows)
- [Testing](#testing)
- [Left for later](#left-for-later)

## What it offers

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

## Radio

- **The seed is a song;** radio from an album or artist seeds from its most
  played song, or its first if none was played.
- **Picks are drawn, not ranked:** the next song is drawn from the top 30
  candidates, each weighted by its score (all candidates score above 0), so two
  radios from one seed differ. The draw uses a generator seeded by the request,
  so a test fixes it.
- **Variety:** never the same song twice in one radio, at most two songs in a
  row by one artist, and at most three from one album. The rules filter the
  candidates before the top 30 are taken; when too few remain, the album rule is
  dropped first, then the artist rule. When no candidate remains, the radio
  ends, and the queue says so.
- **The server keeps no radio:** the client sends the seed, the generator's
  seed, and the songs the radio already played, and gets the next ones. The
  queue holds the next ten and asks for more when four remain. Choosing another
  song or turning shuffle on ends the radio; the queue shows that it is a radio,
  and from which song.

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

- `POST /api/radio`: given a seed Track, a generator seed, the ids already
  played, and a count of at most 25, the next songs, each with its reason; a
  read, sent as a body because the list of ids grows.
- `GET /api/mixes`: the Account's mixes, each with when it was built, its songs,
  and their reasons; `POST /api/mixes/rebuild` rebuilds them now.

## Testing

- **Example-based:** hand-made libraries in `tests/support` where the expected
  pick is obvious (one artist's songs, an album, an untagged pair that must not
  match, a disliked song, a site Track without a Download), each scoring term on
  its own.
- **Properties (Hypothesis):** a radio never repeats a song, never suggests a
  song rated 1–2, one that cannot play now, or an album file; it keeps the
  variety rules unless too few songs remain; a mix holds only the Account's own
  signals; the same seed and generator give the same radio.
- **Degenerate libraries:** no plays, one artist, one album, everything unrated,
  nothing tagged.
- **Performance:** radio for a Library of 20,000 Tracks answers within 200 ms on
  the household's machine, from a snapshot of the Tracks' details and states
  kept until the catalog changes, as the download policy keeps its own.

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
