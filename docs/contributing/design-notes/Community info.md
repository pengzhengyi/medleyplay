# Community info

> [!NOTE]
> **Status: in part built.** The community rating from MusicBrainz is built, as
> this note says; the rest is proposed. This note describes what medleyplay shows about a song
> from what other listeners have said about it: a community rating where the
> Account gave none, reviews, a short summary of the song or album, and similar
> songs; and how the household brings in its own Rate Your Music ratings. Each
> source is an enricher plugin ([Track details](Track%20details.md#enrichers)),
> and nothing here changes a Track's shown details.

## Contents

- [What it offers](#what-it-offers)
- [Sources](#sources)
- [Step 0: measure before building](#step-0-measure-before-building)
- [MusicBrainz ids and ratings](#musicbrainz-ids-and-ratings)
- [Changes to the plugin API](#changes-to-the-plugin-api)
- [Storing what a source found](#storing-what-a-source-found)
- [The community rating](#the-community-rating)
- [Reviews and summaries](#reviews-and-summaries)
- [Similar songs](#similar-songs)
- [Importing the household's own Rate Your Music ratings](#importing-the-households-own-rate-your-music-ratings)
- [Showing text and links from other sites](#showing-text-and-links-from-other-sites)
- [Licenses and attribution](#licenses-and-attribution)
- [What the API shows](#what-the-api-shows)
- [Migrations](#migrations)
- [Testing](#testing)
- [Left for later](#left-for-later)

## What it offers

- **A community rating** where the Account hasn't rated a song, shown apart
  from the Account's own: outline stars, with where it came from and how many
  votes it has.
- **About this song:** a short summary of the song or its album, and up to
  three reviews, in Track details and in Now Playing.
- **Similar songs:** the ones in the Library first, ready to play, then the ones
  the household doesn't have, as names with a link to where they came from.
- **The household's own RYM ratings and reviews,** from the export each member
  downloads from their own profile, as album ratings and notes.

What it can't offer: Rate Your Music's own average ratings, its reviews, and its
lists. They are on its site alone, which medleyplay doesn't read (see below).

## Sources

| Source | Gives | Keyed by | Plugin |
| --- | --- | --- | --- |
| MusicBrainz | Ratings of recordings and release groups, from listeners' 1–5 stars; the ids and Wikidata links the others need | Its own match | `musicbrainz`, already built |
| CritiqueBrainz | Reviews of recordings and release groups, each with its author, rating, and license | MusicBrainz ids | `critiquebrainz` |
| Wikidata and Wikipedia | A summary of the song's work or its album | Wikidata ids, from MusicBrainz | `wikipedia` |
| Last.fm | Similar tracks and artists, with a match score | Title and artist, and a key of the household's | `lastfm` |
| Rate Your Music | The household's own album ratings and reviews | A file a member downloads from their RYM profile | No plugin: an import in Settings |

- **Rate Your Music is never read by medleyplay.** It has no API (Sonemic's is
  planned, without a date), its staff have said it doesn't allow scripts or
  scraping, and it sits behind bot protection. What it holds of the household's,
  their own ratings and reviews, comes in through their own export.
- **One plugin per site,** so each keeps its own pace, its own stopped state,
  and its own switch, as enrichers do now: CritiqueBrainz refusing a request
  leaves Wikipedia running. Wikidata and Wikipedia are one site to medleyplay,
  both Wikimedia's, behind one pace. Settings shows them together under
  *Community info*.
- **All are off by default** (`OFF_BY_DEFAULT`), since each contacts a site, and
  none goes through a proxy: none is the household's Bilibili route.

## Step 0: measure before building

Most of the household's Library is Bilibili videos and Chinese-language music,
which these sites cover thinly. Two checks come first, and decide how much of
this note is built:

- **Coverage:** for 200 Tracks drawn from the household's Library, how many
  MusicBrainz matches, ratings of at least 3 votes, reviews, Wikipedia articles,
  and Last.fm similar lists there are, from a script that uses medleyplay's
  clients at their normal pace. A source that answers for few Tracks is left out.
- **The RYM export:** a member downloads their export, which confirms that it
  still exists and what its columns are. Without one, the import is left out.

## MusicBrainz ids and ratings

Every keyless source here is keyed by something MusicBrainz knows, so the
`musicbrainz` enricher answers more, in the same Job as its match:

- **The ids of its match:** the recording, its release group, its artists, and
  the recording's works.
- **The ratings come with the release it already looks up** (built): asking for
  `release-groups+ratings` beside the recordings gives the rating of each
  recording and of the release group, with no more requests.
- **Two more lookups** for the Wikidata links (proposed), at its usual pace of
  one request a second: the recording with `inc=work-rels`, and the release group
  with `inc=url-rels`. A recording has no Wikidata link of its own.
- ***Find on MusicBrainz* stays the one question,** asked once a day per Track
  and what it was searched for, as now; there is no second MusicBrainz question
  to keep apart from it.
- **The ids are no shown details:** *Edit details* doesn't show them, rules don't
  read them, and the household doesn't edit them. They are kept in `track_link`,
  replaced whole with the `musicbrainz` values. An answer with no candidate
  removes them, and with them what the other sources found for them (see
  [Storing what a source found](#storing-what-a-source-found)).
- **A long file has only its release group's ids,** since it is matched as a
  release; its songs, until each is matched, have none of their own, so a song
  inside a long file gets album-level info and no song rating.
- **Tracks matched before this change** have no ids. The migration forgets the
  asked-once rows of `musicbrainz`, so finding them on MusicBrainz asks about
  them again.

## Changes to the plugin API

A community source is a `TRACK_ENRICHER`, and the core reuses the enricher's Job
kind, lane, asked-once table, Offline wait, and stopped state. What changes:

- **The ask gains `links`,** the Track's MusicBrainz and Wikidata ids, and
  `shown` keeps the `musicbrainz` origin's values for an enricher that isn't
  `musicbrainz`, since only `musicbrainz` must not ask with its own answer.
- **The answer gains `ratings`** (built): at most one of the song and one of its
  album, each a mean out of 5, its votes, and the page that shows it. The core
  keeps a rating only when its page is on one of the enricher's own hosts.
- **The answer gains a `community` part** (proposed), beside or instead of
  values: reviews, a summary, or similar songs, each in a bounded model, and
  `musicbrainz` answers `links` too. The answer's check accepts an answer of
  only a community part.
- **An enricher may have no origin.** `Enricher.origin` becomes optional, and an
  enricher without one records no values; the core rejects values from it.
- **New subjects** for the asked-once table: `LINKS`, a hash of the source's name,
  the Track's id, and the ids it asks with, so a new match asks again at once;
  and the existing `WORDS` for Last.fm, over the shown title and artist.
- **New reasons a Track is not eligible:** `NO_LINKS` (no MusicBrainz match yet)
  and `NO_KEY` (Last.fm without a key).
- **One Job per Track and enricher.** An enrich Job's target becomes
  `track:<id>:<enricher>`, so asking a second source about a Track queues its own
  Job instead of returning the first source's. This is a fix to the enrichers
  already built and lands on its own, first.
- **Segments stay out:** no source asks about a segment, as now; its album file
  is asked instead.
- **Plugins and host ship together** from this repository, so the models'
  `extra="forbid"` stays: a plugin and a host of different versions are never
  paired.

## Storing what a source found

- **`community_rating`** (built), one row per Track, source, and song or album:
  the mean, the votes, the page, and when it was found. A source's next answer
  about the Track replaces its rows, so an answer that finds nothing removes them.
- **`community_info`,** one row per Track and source: the source, the ids it was
  found for, when it was found, when it expires, and the checked answer as JSON.
  A new answer from that source replaces the row.
- **Rows follow the match:** when `musicbrainz` records different ids for a
  Track, or none, the rows found for the old ids are deleted in the same
  transaction.
- **Bounded:** at most 3 reviews, 1 summary, 2 ratings, and 10 similar songs per
  row; text at most 2,000 characters, names at most 512, links at most 2,000, and
  licenses from a fixed list.

## The community rating

- **From MusicBrainz:** the recording's rating when it has at least 3 votes,
  else the release group's with at least 3, labeled *album*. A rating of fewer
  votes isn't shown. A song inside a longer file shows the album file's rating
  of the album.
- **Shown only where the Account has no rating of its own,** as outline stars to
  the nearest half, with *MusicBrainz: 4.2 from 37 votes* (or *album: 4.2 …*) on
  hover. Choosing a star sets the Account's own rating, as now.
- **Counts for nothing that acts:** smart-playlist rules, the download policy's
  removal order, and recommendation taste never read it. A rule like *rating at
  least 4* that started matching what strangers rated would change what is kept
  downloaded, and so what is deleted, without anyone in the household choosing
  it. A separate rule field, *community rating*, can come later if wanted.
- **Sorting by rating** sorts by the Account's own rating, and only among songs
  with none by the community rating, so a stranger's three 5-star votes never
  outrank the Account's own 4.

## Reviews and summaries

- **A summary** is the Wikipedia article's own summary (`page/summary`), for
  the song's work, else its release group, reached through Wikidata's links to
  each language's article. The language is the first with an article of the
  languages listed in Settings → Community info (Chinese, then English, at
  first), then any. It is kept as plain text, marked *Excerpt*, with the
  article's link.
- **Reviews** are CritiqueBrainz's three most popular for the recording, else
  its release group, each kept with its author, rating, date, license, and link,
  its text cut to 2,000 characters, marked *Excerpt* when cut, with a link to the
  whole review.

## Similar songs

- **From Last.fm** `track.getSimilar`, by title and artist, the 10 best kept
  with their match scores, and `artist.getSimilar` when a song has none.
- **Kept briefly:** Last.fm's terms allow caching only a small portion of its
  data, as its HTTP cache headers allow. A row keeps the expiry those headers
  give, at most 7 days; an expired row is deleted at startup and daily, and
  shows nothing until someone asks again.
- **Matched to the Library** when shown, by folded title and artist as rules
  compare text, so a song added later is found without asking again. A match
  plays; the rest show as names with a link to Last.fm.
- **The key** is a secret kept through the same keyring seam linked accounts
  use, set in Settings and never shown again. Last.fm takes it in the URL, so
  the client removes it from every error, log line, and message. Last.fm's
  answers for an invalid or suspended key stop the source with a message to
  check the key, as a refusal does.
- **Radio could use it later:** a song Last.fm calls similar to the seed could
  add to likeness in the proposed recommendations; that waits until radio is
  built and there is reason to think it helps.

## Importing the household's own Rate Your Music ratings

- **Settings → Import ratings** takes the CSV a member downloads from their own
  RYM profile, for the Account signed in. Nothing is sent anywhere.
- **The file is checked first:** at most 5 MiB and 20,000 rows, UTF-8 (a byte
  order mark is dropped), fields at most 10,000 characters, and a header the
  reader knows; anything else is rejected, naming what was wrong. The format is
  no published contract, so the reader is written against the household's own
  export, kept in `tests/support`.
- **RYM rates releases, not songs,** so an imported rating is the Account's
  rating of an album, kept per Account in `album_rating` with the album and
  artist names as exported, the standard and the localized. Every row is kept,
  matched or not, so an album added later matches without importing again.
- **Matching** compares the album, and the artist with either name, folded as
  rules compare text; when that finds nothing, it tries again with a trailing
  edition note in brackets (*(Deluxe Edition)*, *[Disc 1]*) removed from both.
- **RYM's half stars** (its export's 1–10) become stars by halving and rounding
  half up, so 7 (3½ stars) is 4. A 0 is no rating.
- **The review column** becomes the Account's note on that album, shown in
  *About this album* to that Account alone.
- **The Account's rating of a song** is its own rating of the song, else its
  rating of the song's album, in one function, `effective_rating`, that rules,
  the download policy, the table, and sorting all read. A song rated from its
  album shows solid stars marked *From your album rating*; choosing a star rates
  the song alone, and clearing it falls back to the album's.
- **The import previews before it applies,** since an album rating moves songs
  in and out of smart playlists and changes what may be removed first: how many
  albums and songs it matches, which albums it doesn't, and how many songs join
  or leave each smart playlist. Applying it plans downloads again, as a rating
  change does. Importing again replaces the earlier import, never a rating set in
  medleyplay. The unmatched albums can be saved as a plain-text list.

## Showing text and links from other sites

- **Text is shown as text,** never as HTML, with control and bidirectional
  formatting characters removed, so a review can't run script, load images, or
  reorder what is around it.
- **Links are checked by the core:** `https` only, and only to the source's own
  hosts (MusicBrainz, CritiqueBrainz, Wikipedia's language sites, Last.fm); any
  other is dropped. They open with `rel="noopener noreferrer"` and no referrer.

## Licenses and attribution

| Data | License | Shown with |
| --- | --- | --- |
| MusicBrainz ratings | CC BY-NC-SA 3.0 (supplementary data) | *MusicBrainz* and a link to the entity |
| CritiqueBrainz reviews | Each review's own, CC BY-SA or CC BY-NC-SA | The author, the license, and a link to the review |
| Wikipedia summaries | CC BY-SA 4.0 | *From Wikipedia*, the article's link, and the license |
| Last.fm similar songs | Last.fm's API terms: non-commercial, credited and linked, cached briefly | *Last.fm* and a link |

The household's own use fits these: medleyplay keeps this data in the
household's database, serves it only to the household's signed-in Accounts, and
keeps Last.fm's for no longer than its terms allow.

## What the API shows

- `GET /api/tracks/{id}/community`: the community rating, summary, reviews, and
  similar songs, each with its source, link, license, and when it was found;
  similar songs carry the Track id of their Library match.
- A Track gains `community` (built): the source, whether the song or its album
  was rated, the mean, the votes, and the page; or `null`. Whether the Account's
  rating comes from its album is proposed.
- `POST /api/tracks/{id}/community/find` queues a Job for each source that is on
  and can answer; `POST /api/community/find-all` does it for every eligible
  Track, for admins.
- `POST /api/ratings/import/preview` checks a RYM file and answers what it would
  change; `POST /api/ratings/import` applies the same file.

## Migrations

- `track_link`: the Track, the kind of id, the id, and the origin that found it.
- `community_rating` (built), which also forgets `musicbrainz`'s asked-once rows.
- `community_info`, as above.
- `album_rating`: the Account, the album and artist names as exported, the
  stars, and the note.
- The enrich Job target change, and forgetting `musicbrainz`'s asked-once rows.

## Testing

- **Each client against recorded answers:** one real answer per endpoint,
  fetched once by hand with medleyplay's User-Agent and kept in
  `tests/support/recordings`, as `musicbrainz`'s are; tests never contact a site.
- **The core:** a community part never changes shown values (a property over
  the shared shown-details cases); rules and the download policy never read a
  community rating (a property over rule trees); a new match deletes the old
  ids' rows; an expired Last.fm row is deleted; a link to another host is
  dropped; control and bidirectional characters are removed; the Last.fm key is
  in no error or log line.
- **The import:** half stars round as stated, a 0 is skipped, an unknown header,
  a file over its limits, and a file that isn't UTF-8 are rejected, a byte order
  mark is accepted, importing twice gives the same ratings, a song's own rating
  survives an import, and the preview counts what applying changes.

## Left for later

- **ListenBrainz similarity,** keyless and keyed by MusicBrainz ids, once its
  similar-recordings data leaves Labs, which documents no stability or limits.
- **Correcting a wrong MusicBrainz match** (*Not this recording*, or pasting an
  id), which matters more once other sources hang off the match.
- **A *community rating* rule field,** if the household wants one.
- **Last.fm summaries,** whose license isn't stated, where Wikipedia has no
  article.
- **Song ratings from RYM,** if its export ever includes them.
