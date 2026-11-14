# Artists

> [!NOTE]
> **Status: in progress.** Looking the Library's artist names up on MusicBrainz,
> keeping what it knows, and linking each name to one artist are built in the
> core and the API; the web client's list of names, and counting linked names as
> one artist in the Artists view, an artist's page, favorites, and search, follow.
> This note describes one artist under many names. Tidying a name written with
> more than the name in it is in [Track details](Track%20details.md).

## Contents

- [Why](#why)
- [Names and artists](#names-and-artists)
- [Looking a name up](#looking-a-name-up)
- [Linking a name](#linking-a-name)
- [What the API shows](#what-the-api-shows)
- [Testing](#testing)
- [Left for later](#left-for-later)

## Why

A song's artist is the text its file or video gives, so one artist goes by many
names: *The Beatles*, *披头士*, and *甲壳虫* are three artists to the Library,
each with its own page and its own favorite. Rewriting the text would lose what
the file says, and be wrong whenever a match is; linking the names to one artist
keeps the text and counts them as one.

## Names and artists

- **A name** is an artist or album artist text Tracks show, kept by its folded
  form, so names alike but for case or width are one. The Library lists each once,
  with how many Tracks show it, written as most of them write it.
- **An artist** is one MusicBrainz knows: its id there, its name and sort name,
  what tells it apart (*Liverpool rock band*), its country, and every name it goes
  by, each with the language it is written for.

  ```text
  披头士    → The Beatles (b10bbbfc-…), going by Beatles, 披头士 (zh), 披頭四 (zh_Hant)
  甲壳虫    → The Beatles
  ```

- **Some names are never looked up:** names that stand for no one artist, such as
  *Various Artists*, *群星*, *Unknown*, and *佚名*, and names with more than the
  name in them, which are tidied first, so the name is looked up and not the note.
- **Songs keep the name as written.** A link is kept apart from the Tracks, so
  unlinking a name puts everything back as it was.

## Looking a name up

- **One request a name:** MusicBrainz's artist search, by name or alias
  (`artist:"披头士" OR alias:"披头士"`), answers with up to ten artists, best first,
  each with a score and its aliases.
- **A Job a name,** of the kind `find_artist`, through the plugin point
  `ArtistFinder`, which the `musicbrainz` plugin answers. Its lane is shared with
  the MusicBrainz enricher's, so the two kinds together keep to one request a
  second. The Job waits while Offline, as any that needs the network does.
- **What it answers is kept:** each artist and its aliases, replacing what was
  known of it, and for the name, the artists' ids and scores in order, with when;
  no artist is an answer too. A name is asked about again only when someone asks.
- **A refusal** fails the Job as *refused*.

## Linking a name

- **The household links each name** to one of the artists MusicBrainz named, or
  to none, saying it is no artist MusicBrainz knows. A linked name isn't looked up
  again, and an unlinked one is offered again.
- **One is suggested:** the one artist going by the name exactly, as its name,
  sort name, or an alias, that MusicBrainz scored 90 or more. Two such artists,
  or a looser match, suggest none.
- **Only an artist MusicBrainz named** for a name here can be linked.
- **Any signed-in Account** may look names up and link them, as any may edit a
  Track's details: the catalog is the household's.

## What the API shows

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/artist-names` | Signed in | Every name, most Tracks first: its Tracks, whether it may be looked up, its link, what MusicBrainz answered and when, the suggestion, and whether it is being asked now; and every artist those name, with its aliases |
| `POST /api/artist-names/look-up` | Signed in | Ask about up to 500 names at once; each not linked, and that may be looked up, gets a Job. Answers how many were asked about, or 409 while the `musicbrainz` plugin is off |
| `PUT /api/artist-names/link` | Signed in | Link a name to an artist MusicBrainz named, or to none; 404 for an artist never named |
| `POST /api/artist-names/unlink` | Signed in | Forget a name's link |

## Testing

- **The rules** (which names are looked up, the suggestion) are domain tests.
- **The plugin** is tested against a hand-made artist search in MusicBrainz's
  shape, with no socket opened.
- **The service** runs real Jobs against the test plugin `reader`, whose finder
  answers *披头士* with The Beatles and a tribute band.
- **Shared lanes** are tested with two lanes sharing one name.

## Left for later

- **The web client:** the list of names with their suggestions, and counting
  linked names as one artist wherever the Library groups by artist.
- **Wikidata's names,** through the MusicBrainz artist's Wikidata link, for
  Chinese names MusicBrainz lacks.
- **Two artists of one name,** such as two singers called *Jay*: a link is one
  per name, so telling them apart song by song would need a link per Track.
- **Showing a linked artist in a chosen language,** rather than as written.
