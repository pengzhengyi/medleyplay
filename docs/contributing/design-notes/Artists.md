# Artists

> [!NOTE]
> **Status: built.** This note describes one artist under many names: looking the
> Library's artist names up on MusicBrainz, linking each to one artist, asking an
> AI model which artist each name stands for, adding the names, page, and photo
> Wikidata knows each linked artist by, and counting linked names as one artist
> across the Library. Tidying a name written with more than the name in it is in
> [Track details](Track%20details.md).

## Contents

- [Why](#why)
- [Names and artists](#names-and-artists)
- [Looking a name up](#looking-a-name-up)
- [Linking a name](#linking-a-name)
- [Asking an AI model](#asking-an-ai-model)
- [Wikidata's names](#wikidatas-names)
- [Wikidata's page and photo](#wikidatas-page-and-photo)
- [What the household chooses](#what-the-household-chooses)
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

- **Asked for every name looked up and not linked** that is offered an artist, up
  to 500: the name, up to eight of its songs as `title — album`, as artist or album
  artist, and the artists offered, each a letter with what tells it apart and its
  country, so the model never copies an id. Each is written on one line, so a line
  break in a title can't add a name or an artist. It answers a letter or none for
  each name, and why.

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
  the model and host that answered and when, and the artists it was offered,
  replacing what it answered before. Nothing is linked until someone links it. A
  choice of a name or a letter not offered is left out, as is one naming an artist
  no longer known.
- **It stands while the artists offered do:** once a name is offered other
  artists, as when it is looked up again, the recommendation is no longer shown,
  since the model never weighed them.
- **Asked once at a time:** asking while a model is asked already is refused,
  rather than leaving out the names that came since.
- **A refusal by every provider** fails the Job as *refused*; an answer with no
  usable choice in it fails it as *invalid*.

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

## Wikidata's page and photo

- **Asked with the names,** in the same Job: the item's page
  (`https://www.wikidata.org/wiki/Q1299`) and its image (`P18`), a preferred one
  first and never a deprecated one, fetched from Wikimedia Commons 500 pixels wide
  (`Special:FilePath/<file>?width=500`), a width Commons keeps ready. That is two
  more requests, each a second after the one before.
- **Only from Commons:** each redirect is followed only to a Wikimedia site
  over HTTPS, a file name holding a slash is never asked for, and an image larger
  than 2 MiB is no photo.
- **Kept as a cover:** the plugin writes the image into a folder of the Job's,
  and the core keeps it as it keeps an enricher's cover: named by its bytes, and
  only a JPEG, PNG, or WebP image. The sweep that removes covers no Track names
  keeps every artist's photo.
- **Credited:** with the photo comes its page on Commons, which says who took it
  and under what license; the artist's page links to it.
- **A photo Commons doesn't have,** or one that is no such image, is none, and
  the names are kept all the same. Commons refusing, or not answering, fails the
  Job as Wikidata doing so does, so the artist is asked again and keeps the photo
  it had. Each answer replaces the page and photo the one before gave.
- **Only pages over HTTPS** are taken from the plugin, and the web client links
  to no other.
- **Asked again for artists linked before photos were kept:** the migration that
  added them forgets when Wikidata answered, so *Look up* asks it again.

## What the household chooses

An artist's songs keep their names as written; what the household chooses is kept
on the artist, apart from what the sites said.

- **The name it is shown by,** up to 512 characters, in place of the name most of
  its songs write: in the Artists view, on its page, and in search, which finds it
  by that name too. Empty, the songs' name shows again.
- **A note about it,** up to 1,000 characters, shown on its page.
- **A photo of the household's,** in place of Wikidata's, kept as a cover is: a
  JPEG, PNG, or WebP image of at most 10 MiB, named by its bytes, and kept by the
  sweep. Removing it shows Wikidata's again.
- **Only for an artist a site named,** as a linked name's is; any signed-in
  Account may choose, as any may edit a Track's details.

## The web client

- **A section of Clean up,** *Link artist names*, with how many names that may
  be looked up are not linked, counted in the rail's *Clean up* with the names to
  tidy: each name with its songs, most songs first.
- **A name's songs on hover:** hovering a name or its song count, or focusing the
  count, shows up to eight of its songs, as artist or album artist, with their
  albums, and how many more.
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
- **An artist's page says who it is:** under its heading, its photo from
  Wikidata, credited *Photo: Wikimedia Commons*, or else a round mosaic of up to
  four of its albums' covers, or its initial; who MusicBrainz says it is, as
  *周杰倫 (TW)*; six of the other names it goes by, and the rest on request; and
  links that open its MusicBrainz page, its Wikidata item (until Wikidata has
  answered, Wikidata's own search for the MusicBrainz id), and a Rate Your Music
  search for its name, each in a new tab. The links ask nothing of those sites;
  the household opens them. A name not linked yet offers *Link it to an artist*,
  which opens Clean up.
- **Edit details** on a linked artist's page opens *Edit artist*: its photo, with
  where it is from (*From Wikidata* or *Yours*), to replace or, when it is the
  household's, remove at once; *Shown as*, offering every name it goes by, with
  the songs' own name as its placeholder; and *About*. *Save* keeps the name and
  the note together.
- **Linked names are one artist** in the Artists view, named as most of its songs
  write it; on its page, which lists every song of every name linked to it; in
  search, which finds it by any name it goes by, *甲壳虫* finding *The Beatles*;
  and in favorites and Radio, where a favorite name makes every name linked with
  it a favorite. Each song keeps its artist as written.

## What the API shows

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/artist-names` | Signed in | Every name, most Tracks first: its Tracks, whether it may be looked up, its link, what MusicBrainz answered and when, the suggestion, and whether it is being asked now; and every artist those name, with its aliases, and its Wikidata page and photo once Wikidata has answered |
| `POST /api/artist-names/look-up` | Signed in | Ask about up to 500 names at once; each not linked, and that may be looked up, gets a Job. Answers how many were asked about, or 409 while the `musicbrainz` plugin is off |
| `PUT /api/artist-names/link` | Signed in | Link a name to an artist MusicBrainz named, or to none, and ask Wikidata the artist's names; 404 for an artist never named |
| `POST /api/artist-names/recommend` | Signed in | Ask an AI model about up to 500 names looked up and not linked; answers how many were asked about, or 409 while the `ai-details` plugin is off, no AI provider is set up, or a model is asked already |
| `POST /api/artist-names/unlink` | Signed in | Forget a name's link |
| `PUT /api/artists/{id}/details` | Signed in | Keep the name an artist is shown by and a note about it; an empty one is forgotten; 404 for an artist no site named |
| `PUT /api/artists/{id}/photo` | Signed in | Make the image in the body the household's photo of the artist; 413 past 10 MiB, 422 for no JPEG, PNG, or WebP image |
| `DELETE /api/artists/{id}/photo` | Signed in | Drop the household's photo, so Wikidata's shows again |

## Testing

- **The rules** (which names are looked up, the suggestion) are domain tests.
- **The plugins** are tested with no socket opened: `musicbrainz` against a
  hand-made artist search in MusicBrainz's shape, `wikipedia` against
  Wikidata's real answers for The Beatles' names and a hand-made image statement
  in Wikidata's shape, and the artist chooser of `ai-details`
  against a fake chat client.
- **The service** runs real Jobs against the test plugin `reader`, whose finder
  answers *披头士* with The Beatles and a tribute band, and whose name finder
  answers for The Beatles as Wikidata would, and whose chooser recommends The
  Beatles unless a song is a tribute.
- **Shared lanes** are tested with two lanes sharing one name.

## Left for later

- **Two artists of one name,** such as two singers called *Jay*: a link is one
  per name, so telling them apart song by song would need a link per Track.
- **Showing every linked artist in a chosen language** at once, rather than as
  written or by the name chosen for each.
