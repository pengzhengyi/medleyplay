# Artists

> [!NOTE]
> **Status: built.** This note describes one artist under many names: looking the
> Library's artist names up on MusicBrainz, linking each to one artist, asking an
> AI model which artist each name stands for, adding the names Wikidata knows each
> linked artist by, and counting linked names as one artist across the Library. Tidying a name written with
> more than the name in it is in [Track details](Track%20details.md).

## Contents

- [Why](#why)
- [Names and artists](#names-and-artists)
- [Looking a name up](#looking-a-name-up)
- [Linking a name](#linking-a-name)
- [Asking an AI model](#asking-an-ai-model)
- [Wikidata's names](#wikidatas-names)
- [The web client](#the-web-client)
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

- **A search a name, and one a part:** MusicBrainz's artist search, by name or
  alias (`artist:"披头士" OR alias:"披头士"`), answers with up to ten artists, best
  first, each with a score and its aliases. A name written as several is searched
  whole and by each part, up to four searches: divided by slashes, unless a part
  is one character or every part is Latin and one is shorter than three (*AC/DC*
  stays whole), and where a Latin name meets a Chinese or Japanese one with no
  space. An artist found by several searches is kept once, with its best score.

  ```text
  Michael Jackson/迈克尔·杰克逊   whole, Michael Jackson, 迈克尔·杰克逊
  Adele阿黛尔                    whole, Adele, 阿黛尔
  初音ミク/米津玄師               whole, 初音ミク, 米津玄師
  ```

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
  sort name, or an alias, that MusicBrainz scored 90 or more; or, when none goes
  by the whole name, the one going by any of its parts. Two such artists, as for a
  collaboration such as *初音ミク/米津玄師*, or a looser match, suggest none.
- **Only an artist MusicBrainz named** for a name here can be linked.
- **Any signed-in Account** may look names up and link them, as any may edit a
  Track's details: the catalog is the household's.

## Asking an AI model

MusicBrainz offers up to ten artists for a name, and the one going by it exactly is
suggested; often none does, or several do, as for *GUMI/MAYU*, where only the songs
tell a Vocaloid voice from a belly dancer. An AI model reads the songs too.

- **Asked for every name looked up and not linked** that MusicBrainz offered an
  artist: the name, up to eight of its songs as `title — album`, and the artists
  offered, each a letter with what tells it apart and its country, so the model
  never copies an id. It answers a letter or none for each name, and why.

  ```text
  1. GUMI/MAYU
     songs: ケビョウニンゲン — ケビョウニンゲン
     a. GUMI (Vocaloid/SynthV, JP)
     b. MAYU (Belly dancer, Art of Mayu, JP)
  ```

  ```json
  {"choices": [{"name": 1, "artist": "a", "why": "GUMI is a Vocaloid voice"}]}
  ```

- **A Job a batch of up to 50 names,** of the kind `choose_artists`, through the
  plugin point `ArtistChooser`, which the `ai-details` plugin answers. It runs in
  the AI's lane and asks the providers in the order Settings lists them, as asking
  for a Track's details does; the providers' failover is shared by the two.
- **Only a recommendation:** what the model answers is kept for the name, with
  the model and host that answered and when, replacing what it answered before.
  Nothing is linked until someone links it. A choice of a name or a letter not
  offered is left out, as is one naming an artist no longer known.
- **A refusal by every provider** fails the Job as *refused*; an answer with no
  choice in it fails it as *invalid*.

## Wikidata's names

MusicBrainz often lacks the names a Chinese Library writes: it knows *披头士*
for The Beatles, but not *甲壳虫* or *甲壳虫乐队*. Wikidata often has them, and
nicknames such as *周董*, and Japanese and Korean names.

- **Asked once a name is linked:** linking a name to an artist asks Wikidata
  every name the artist goes by, a Job of the kind `find_artist_names` per artist,
  through the plugin point `ArtistNameFinder`, which the plugin `wikipedia`
  answers. The plugin is on by default, unlike the plugins that read MusicBrainz
  or Bilibili: Wikidata is an open API that needs no account, and the plugin asks
  only about linked artists. `[plugins.wikipedia] enabled = false` in
  `medleyplay.toml` turns it off. An artist only offered, not linked, is
  not asked about, since a name may offer up to ten.
- **Found by its MusicBrainz id:** Wikidata's search for the item holding the
  id (`haswbstatement:P434=<id>`), then the item's labels and aliases in Chinese,
  Cantonese, Japanese, Korean, and English: two requests, a second apart, in the
  plugin's own lane, so Wikidata refusing leaves MusicBrainz running. Each name
  keeps its language, written as MusicBrainz writes a locale (`zh_Hant`, `zh_TW`).
  A name ending in a note in brackets, such as *朴树 (歌手)*, is a Wikipedia page
  title, not a name, and is left out.

  ```text
  The Beatles (b10bbbfc-…) → Q1299 → 甲壳虫乐队, 甲壳虫, 披頭四樂隊, ビートルズ, 비틀즈, …
  ```

- **Kept apart from MusicBrainz's names:** each alias records the site that gave
  it, and each site's answer replaces only its own, so looking a name up on
  MusicBrainz again keeps Wikidata's. A name both give is shown once, as
  MusicBrainz gives it.
- **Asked about an artist once:** an answer, none included, is kept with when;
  a refusal fails the Job as *refused* and leaves the artist to ask again.
  *Look up* asks about every linked artist Wikidata hasn't answered for, such as
  one linked while the plugin was off.
- **A name an artist already linked goes by is offered it,** with nothing asked
  of any site: once *披头士* is linked to The Beatles, *甲壳虫乐队* is offered The
  Beatles, scored 100, chosen already when no other artist goes by it too; it can
  still be looked up. A name naming no one artist is offered none.

## The web client

- **A section of Clean up,** *Link artist names*, with how many names that may
  be looked up are not linked, counted in the rail's *Clean up* with the names to
  tidy: each name with its songs, most songs first.
- **Each name says where it stands:** *Look up* for one not looked up yet, with
  *Look up 17 names* above the list for all of them; *Looking it up on
  MusicBrainz…* while it is; *Tidy the name first* for a name that needs it; up to
  three artists found, each with what tells it apart and its country, the
  suggested one chosen already, to *Link* or answer *None of these*; and, once
  linked, what it is linked to, with *Unlink*, and *Finding its other names on
  Wikidata…* while Wikidata is asked. The list reads the names again every 2
  seconds while any is being looked up, any artist's names asked for, or an AI
  model asked.
- **Ask AI** asks an AI model about every name that may be linked, and reads
  *Asking the AI…* while it is. A name's recommended artist is the one the model
  recommends, tagged *llama3.2 suggests* with its reason in the tooltip, else the
  one going by the name exactly; its choice and *Link* are marked. When the model
  recommends none of those offered, *None of these* is marked instead, with the
  reason beneath. *Link N recommended* links every name whose recommendation is an
  artist, never one the model recommends none for.
- **Linked names are one artist** in the Artists view, named as most of its songs
  write it; on its page, which lists every song of every name linked to it; in
  search, which finds it by any name it goes by, *甲壳虫* finding *The Beatles*;
  and in favorites and Radio, where a favorite name makes every name linked with
  it a favorite. Each song keeps its artist as written.

## What the API shows

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/artist-names` | Signed in | Every name, most Tracks first: its Tracks, whether it may be looked up, its link, what MusicBrainz answered and when, the suggestion, and whether it is being asked now; and every artist those name, with its aliases |
| `POST /api/artist-names/look-up` | Signed in | Ask about up to 500 names at once; each not linked, and that may be looked up, gets a Job. Answers how many were asked about, or 409 while the `musicbrainz` plugin is off |
| `PUT /api/artist-names/link` | Signed in | Link a name to an artist MusicBrainz named, or to none, and ask Wikidata the artist's names; 404 for an artist never named |
| `POST /api/artist-names/recommend` | Signed in | Ask an AI model about every name looked up and not linked; answers how many were asked about, or 409 while the `ai-details` plugin is off or no AI provider is set up |
| `POST /api/artist-names/unlink` | Signed in | Forget a name's link |

## Testing

- **The rules** (which names are looked up, the suggestion) are domain tests.
- **The plugins** are tested with no socket opened: `musicbrainz` against a
  hand-made artist search in MusicBrainz's shape, `wikipedia` against
  Wikidata's real answers for The Beatles, and the artist chooser of `ai-details`
  against a fake chat client.
- **The service** runs real Jobs against the test plugin `reader`, whose finder
  answers *披头士* with The Beatles and a tribute band, and whose name finder
  answers for The Beatles as Wikidata would, and whose chooser recommends The
  Beatles unless a song is a tribute.
- **Shared lanes** are tested with two lanes sharing one name.

## Left for later

- **Two artists of one name,** such as two singers called *Jay*: a link is one
  per name, so telling them apart song by song would need a link per Track.
- **Showing a linked artist in a chosen language,** rather than as written.
