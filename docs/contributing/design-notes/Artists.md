# Artists

> [!NOTE]
> **Status: built.** This note describes one artist under many names: looking the
> Library's artist names up on MusicBrainz, linking each to one artist, asking an
> AI model which artist each name stands for, adding the names, page, and photo
> Wikidata knows each linked artist by, counting linked names as one artist across
> the Library, and keeping what the household chooses for an artist, with an AI
> model's suggestions. Tidying a name written with more than the name in it is in
> [Track details](Track%20details.md).

## Contents

- [Why](#why)
- [Names and artists](#names-and-artists)
- [Looking a name up](#looking-a-name-up)
- [Linking a name](#linking-a-name)
- [Each song's artists by id](#each-songs-artists-by-id)
- [Names written as several artists](#names-written-as-several-artists)
- [A song's artists one by one](#a-songs-artists-one-by-one)
- [Asking an AI model](#asking-an-ai-model)
- [Wikidata's names](#wikidatas-names)
- [Wikidata's page and photo](#wikidatas-page-and-photo)
- [What the household chooses](#what-the-household-chooses)
- [What an AI model suggests for an artist](#what-an-ai-model-suggests-for-an-artist)
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

## Each song's artists by id

- **The Library's own artists:** each written name, folded, names one artist of
  the Library's, under an id of its own. Names linked to one MusicBrainz artist
  name one artist, which records that MusicBrainz id; no two artists record the
  same one.
- **Every song is bound** to the artist its artist names and the one its album
  artist names, each with the name as the song writes it. A blank name binds
  none. The song is bound again whenever the artist or album artist it shows
  changes, from any origin, and a split file's songs with it.
- **An id never changes.** Linking a name keeps its artist's id when the name is
  the artist's only one; it joins the artist already linked to that MusicBrainz
  artist when there is one; and it parts from its artist as one of its own when
  the artist has other names. Unlinking a name parts it the same way. Only the
  songs writing that name move.

  ```text
  披头士, 甲壳虫 both linked to The Beatles   one artist, both names' songs
  甲壳虫 relinked to a tribute band          甲壳虫's songs to an artist of its own
  ```

- **Ids show nowhere yet.** Favorites, the artist page, and the web client go by
  names; the ids are what two artists of one name will be told apart by.

## Names written as several artists

A song's artist is often written as several: a collaboration, or an artist featuring
others. Such a name is offered with the artists it lists, for the household to split,
so each song counts under each artist, or to keep as written.

```text
GUMI/MAYU                    GUMI, MAYU
周杰伦、费玉清                 周杰伦, 费玉清
スズム feat. GUMI, MAYU       スズム; featuring GUMI, MAYU
DECO*27 (feat. 初音ミク)       DECO*27; featuring 初音ミク
AC/DC, Simon & Garfunkel     not offered: each names one artist
Michael Jackson/迈克尔·杰克逊   not offered: a name and its translation
```

- **Offers are cautious,** as many a band's name holds `&` or `,`: those divide
  only the artists a song features. The main artists are divided by `、`, `，`, `;`,
  ` x `, or ` × `, and by a slash only between names in one script, kept whole by
  the rules a lookup keeps *AC/DC* whole by. An artist listed twice is one.
- **Not offered:** a name naming no one artist, such as *Various Artists*; a name
  to tidy first; a name decided. A name linked to one MusicBrainz artist is offered
  saying so, as a collaboration may be linked to one of its artists.
- **A decision is kept per name,** as written and folded, and binds every song
  showing it as its artist or album artist, now and later: each artist it lists,
  in order, with how the song credits it, *main* or *featured*; or, kept, the name
  as written. A decision is listed, and forgetting it offers the name again.
- **Tidying keeps a featured artist:** a bracket naming one, as in *DECO\*27
  (feat. 初音ミク)*, is a credit, not the name in another script.
- **Each artist counts on its own:** the names listed to link are each artist a
  song shows, so *GUMI* and *MAYU* are linked apart, and an AI model reads each
  one's songs. A Track lists the artists its artist names, as written.

## A song's artists one by one

A name's decision binds every song writing it. One song can also have its artists
chosen one by one in *Edit details*, each main or featured, and that choice wins
over its name's decision.

```text
GUMI                       + MAYU               GUMI & MAYU
スズム                      + GUMI, featured     スズム feat. GUMI
DECO*27, ピノキオピー        + 初音ミク, featured   DECO*27 & ピノキオピー feat. 初音ミク
```

- **Kept per song** (`track_credits`): the artists in order, each `{written, role}`,
  the main ones first. The song's household artist becomes them written as one name,
  as above, so search, sort, and the Track's `artist` keep working.
- **Bound as chosen** while the song's artist is that name. Any other change to its
  artist, a bulk edit, tidying, choosing another origin's value, or dropping the
  household's, forgets the choice, and the song is bound by its name again.
- **Nothing is kept for no change:** the artists the song shows already, or one main
  artist, which is just the artist as written.
- **Refused:** no main artist, an artist named twice or blank, more than ten, the
  artists of several songs at once, and a file split into songs, which takes its
  artists from its songs.
- **Clean up leaves it alone:** such a song's artist is neither offered to split nor
  to tidy, though other songs writing the same name are.

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
- **Shown** on the artist's page, on its tile among the Artists and in search, and
  beside it among the search's suggestions, the household's photo in place of
  Wikidata's; an artist with no photo, or a name linked to none, shows its initial.
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
  by that name too. Empty, the songs' name shows again. Its page still opens, and
  its favorite is still kept, by the name most of its songs write, so a name shown
  never takes the songs of another artist who goes by it.
- **A note about it,** up to 1,000 characters, shown on its page.
- **A photo of the household's,** in place of Wikidata's, kept as a cover is: a
  JPEG, PNG, or WebP image of at most 10 MiB, named by its bytes, and kept by the
  sweep. Removing it shows Wikidata's again. *Edit artist* also offers the
  pictures an AI model names, as
  [Track details](Track%20details.md#pictures-an-ai-model-names) says; one approved
  is downloaded and becomes the household's photo.
- **Only for an artist a site named,** as a linked name's is; any signed-in
  Account may choose, as any may edit a Track's details.

## What an AI model suggests for an artist

An AI model may be asked, for one linked artist, which name to show it by and who
it is. What it answers is only offered beside each field; the household uses it or
not.

- **Offered the names it goes by,** up to 12, each a number so the model never
  copies one: the names its songs write, most songs first, then MusicBrainz's, then
  each locale's primary name, then the rest; with up to eight of its songs and what
  tells the artist apart. Each is written on one line.

  ```text
  artist: 陶喆 (Taiwanese singer-songwriter, TW)
  names:
  1. 陶喆/David Tao
  2. 陶喆
  3. David Tao
  songs: 爱很简单 — I'm OK; 普通朋友 — I'm OK
  ```

  ```json
  {"shown_as": 2, "why": "the songs are Chinese", "about": "台湾 R&B 创作歌手"}
  ```

- **It answers** the number of the name the household would most likely know the
  artist by, judging by the language of the songs' titles, or none, and why; and
  one or two sentences on who the artist is, in the songs' language, or English
  when they mix, empty when it is not sure. The note is kept as one paragraph of
  at most 400 characters, without control or direction characters.
- **A Job,** of the kind `describe_artist`, through the plugin point
  `ArtistDescriber`, which the `ai-details` plugin answers, in the AI's lane, as
  asking which artist a name names does. A name not offered is no suggestion;
  an answer with neither a name nor a note fails the Job as *invalid*, and a
  refusal by every provider as *refused*.
- **Kept per artist,** with the names offered and the model and host that
  answered, replacing what it suggested before. Asking needs the network, so it
  waits while medleyplay is Offline. A suggested name stands while the
  artist goes by it; once it no longer does, as when its name is unlinked, only
  the note is offered.
- **Asked once at a time:** asking while a model is asked about the artist is
  refused. Why the last asking failed shows to the Account that asked, and to
  admins.

## The web client

- **A section of Clean up,** *Split artist names*: each name written as several
  artists, with its songs and the artists it lists as capsules, the featured ones
  marked *feat.*, to *Keep* or *Split*; *Split all* splits every name not linked
  to one artist, and a linked one says it may name one artist. The names decided
  are listed folded away, each to *Undo*.
- **A song by several artists counts under each:** in Artists, search, Insights,
  and Radio's favorites, and opens from each artist's page or the name as written.
  Now Playing names each artist with its own page and heart, and a song's menu goes
  to each. Using a likely name for one of them changes only that one.
- **Edit details, one chip per artist:** *Add artist* beside the song's Artist turns
  its artist into a chip and adds the next one typed, Enter adding it (not while a
  word is being composed, as in Chinese or Japanese). Each chip shows the artist's
  photo, or its initial, says whether it is linked, and has *+ feat.* to credit it
  as featured and a way to remove it; featured chips are dashed. Removing down to
  one main artist puts it back in the box, and removing the last main one makes the
  first left main. Another origin's artist, used, replaces the chips. A song's
  chips are saved only when they differ from the artists it shows; a file split
  into songs offers none.
- **A section of Clean up,** *Link artist names*, with how many names that may
  be looked up are not linked, counted in the rail's *Clean up* with the names to
  tidy: each name with its songs, most songs first.
- **A name's songs on hover:** hovering a name or its song count, or focusing the
  count, shows up to eight of its songs, as artist or album artist, with their
  albums, and how many more. Pressing the count opens them, to correct: one song
  in the Library, scrolled to and lit, and more on the name's page.
- **A likely name for one MusicBrainz doesn't know:** a name that starts with
  another the Library has, as *告五人2019超强音质的* starts with *告五人*, says
  *likely 告五人* and offers *Use 告五人*, which shows its songs by that name, as
  artist and as album artist, through the household's details; a split file
  that writes the name takes it too, and its songs follow. The longest such
  name wins, compared folded; what follows it must be a digit, a space, or a
  mark, unless the name is in a script written without spaces, such as Chinese,
  so *Jay* is never offered for *Jayson*. Such a name lists first, as one ready
  to act on.
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
- **An artist's page says who it is:** under its heading, the household's photo of
  it, or its photo from Wikidata, credited *Photo: Wikimedia Commons*, or else a
  round mosaic of up to four of its albums' covers, or its initial; who
  MusicBrainz says it is, as *周杰倫 (TW)*; the household's note about it; six of the
  other names it goes by, and the rest on request; and links that open its
  MusicBrainz page, its Wikidata item (until Wikidata has answered, Wikidata's own
  search for the MusicBrainz id), and a Rate Your Music search for its name, each
  in a new tab. The links ask nothing of those sites; the household opens them. A
  name not linked yet offers *Link it to an artist*, which opens Clean up.
- **Edit details** on a linked artist's page opens *Edit artist*: its photo, with
  where it is from (*From Wikidata* or *Yours*), to replace in the picture editor
  ([Track details](Track%20details.md#replacing-a-cover-or-a-photo)), uploading one
  or asking an AI model, or, when it is the household's, remove at once; *Shown as*, offering every name it goes by, with
  the songs' own name as its placeholder; and *About*. *Save* keeps the name and
  the note together; until then *Cancel* forgets them. *Ask AI* above the fields
  asks a model for a name and a note, reads *Asking the AI…* with one spinner
  while it is, or *Asking the AI once medleyplay is Online* while it waits, and
  reads its answer every 2 seconds until it comes; each
  suggestion shows beneath its field as *deepseek-flash suggests “甲壳虫乐队”*, its
  reason and model in the tooltip, with *Use*, until the field says the same. Why
  an asking failed shows beside *Ask AI*.
- **Linked names are one artist** in the Artists view, named as the household
  chose or as most of its songs write it; on its page, headed by the same name,
  which lists every song of every name linked to it; in search, which finds it by
  any name it goes by, *甲壳虫* finding *The Beatles*; and in favorites and Radio,
  where a favorite name makes every name linked with it a favorite. Each song
  keeps its artist as written.

## What the API shows

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/artist-splits` | Signed in | Every name written as several artists and not decided, most songs first, with the artists it lists and whether it is linked; and every name decided |
| `POST /api/artist-splits/split` | Signed in | Split up to 500 names into the artists each lists; 422 for a name naming one |
| `POST /api/artist-splits/keep` | Signed in | Keep up to 500 names as written |
| `POST /api/artist-splits/forget` | Signed in | Forget what was decided for up to 500 names, so each is offered again |
| `GET /api/artist-names` | Signed in | Every name, most Tracks first: its Tracks, whether it may be looked up, its link, what MusicBrainz answered and when, the suggestion, and whether it is being asked now; and every artist those name, with its aliases, and its Wikidata page and photo once Wikidata has answered |
| `POST /api/artist-names/look-up` | Signed in | Ask about up to 500 names at once; each not linked, and that may be looked up, gets a Job. Answers how many were asked about, or 409 while the `musicbrainz` plugin is off |
| `PUT /api/artist-names/link` | Signed in | Link a name to an artist MusicBrainz named, or to none, and ask Wikidata the artist's names; 404 for an artist never named |
| `POST /api/artist-names/recommend` | Signed in | Ask an AI model about up to 500 names looked up and not linked; answers how many were asked about, or 409 while the `ai-details` plugin is off, no AI provider is set up, or a model is asked already |
| `POST /api/artist-names/unlink` | Signed in | Forget a name's link |
| `PUT /api/artists/{id}/details` | Signed in | Keep the name an artist is shown by and a note about it; an empty one is forgotten; 404 for an artist no site named |
| `PUT /api/artists/{id}/photo` | Signed in | Make the image in the body the household's photo of the artist; 413 past 10 MiB, 422 for no JPEG, PNG, or WebP image |
| `DELETE /api/artists/{id}/photo` | Signed in | Drop the household's photo, so Wikidata's shows again |
| `POST /api/artists/{id}/photo/cover` | Signed in | Make a cover already kept the household's photo of the artist; 404 for no such cover |
| `POST /api/artists/{id}/suggestion` | Signed in | Ask an AI model which name to show an artist by, and who it is; 202, or 404 for an artist no site named, or 409 while the `ai-details` plugin is off, no AI provider is set up, or a model is asked about it already |
| `GET /api/artists/{id}/suggestion` | Signed in | Whether a model is asked about the artist and whether that waits for medleyplay to be Online, what it last suggested, with the model that answered, and why the last asking failed, to the Account that asked and to admins |

## Testing

- **The rules** (which names are looked up, the suggestion) are domain tests.
- **The plugins** are tested with no socket opened: `musicbrainz` against a
  hand-made artist search in MusicBrainz's shape, `wikipedia` against
  Wikidata's real answers for The Beatles' names and a hand-made image statement
  in Wikidata's shape, and the artist chooser and describer of `ai-details`
  against a fake chat client.
- **The service** runs real Jobs against the test plugin `reader`, whose finder
  answers *披头士* with The Beatles and a tribute band, and whose name finder
  answers for The Beatles as Wikidata would, whose chooser recommends The
  Beatles unless a song is a tribute, and whose describer suggests the first
  Chinese name after the songs' own.
- **Shared lanes** are tested with two lanes sharing one name.
- **Artist ids** are tested through adding, editing, splitting, linking, and
  unlinking songs, and the migration that binds every song already in the
  Library.

## Left for later

- **Two artists of one name,** such as two singers called *Jay*: a name names
  one artist, so telling them apart song by song needs a name to name several,
  each song bound to one of them.
- **An album artist chosen one by one,** as a song's artists are; it follows its
  name's decision.
- **Showing every linked artist in a chosen language** at once, rather than as
  written or by the name chosen for each.
