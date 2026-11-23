# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Type `settings: rating` in the search box and choose *Your ratings* to open
  that Settings section. Type `settings:` to see every section you can visit.
- Open a saved song's lyrics directly from an album's Songs editor without saving
  the list. **Auto-Match lyrics** can ask the configured AI to choose among lyrics
  found for each saved song. It asks first and never replaces existing lyrics.
- **Resume a Bilibili video lookup** — close the add dialog, refresh, or restart
  the server without losing the result. In *Downloaded*, select *Choose parts*
  to finish or *Dismiss* to discard it. Nothing is added until you confirm.
- Click the large cover in Now Playing to open that album's cover editor.
- Choose English or Simplified Chinese on the sign-in screen or in
  Settings → Appearance. The first translated screens include sign-in, device
  approval, navigation and playback controls. Other screens still use English.
- Find an album cover on Google Images and preview and use your saved image in
  **External Search**. With a household key, select **Tavily** below MusicBrainz
  to search and see pictures with their source pages.

- **Lyrics that nearly match, suggested** — a song no site has lyrics for now shows
  those of the nearest song LRCLIB has, of the same title and nearly as long, tagged
  *Found on the web* in Now Playing's big picture, with *Save* to keep them as yours and
  *Dismiss*. It is on by default; Settings → Lyrics turns it off.
- **Ask the AI with a note** — beside each *Ask AI* button (a song's details, and the
  songs of a file), ▾ or a right-click opens the note to ask with: the household's notes
  for that ask to tick, such as *One song per track of the album's standard edition.*,
  and more details typed, which this browser remembers. An admin adds, rewords, and
  removes the notes in Settings → AI.
- **Ask the AI about a song with no video text** — from its details, someone may now ask
  the AI about any song or album, by the title, artist, album, and length it shows and
  what the model knows; only songs with a video's text are asked about on their own.

- **Previous album and Next album shortcuts** — Alt + Shift + ← and Alt + Shift + →
  step past the album playing, like the player's outer buttons; change them in
  Settings like any shortcut.

- **Keep a Playlist downloaded** — a *Keep downloaded* switch on each Playlist's page,
  Favorites too, downloads every song it holds and never removes them to make room. In
  Settings → Storage the space they need now reads *Playlists kept downloaded*, its
  tooltip saying it counts an estimate for the songs not downloaded yet.
- **Where the Downloads are kept** — the Downloads view and Settings → Storage show the
  folder's path, with a button to copy it. An admin on the Mac medleyplay runs on also
  gets *Show in Finder*.
- **Find album covers in Clean up** — each album without a cover that MusicBrainz
  has one for shows it with *Use*, *Dismiss*, and *Change*, and *Use all* uses every
  one at once. Settings → MusicBrainz chooses which albums are looked up on their
  own: those of the songs up next (the default), every album without a cover, one at
  a time while MusicBrainz is otherwise idle, or none; and whether an AI model picks
  a cover where none plainly fits (off by default).
- **A suggested cover for an album without one** — opening the album's page looks
  it up on MusicBrainz, and the cover found whose title and artist are the album's,
  or the one an AI model picked, stands in the empty cover with *Use*, *Dismiss*,
  and *Change*. An album whose artist is linked to MusicBrainz is now looked up by
  that artist, so *Jay周杰伦* or *陶喆/David Tao* finds its covers.
- **Expand all and Collapse all** — one button beside *Group by* opens or folds
  every group, or every split file's songs, and this browser keeps the choice as
  how folds start. *Play all* in a grouped view plays the folded groups' songs too.
- **Choose the order of the views in the rail** — drag a view to another place in
  the rail, or move it in Settings › Appearance, where *Reset order* goes back to
  the default; each browser keeps its own order. Radio now sits below Albums and
  above Playlists by default.

- **Find a song's lyrics by hand** — the lyrics editor's *Find* lists the songs
  LRCLIB, and NetEase once turned on, have of a title and artist you can change, each
  with its site, album, length, kind, and first lines; *Use* fills the editor with
  them to save. With an AI model set up, it asks which is the song, by the songs'
  titles, artists, albums and lengths, and tags its pick *AI pick*. New:
  `POST /api/tracks/{id}/lyrics/find`, `GET /api/tracks/{id}/lyrics/found`,
  `POST /api/tracks/{id}/lyrics/choose` (migrations 0057, 0058).

- **Names lead to their pages** — the player names the song's artists and its album
  under its title, each a link to its page, as Now Playing does; an album's page
  links the artist it is by.

- **The search box completes tags and sites** — a word being typed offers the tag
  or site it begins, as `bi` offers `bilibili:` and `ar` offers `artist:`; *Tab*
  takes the first.

- **An album's cover on its page** — under the heading, with *Save* and *Replace* on
  hover; *Replace* opens the picture editor (upload, MusicBrainz, or Ask AI) without
  going through *Edit details*.

- **A suggested photo is its own controls** — on an artist's page and in Clean up,
  its lower half uses it, its top half's right quarter dismisses it (never suggested
  again), and its left quarter opens the photo editor; the ring turns green or red to say which.
  An artist's photo opens the photo editor from the page itself. New:
  `POST /api/artists/{id}/pictures/dismiss` (migration 0056).

- **Find artist photos** in Clean up — a photo suggested from Deezer for each artist
  with none, used one by one or all at once. Settings → Deezer chooses which artists
  are looked up on their own: those of the songs up next (the default), every one,
  or only when asked. New: `GET /api/artist-photos/missing`,
  `POST /api/artist-photos/find`, and the setting `find_artist_photos`.

- **A suggested photo for an artist with none** — its page shows the picture on
  Deezer most likely of it, the AI's pick or the most followed going by its name,
  tagged as a suggestion, to use in one click. Settings → Deezer can have the AI
  pick as soon as pictures are found. New: `suggested` and `auto_pick` in
  `GET /api/artists/{id}/pictures`, and the setting `pick_pictures_by_ai`.

- **Pick by AI** in an artist's Deezer pictures — an AI model is asked which
  picture is of the artist, from each picture's artist name and following and what
  is known of the artist; *Refine* adds a note saying which artist you mean. The
  pick is marked and takes the focus. New: `POST /api/artists/{id}/pictures/choose`
  and the `pick` in `GET /api/artists/{id}/pictures` (migration 0055).

- **Artists sharing a name** — a section of Clean up lists each name MusicBrainz
  knows two or more artists by exactly, and each name already naming several, with
  its songs by album. Choose who each album is by, one of the name's artists or one
  MusicBrainz knows, and confirm; the songs are linked to it, and songs added later
  wait to be confirmed. A name may instead be kept as one. New:
  `GET /api/shared-names`, `PUT /api/shared-names/albums`, and
  `POST /api/shared-names/keep` and `/forget` (migration 0054).

- **Two artists of one name** — a name may name several artists, such as two
  singers called *Jay*. *Which Jay?* beside a song's Artist in *Edit details* binds
  the song to another artist going by the name, or to a new one; a song added to an
  album later goes where the album's songs went. Each is its own artist in the
  Artists view, told apart by its album, with its own page and favorite. New:
  `PUT /api/tracks/{id}/namesake`, `namesakes` on each of a song's artists, and
  `artist_ids` on each artist name (migration 0053).

- **Artist photos from Deezer** — *Edit artist* → *Replace* has a *Deezer* tab
  showing the pictures Deezer has of the artists going by the artist's name, the
  most followed first, to use one as its photo. Off until an admin turns on
  Settings → Deezer → *Find artist photos on Deezer*; only Deezer's public API is
  asked. New: the `deezer` plugin, the `picture_sites` setting, and
  `GET /api/artists/{id}/pictures`, `POST /api/artists/{id}/pictures/find`
  (migration 0052).

- **Artists by id** — each song names the ids of its artists (`artist_ids`), an
  artist's page opens by id (`#/artist?id=…`; links by name still open), and
  favorite artists are kept by id, following an artist whose name joins another.
  Changed: `PUT /api/artists/favorite` is now `PUT /api/favorites/artists/{id}`,
  and `GET /api/favorites` lists artists as `{id}` (migration 0051).

- **Lyrics from NetEase Cloud Music** — Settings → Lyrics → *Also look on NetEase
  Cloud Music* asks NetEase for the songs LRCLIB has no lyrics for, translations
  included, and looks those songs up again at once. Off by default; only NetEase's
  plain endpoints are used. New: the `lyrics_sites` setting.

- **Edit and sync a song's lyrics** — *Lyrics* in a song's *Edit details* edits them
  as LRC or plain text, or marks the song instrumental. *Sync to the song* plays it
  and stamps each line as Space is pressed; a line's time plays from there, and a
  line, or every line, moves a tenth of a second at a press. Saved lyrics are the
  household's and show over every other source's; *Remove yours* drops them. New:
  the lyrics API answers their `text`, as their source gave it.

- **Lyrics as a song plays** — Now Playing shows the song's lyrics beside its cover,
  the line sung now large and the others dim, translations under their lines; a line
  pressed plays from there. The player shows the line sung now under the artist. The
  *Lyrics* button beside Up next shows or hides them, remembered in this browser.

- **Lyrics from the files** — a scan reads the lyrics in a song's tags (ID3 USLT or
  SYLT, Vorbis LYRICS, MP4 ©lyr) and a `.lrc` beside it, named as it is, in UTF-8,
  UTF-16, or GBK. The `.lrc`'s show over the tags', and either over LRCLIB's, which
  is then never asked. Every file is read once more on the next scan.

- **Lyrics, looked up as songs come up** — a song's lyrics are looked up on LRCLIB
  (lrclib.net), an open lyrics database, as it plays and before it comes up next,
  timed line by line where LRCLIB times them; *Find lyrics* in a song's menu asks at
  once, and Settings → Lyrics chooses *Next to play* or *Manually*. A song inside a
  long file is asked about by its own title; the household's own lyrics come first.
  Nothing shows them yet. New: the `lyrics` plugin and enricher, `GET`, `PUT`, and
  `DELETE /api/tracks/{id}/lyrics` (migration 0050, `track_lyrics`).

- **A song's artists one by one** — *Add artist* in a song's *Edit details* turns its
  artist into chips, one per artist, each with its photo, *+ feat.* to credit it as
  featured, and a way to remove it. The song then counts under each artist, whatever
  the decision for the name it writes, until its artist is changed another way.
  `POST /api/tracks/details` takes `artists` for one song, and a Track's details list
  `artists` with their roles and links (migration 0049, `track_credits`).

- **Pictures an AI suggests for a cover or an artist's photo** — *Suggested by AI*,
  under *Find covers* and in *Edit artist*, shows the pictures a model names, each
  previewed from its own site; nothing is downloaded until *Approve*, which has the
  server fetch it from a public HTTPS site (at most 10 MiB, a JPEG, PNG, or WebP
  image) and use it as the album's cover or the artist's photo. New:
  `GET /api/image-links/album` and `/artist/{id}`, their `suggest` and `approve`,
  and `POST /api/artists/{id}/photo/cover`; the Jobs `suggest_images` and
  `fetch_image`; and `fetch_public_image` in the plugin API.

- **`bilibili:` in the search box** — typing it chooses Bilibili to search, as
  its toggle does, keeping what follows it; it is listed with the tags, and
  Backspace in the empty box goes back to the Library.

- **Dynamics behind Now Playing** — the cover's colors move behind Now Playing, as
  Apple Music's do: *Flow* (the cover flowing in slow folds), *Drift* (the cover
  turning), or *Mesh* (its colors as wandering lights), chosen per browser in
  Settings → Appearance, or *Off*. Drawn still with reduced motion, paused while
  the page is hidden, and loaded only when Now Playing opens. Adds `ogl`.

- **Split artist names in Clean up** — a new section lists each artist name
  written as several, such as *GUMI/MAYU* or *スズム feat. GUMI*, with the artists
  it lists (featured ones marked), to *Split* or *Keep*, or *Split all*; decided
  names can be undone. A split song counts under each of its artists in Artists,
  search, Insights, and Radio, and Now Playing and a song's menu link to each.

- **Names written as several artists** — the server offers each artist name
  written as several, such as *GUMI/MAYU* or *スズム feat. GUMI*, with the artists
  it lists, to split or keep as written; a split name's songs count under each
  artist, credited as main or featured, and each artist is linked on its own.
  Tidying keeps an artist featured in brackets. New: `GET /api/artist-splits`,
  `POST /api/artist-splits/split`, `/keep`, and `/forget`, and `artists` on each
  Track.

- **Find covers from Edit details** — *Edit details* shows *Find covers* under the
  cover, as *Edit album* does, rather than only as a tool over it. A whole album in
  one file that names no album is searched by its title; a song on no album shows
  the button unavailable, saying the album is needed.

- **Artist ids for every song** — each artist the Library's songs name now has an
  id of its own, and every song is bound to its artist and album artist by id.
  Names linked to one MusicBrainz artist share one id, and an artist keeps its id
  when it is linked or unlinked. Upgrading binds every song already in the
  Library. Nothing shows the ids yet: they are the ground for songs by several
  artists and for two artists of one name.

- **Split albums: Off, Ask first, or Auto** — a new setting in *Songs and
  albums* says what becomes of a long file a song list was found for. Clean up
  gains *Split albums*: each file with how long it is, who listed its songs, and
  any doubt, to *Split*, *Keep* as one file, *Edit songs…*, or *Ask AI* for a
  list; *Split all* splits every file with one. *Auto* splits a file whose list
  can be trusted (the video's and the AI's agreeing, or one raising no doubt),
  and asks the AI in the background, a few files at a time, about those with
  video text and no list. Unsplitting a file keeps it as one. New:
  `GET /api/split-offers`, `POST /api/split-offers/split` and `/keep`, and
  `split_albums` in the settings.

- **An album's cover from MusicBrainz** — *Find covers on MusicBrainz*, among a
  song's cover tools and beside the album's cover in *Edit album*, shows the front
  covers of the album's releases, with date, country, and format; with an AI set
  up, the release a model picks is marked *AI pick*. Choosing one sets it on the
  song, or on every song of the album. `GET /api/album-covers`, and
  `POST /api/album-covers/find` and `/choose`, run the Jobs `find_covers` and
  `choose_cover`; plugins answer the new `cover_finder` and `cover_chooser`.

- **Downloaded says how many songs download** — its rail item, tab, and menu
  entry carry a count while songs download, as Clean up's does; a song added
  from a site shows in Downloaded at once, while it downloads, and stays there
  if its download fails, with the way to retry it.

- **Settings links to the Downloaded view** — in *Downloads and storage*,
  *Downloads* (and *Downloading*, while songs download) opens the Downloaded
  view, and each label now sits on its value's line.

- **Artists show their photos** — an artist's tile among the Artists and in
  search, and its row among the search's suggestions, show its photo, the
  household's or Wikidata's, where it has one, and its initial where it has none.

- **Search suggests as you type** — under the box, the artists a search names,
  each to open, to show only its songs in the Library, or only the albums it
  sings on, and *Group the Library by artist*; in an empty box, resting the
  pointer or pressing ↓ lists the tags. `#/library?artist=…&group=…` and
  `#/albums?artist=…` open those views so.

- **Ask AI says how to set up a provider when none is** — beside each *Ask AI*,
  an admin gets a *Set up AI* link that opens Settings at its AI section, and a
  member *Ask an admin to set up AI*; `GET /api/features` tells whether one is
  set up as `ai_set_up`, and `#/settings?section=…` opens Settings at a section.

- **Downloaded shows the songs downloading** — above the songs downloaded, each
  song still downloading shows its cover, its state (*Waiting for Online*,
  *42%*), and a bar that moves as the event stream tells of its progress.

- **See why a download failed, and retry it** — the warning mark on a song
  whose download failed opens why, as the server says it, with *Retry download*
  and *Add the file…*; `GET /api/tracks/{id}/download` names the Job to retry as
  `job_id`.

- **Correct an artist name from Clean up** — in *Link artist names*, pressing a
  name's song count opens its songs; a name MusicBrainz doesn't know that starts
  with one the Library has, as *告五人2019超强音质的*, offers *Use 告五人* to show
  its songs by that name.

- **Search by field, and loosely** — type `artist:`, `album:`, `song:`,
  `kind:`, `rating:`, or `favorite:` and it becomes a tag in the box that the
  words after it fill; Backspace chooses a tag, and a second removes it. Plain
  words also find names with letters left out, so *jch* finds *Jay Chou*, after
  the names that hold them exactly.

- **Show a song in the Library, and rate it, from its menu** — a song's "…",
  in a row, the player, or the big picture, has *Show in Library*, which scrolls
  to the song and lights it, and *Rate*, a submenu of stars.

- **Fill one artist into every song** — in the songs editor, an artist typed
  into one row shows faintly in the rows with none, and Tab fills them all.

- **Save accent colors to choose again** — the heart in *Settings › Appearance*
  keeps the color shown among 10 tiles, the oldest going first; a tile uses its
  color, and shows it large with its hex on hover.

- **Clean up leads with what can be done** — a bar goes to each of its sections,
  with how many names wait or a check once done, the sections waiting first;
  in *Link artist names*, names ready to link come first and those linked or
  kept apart last.

- **Play a song from Up next** — clicking a song in *Up next*, or pressing its
  title, plays it now; an album's row plays from its first song queued.

- **Turn an AI provider off** — each provider's card in *Settings › AI* has a
  switch: off, it keeps its place and key but isn't asked. The card fits one
  line, why it last failed shows as an icon that explains on hover, and its
  opened fields and buttons line up.

- **A rail that minimizes, and the account at its foot** — the rail's two
  controls sit at its top: one shows only its icons, the other minimizes it to
  the view shown, whose menu goes to any other, so the page takes the width. Who
  is signed in moves from the header to the rail's foot, with *Sign out* in its
  menu; the view shown is set in from the rail's edges.

- **Choose the accent color** — *Settings › Appearance* picks any color for
  buttons, links, and what's playing, from a color square, a hex code, or a
  roll of the dice, and goes back to jade in one click. Each browser keeps its
  own; the page shades the color so it stays readable in light and dark.

- **Edit an artist's details** — *Edit details* on a linked artist's page
  chooses the name it is shown by, from every name it goes by, a note about it,
  and a photo of your own in place of Wikidata's. Its songs keep their names as
  written. *Ask AI* suggests a name and a note, each beside its field, to use or
  not.

- **An artist's page shows its photo** — once a name is linked, Wikidata gives
  the artist's photo from Wikimedia Commons, kept with the covers and credited on
  its page, and the *Wikidata* link opens the artist's own item. Artists linked
  before are asked again the next time you choose *Look up*.

- **A rail that collapses, and a search that spans the header** — the views'
  rail sits apart on a soft surface and collapses to its icons with the button
  at its foot, which each browser remembers; the search takes the header's room,
  with the Library's icon, as in the rail, and Bilibili's mark at its end, as on
  an iPad. Bilibili shows as its mark wherever there is little room, named on
  hover.

- **GitHub Copilot as an AI provider** — Settings offers *GitHub Copilot*
  beside DeepSeek, OpenAI, Anthropic, and Ollama. It is asked through GitHub's
  Copilot SDK with a GitHub token of an account with Copilot, kept in the
  Keychain, and given no tools: it only answers the question. Each question counts
  against your Copilot allowance.

- **An artist's page says who it is** — a round mosaic of its album covers, who
  MusicBrainz says it is, the other names it goes by, and links to its
  MusicBrainz and Wikidata pages and a Rate Your Music search; a name not linked
  yet offers to link it.

- **A Favorites station** — the Radio tab offers *Favorites* beside *My
  station*: it plays the songs you hearted, and those by an artist or from an
  album you favorited, every one before any again, for as long as you listen.

- **Rate Your Music imports merge, and can be viewed** — *Your ratings* in
  Settings has one row of buttons: *Export ratings*, *Discard import*, and
  *Import ratings*. Importing again keeps your earlier import and updates the
  albums the new export rates again, or replaces it if you choose *Replace it*
  in the preview. *Your imported ratings* lists every album you imported, with
  its stars and review and whether your Library has it, filtered as you type.

- **Ask AI which artist a name stands for** — *Ask AI* in *Link artist names*
  shows an AI model each name, a few of its songs, and the artists MusicBrainz
  offers, and marks the one it recommends, tagged with the model and why; or
  marks *None of these* when it recommends none. Nothing is linked until you
  link it, one by one or with *Link N recommended*.

- **Link artist names in one column** — each name's actions line up at the
  right, the same on every row; the artist going by a name exactly is marked as
  recommended, and *Link N recommended* links them all at once. Linking a name
  moves to the next name's *Link*, so the list is linked by pressing Enter in
  turn.

- **Previous and Next album** — while an album plays, the player's Previous
  and Next step by album: back to the album's start once it is a few seconds
  in, else to the album before, and on to the album after. A smaller pair inside
  them steps by song within the album, and seeks within a split file playing
  whole. A song of its own keeps Previous and Next as they were.

- **Edit an album from its page** — an album's page has *Edit details* beside
  its heart. An album that is one file opens *Edit details* on that file, as the
  Library does; an album of songs of their own opens *Edit album*, which sets
  its name, artist, year, and genre on every song at once, and follows the album
  to its new name.

- **Now Playing names the album, the song, and who sings it** — the album and
  the song in it share the first line, *(disc) Jay / (note) 可爱女人*, and the
  artist the second, each linking to its page with its own heart beside it, so
  it is plain whether a heart favorites the song, the album, or the artist. The
  mark that moves is the one playing as a whole. A Track from a video has a
  small *Bilibili* link beside the artist.

- **Open on Bilibili** — a Track that came from a Bilibili video, as a file
  named for it (`BV1dm4y1s7ak.m4a`) or a part added by link, has *Open on
  Bilibili* in its menu, which opens the video in a new tab; a song of a split
  file opens its file's video. The page only links; medleyplay asks Bilibili
  nothing.

- **Settings save as you change them** — the album length and the storage limit
  have no Save button any more: a choice saves at once, a typed value once
  typing pauses or the field is left, and *Saving…*, then *Saved.*, shows beside
  it. A lower limit that would remove Downloads still asks first, saying what it
  removes.

- **Snap song starts to the gaps** — the songs editor's *Snap* moves each start
  to the silence between songs nearest it, within half a minute, so an AI
  model's or a video's guessed starts land exactly; the moved starts are
  marked, and *Undo* puts them back. It runs ffmpeg, if installed on the
  server, once per file, through the new plugin `ffmpeg`. Songs filled from the
  AI now say their starts are estimated.

- **Which AI answered** — the AI's suggestions now name the model that gave
  them, such as *deepseek-chat suggests “GUMI”* in *Edit details* and *12 songs
  from deepseek-chat* in the songs editor, with the host it was asked at on
  hover, so a local stand-in's answer isn't taken for another provider's.

- **Clean up** — names to tidy and names to link to one artist now wait on one
  page under Insights, whose rail item says how many there are, instead of in a
  row under the Library's and Artists' headings. On a phone, Insights carries
  the count and links to the page. *Tidy all* sits at the head of its section
  and tidies every name listed at once.

- **Wikidata's names for linked artists** — linking a name to an artist asks
  Wikidata every name the artist goes by, in Chinese, Japanese, Korean, and
  English, for the names MusicBrainz lacks: *甲壳虫乐队* for The Beatles, *周董*
  for 周杰倫. A name a linked artist goes by is then offered that artist at once,
  and search finds the artist by it, through the new plugin `wikipedia`, on by
  default since Wikidata's API is open and needs no account.

- **One artist under many names** — Clean up offers to link the
  Library's artist names to artists MusicBrainz knows: *披头士*, *甲壳虫*, and *The
  Beatles*, or *Michael Jackson/迈克尔·杰克逊*, each looked up and offered with the
  artist going by it chosen already. Linked names count as one artist in the
  Artists view, on its page, in search, which finds it by any name it goes by,
  and in favorites and Radio; each song keeps its artist as written.

- **Hold ⌘ for the shortcuts** — holding ⌘ (Ctrl on Windows and Linux) on its
  own for a second and a half shows the keyboard shortcuts over the page, and
  letting go hides them. Shortcuts made with the key never show it. Settings turns
  it off for the browser.

- **Tidy names** — artist and album names written with more than the name in
  them, such as *周杰伦2000年发行首张个人*, *The Beatles（披头士）*, or
  *八日目、雨が止む前に。(初回限定盤B)*, are listed on Clean up, each with its
  tidy form, the year it gave, and the songs
  it is on. *Tidy* sets the name on those songs and the year where a song has
  none; *Keep* leaves a name as written for good.

- **An album's songs, set in under it** — in the Library, the songs of an open
  album sit further in, with smaller covers, on a guide that runs down from the
  album and turns into its last song, so which songs belong to it shows at a
  glance.

- **Ask the AI again, with a note** — once the AI's songs fill the songs editor,
  pressing *AI* opens a field for a note of your own, such as *the 2007 concert,
  with 22 songs*, and asks again at once, without the wait of a day. A dot on
  the AI button shows it working, its songs in, or its failure, and the note
  beside it says why. Songs you change while it works stay as they are.

- **What plays, as an album or a song** — Now Playing and the player show a
  record spinning while an album plays and a note swaying for a song, still
  when paused or for anyone who asked for less motion. Point at or press the
  record to see the album's songs in the order they play: those played, the
  one playing and how far it has got, and those to come; choose one to play
  it. While an album plays, the player's bar and Now Playing's span the whole
  album, split into one segment a song, each filled as far as it has played.
  Pointing at the bar lights up a song's segment and shows the album's songs
  over it, the one under the pointer ringed with how far into it you point.

- **Insights** — a new tab shows what you listened to most over the last 7
  days, the last 30, or all time: about how long you listened, your plays and
  songs, your top artist and album, and the ten artists, albums, and songs you
  played most. Listening time is measured as you listen, whole albums in one
  file included, and goes with the music when you move it to another device;
  plays from before count their whole song. Clearing History doesn't change
  Insights.

- **Import your Rate Your Music ratings** — Settings → Your ratings takes the
  export you download from your Rate Your Music profile and says what importing
  it changes first: the albums your Library has, the songs that take a new
  rating, the smart playlists songs join or leave, and the albums it hasn't, as a
  list to save. A song you haven't rated takes your rating of its album, in solid
  stars marked *From your album rating*, and rules, downloads, sorting, and radio
  read it as yours; choosing a star rates the song alone. An album's page shows
  your stars and review. Importing again replaces the earlier import, and
  *Forget the import* takes it away. *Export your ratings* downloads the songs
  and albums you rated as a CSV file. The import follows a 2020 export's columns.

- **History** — a tab beside *Up next* lists the songs you played, newest first,
  on every device you sign in on. Click one to play it now without changing
  *Up next*, or add it to the end. It shows the last 50 songs, or 25 to 500 as
  you choose in the tab, and *Clear* empties it after asking once more; play
  counts stay.

- **Ratings from MusicBrainz** — a song you haven't rated shows what MusicBrainz's
  listeners rated it, or its album, as grey stars to the nearest half;
  hovering says how many voted. Finding the song on MusicBrainz brings them, with
  no extra requests. They only show: rules, downloads, and radio use your own.
- **Open on RYM** — a Track's menu searches Rate Your Music for the album or
  song in a new tab. medleyplay itself never reads the site.
- **Mark as album, Mark as song** — a Track's menu turns a song into an album,
  or an album into a song, when its kind was guessed wrong.
- **Name a device** — in Settings → Other devices, an admin names an allowed
  device, as "Mia's phone"; its label shows beneath.
- **`medleyplay devices`** — with the server stopped, lists the allowed
  devices and chooses what happens to new ones, for a server with no screen.

- **Play on the computer** — on a phone, *Play on* in the player turns it into a
  remote for the medleyplay page open on the computer: the computer plays, the
  phone shows its queue and controls it, and choosing either moves what plays,
  from the same second. The computer's sleep timer can be set from the phone.
- **The Radio tab** — *My station* plays songs the Account likes and more like
  them, refilling as it plays, and shelves suggest albums: more like the one
  played most lately, not played yet by artists the Account plays, loved albums
  to rediscover, and albums just added, each saying why. A card plays its album
  or starts a station from it.
- **Filtering and grouping the song table** — a *Filter* panel of native
  controls keeps songs by artist, album, genre, year, rating, favorites, or
  whether they play now, offering only the values the other filters leave; a
  *Group by* control puts songs under folding rows by album, artist, album
  artist, year, or genre; and the table's header stays in view while it scrolls.
- **Accounts and the catalog** — the server keeps Accounts, sessions, Tracks,
  Sources, and Playlists in SQLite with migrations. The first Account becomes the
  admin; the server has one Account unless the config file lets the admin create
  more. You sign in and out, or out everywhere, and a
  lost password is reset with `medleyplay reset-password`. Each Account has its
  own favorites, ratings, and Playlists. `medleyplay serve` runs the API. See the
  [Architecture](docs/contributing/design-notes/Architecture.md#accounts) note.
- **Plugins** — features arrive as plugins that run in a separate plugin host
  process, so a plugin that raises, hangs, crashes, or leaks can't take the
  server down. A plugin that fails to load is quarantined, and one that keeps
  failing is faulted until an admin resets it. `medleyplay.toml` in the data
  folder turns plugins on and off, `medleyplay serve --safe-mode` starts with
  all of them off, and `GET /api/plugins` shows each plugin's state. See the
  [Plugin host](docs/contributing/design-notes/Plugin%20host.md) note.
- **Jobs** — long work, such as a download or a scan, runs as a Job in a process
  of its own, one at a time per target. Jobs retry plugin faults with a growing
  delay, wait out network failures, survive a server restart, and can be
  cancelled or retried; `GET /api/jobs` lists them with their progress. See the
  [Jobs](docs/contributing/design-notes/Jobs.md) note.
- **Libraries** — an admin registers a folder or a zip archive of music, and a
  scan adds its songs to the catalog with their tags. Rescans read only what
  changed, follow files that moved, mark files that went away as missing, and
  take an unplugged drive offline without forgetting it. The `fsspec-library`
  and `tinytag-tags` plugins read the files. See the
  [Libraries](docs/contributing/design-notes/Libraries.md) note.
- **Playing audio** — `POST /api/tracks/{id}/playback` picks the Source a
  Track plays from, and its audio is served with Range, `If-Range`, and `HEAD`,
  so browsers, Safari included, can seek. A song compressed in a zip archive is
  copied into the cache once by a Job and answers *preparing* until then. Plays
  are recorded under ids the client chooses, so a retry counts once, and each
  Track says whether it can play now. See the
  [Playback](docs/contributing/design-notes/Playback.md) note.
- **Web player** — the server serves a web player at `/`: sign in, or create the
  first Account on a new server; the Track list; a queue you can reorder; and a
  player with seeking and lock-screen controls. Each browser keeps its own queue
  and position across reloads, and counts a play as Last.fm does. Build it with
  `npm run build` in `web/`. See the
  [Playback](docs/contributing/design-notes/Playback.md#the-web-client) note.
- **A redesigned web player** — a floating player with icons for every control,
  a light, dark, or system theme, and a queue you reorder by dragging, or from
  the keyboard. The seek bar is easier to drag and moves the Track only once
  let go, and a row's actions show on touch screens.
- **Settings** — choose the theme, and see what Downloads and prepared copies
  use against the storage limit. An admin changes the limit, with a preview of
  what a lower one would remove before saving. Each section folds, and a bar of
  their names under the header goes to one.
- **Views and search** — Songs, Artists, Albums, Downloaded, and Playlists, with
  a built-in *Favorites*, worked out in the browser from the Library, so moving
  between them asks the server nothing; Back, Forward, and bookmarks work. One
  search box finds songs, artists, and albums as you type, ignoring case, width,
  and hiragana or katakana. On a tablet the views are tabs and the queue opens
  from the player; on a phone they are a tab bar. The Library refreshes when the
  page is shown again or a scan or download finishes.
- **The song table** — sort by any column, hide and resize columns, and mark
  favorites and rate Tracks from five stars, in the table and the player. It
  draws only the rows on screen, so a large Library scrolls smoothly. Each Track
  in the API now says whether it is `downloaded`. See the
  [Web client](docs/contributing/design-notes/Web%20client.md) note.
- **Play modes** — shuffle, and repeat the queue or the current Track, saved
  with the queue. Choosing a Track now queues its whole list, so *Previous*
  reaches the Tracks before it. See the
  [Playback](docs/contributing/design-notes/Playback.md#the-web-client) note.
- **A song's menu and Add to playlist** — a "…" on every song and on the song
  playing holds *Play next*, *Add to queue*, *Go to artist*, *Go to album*, and
  *Add to playlist…*, which adds the song to one or several Playlists, or to a
  new one. See the
  [Web client](docs/contributing/design-notes/Web%20client.md#a-songs-menu) note.
- **Now Playing** — the player's cover, or F, opens the song playing over the
  whole screen: its cover large over a blur of itself, its title, artist, and
  album, the player's controls, the volume, and *Up next* beside it. See the
  [Web client](docs/contributing/design-notes/Web%20client.md#now-playing) note.
- **Keyboard shortcuts** — Space or K plays or pauses, the arrows seek, Shift
  and the arrows skip, M mutes, and keys for volume, shuffle, repeat, favorite,
  search, *Up next*, and Now Playing. Each control names its keys on hover, as the keyboard
  prints them, and *?* lists them. Settings gives a command more keys or fewer,
  kept with the Account, so they follow it to any browser, through
  `GET` and `PUT /api/me/preferences`. See the
  [Web client](docs/contributing/design-notes/Web%20client.md#keyboard-shortcuts) note.
- **One Favorites** — every Account has a Favorites smart playlist the server
  keeps, which can be *Keep downloaded* and can't be edited or deleted; the web
  client shows it in place of its own copy, so Favorites appears once. A
  Playlist's *Keep downloaded* switch also has a route of its own. See the
  [Download policy](docs/contributing/design-notes/Download%20policy.md#smart-playlists)
  note.
- **Volume, Play and Shuffle, and a precise seek bar** — the player gains a
  volume control, and each view *Play* and *Shuffle* for its songs. The seek bar
  shows the time under the pointer, seeks at once where it is clicked, seeks a
  drag once it is let go, and no longer jumps back after a seek. See the
  [Playback](docs/contributing/design-notes/Playback.md#the-web-client) note.
- **Bilibili** — save an Account's Bilibili login from a cookies file, kept in
  the macOS Keychain and lent to its downloads; look a video up by any link,
  short links included, and add its parts as Tracks, which download in the
  background and play even after the video is removed. The `bilibili` plugin is
  off by default until yt-dlp can read Bilibili again. An admin can set the
  household's proxy for Bilibili (`http`, `https`, or `socks5h`), kept in the
  Keychain, which the plugin uses for every request; nothing retries around a
  refusal. See the
  [Bilibili](docs/contributing/design-notes/Bilibili.md) note.
- **Job progress over SSE** — `GET /api/events` tells every open browser each
  time a Job changes.
- **Download policy** — mark any Playlist *Keep downloaded*, and its Bilibili
  Tracks download in the background, two at a time, and stay. Smart playlists
  pick their Tracks by rules on favorites, ratings, plays, text, and when a
  Track was added or played. An admin's storage limit makes room by removing the
  least favorite Downloads nothing keeps, never one downloaded, played, or kept
  within the last day, nor the only copy of a video gone from the site.
  `GET /api/storage` shows the space in use and previews another limit. See the
  [Download policy](docs/contributing/design-notes/Download%20policy.md) note.
- **Online and Offline** — medleyplay contacts music sites only while Online.
  *Auto*, the default, is Offline with no network, on a network an admin marked
  metered, such as a phone hotspot, or when the internet can't be reached, and
  comes back Online only once that has held for a while; an admin can also set
  it Online or Offline. While Offline, Downloads wait queued, running ones stop
  without counting a try, a Track still to download is *available when online*,
  links wait, and no Download is removed. The header says when medleyplay is
  Offline and why, and Settings has a Network section to choose the setting and
  mark networks metered. See the
  [Mode](docs/contributing/design-notes/Mode.md) note.

- **Track details with their origins** — each of a Track's details (title,
  artist, album, album artist, track and disc numbers, year, and genre) is kept
  with where it came from, and the household's own values win over the file's
  tags, the video's text, and the file's name. *Edit details…* in a song's menu
  shows where each came from and offers what the others say; many Tracks are
  edited at once through `POST /api/tracks/details`. *Paste the video's details*
  there reads a video's title and description, copied from the site, for the
  song's title, artist, album, and year, and the songs it lists, and a Library scan
  reads the `.info.json` yt-dlp writes beside a download the same way. See the
  [Track details](docs/contributing/design-notes/Track%20details.md) note.

- **Songs inside a long file** — *Split into songs…* on a song's menu splits a
  whole album uploaded as one video into its songs, from a list found in the
  video's details or pasted, and *Edit songs…* edits them, listening in the
  dialog from any song's start to place the next. Each song is a Track
  of its own that keeps its ratings, plays, and Playlist places when the list is
  edited, takes its album, artist, and track number from the file, and plays its
  stretch of the file, on into the next song without a gap. See the
  [Segments](docs/contributing/design-notes/Segments.md) note.

- **Covers** — a Library scan finds a song's cover, embedded in its file or as
  an image beside it, shown even when only the video's details name the album
  or the household corrects its spelling, and *Edit details* uploads a JPEG,
  PNG, or WebP image as a song's cover; the table, Up next, the album cards,
  the player, and the lock screen show it. A cover is kept once, by its
  content, shared by the songs of an album, and removed when the server next
  starts once nothing shows it. See the
  [Track details](docs/contributing/design-notes/Track%20details.md#covers) note.

- **Find a Track's details online** — *Find details online* in a song's menu
  asks Bilibili for the title, description, chapters, and cover of the song's
  video, read as a sidecar or a paste is, when the song has a video and no text
  from a file beside it or the household. An admin's *Find details for all* in
  Settings queues every such song. The `bilibili-details` plugin, off by default
  like `bilibili`, asks one video at a time with a pause between, never the same
  video twice in a day, through the household's proxy, and nothing is asked unless
  someone chooses it. The first refusal from Bilibili stops it until an admin
  resets it in Settings. See the
  [Track details](docs/contributing/design-notes/Track%20details.md#enrichers) note.
- **Manual downloads** — search with *Bilibili* chosen takes a link or a `BV` or
  `av` code and opens an add dialog, which also adds a video medleyplay can't
  read, on titles and artists you give. A Track whose Download failed says so and
  offers *Add the file…*, and any Bilibili Track's menu has *Add the file
  yourself…*: choose an audio file, with other ways to get it listed, and it
  becomes the Track's Download, plays, works Offline, and is never removed to make
  room under the storage limit. See the
  [Manual downloads](docs/contributing/design-notes/Manual%20downloads.md) note.

- **Find a Track on MusicBrainz** — *Find on MusicBrainz* in a song's menu looks
  up the song's release and its front cover, and an admin's *Find on MusicBrainz
  for all* in Settings queues every song that shows a title and an artist, or a
  split album file's album; a file over 20 minutes that shows an album is matched
  as that album. The `musicbrainz` plugin, off by default, records the album,
  album artist, year, track and disc numbers, genre, and cover under its own
  origin, which sits below the file's tags and the household's values. It asks at
  most once a second with a User-Agent that names medleyplay, waits out
  MusicBrainz's rate limit, never asks the same Track twice in a day, and stops
  until an admin resets it when MusicBrainz refuses a request. See the
  [Track details](docs/contributing/design-notes/Track%20details.md#musicbrainz) note.

- **Suggest a Track's details with AI** — *Suggest details with AI* in a song's
  menu asks an AI model what the song's video text says, and an admin's *Suggest
  for all* in Settings → AI queues every song that has video text. An admin sets
  the provider there: a base URL, a model, and a key, with presets for DeepSeek,
  OpenAI, Anthropic, and Ollama; the key is kept in the Keychain and never shown
  again. The `ai-details` plugin, off by default, only suggests. A suggested value
  shows beside its field in *Edit details* with *Use*, and a suggested song list
  loads into the songs editor; nothing a Track shows changes until you use one. It
  sends the video's title, description, and chapters to the provider, asks one
  Track at a time, never the same Track twice in a day, and stops until an admin
  resets it when the provider refuses the key. See the
  [Track details](docs/contributing/design-notes/Track%20details.md#ai-suggestions) note.

### Changed

- The player prepares the album and artist pages for the current and next songs,
  including the pictures already in the Library.

- Hovering over a Library row or focusing a control in it shows an empty heart
  in the accent color. A filled heart still means the track is a favorite.
- A saved Tavily key shows **Change Key** and **Remove Key** side by side in Settings.

- **An artist's page is laid out like an album's** — its photo large on the left; its
  name, who MusicBrainz says it is, its other names, and its links beside it; and Play,
  Shuffle, the heart, and a round pencil for *Edit details* on the photo's bottom line.
  How many songs there are and how long they last show under them, as on an album. On
  a phone, the photo is on top and the rest centered under it.
- **A song's artist as a tag in Edit details** — once saved, the artist shows as a tag
  the width of its column, with its photo, and clicking it edits it as text again. *Another
  artist named …?* is now a ? inside the tag, and *More artists* a + beside it, so the
  Artist box lines up with Genre's.
- **The data folder is in the Music folder on a Mac** — `~/Music/medleyplay` by
  default, beside the music. On a Mac whose data is still in
  `~/Library/Application Support/medleyplay`, `serve` asks to move it there. The new
  `medleyplay move-data [<folder>]` moves it anywhere while the server is stopped:
  it copies the folder, checks the copy, and only then deletes the old one. Every
  command takes `--data-dir` to choose the folder, as `MEDLEYPLAY_DATA_DIR` does.
- **The line sung now runs the player's whole width** — in a row of its own along the
  bottom of the player bar, centred, so a long line fits; a line still longer ends in
  "…" with the whole of it in its tooltip. Between lines the row stays empty, so the bar
  keeps its height.
- **Both names in the player bar** — when the artist or the album is long, each is
  shortened on its own, the longer one giving up more room, so both stay in sight with
  the dash between them; hovering either shows it whole. Short names show as before.

- **An album's page, laid out like a record** — the cover sits large on the left; the
  album's name, its artist and the year it came out are centered beside it, and Play,
  Shuffle, the heart and a pencil for *Edit details* line up with the cover's bottom
  edge. How many songs it holds and how long they last moves under the songs. On a phone
  the cover sits on top, the names under it, and Play and Shuffle share a row.

- **Shortcut keys as key caps** — hovering a player control, or reaching it with the
  keyboard, shows a tooltip with its name and each key as a cap of its own, such as
  *Next album* ⌥ ⇧ →, the modifiers as symbols on Apple devices; screen readers
  still hear the keys in words.

- **Busy buttons wait in place** — a button whose action runs, such as *Find* for
  lyrics, *Find on MusicBrainz*, or *Ask AI*, shows one spinner, its label kept, and is
  marked busy for screen readers.

- **Clearer links beside a song's Artist** — *Which Jay?* is now *Another artist
  named Jay?* and *Add artist* is *More artists*, each with a tooltip saying what it
  is for; a long name ends in an ellipsis.

- **Now Playing keeps the cover and its lyrics together** — the cover and the
  lyrics sit side by side in the middle of the screen, as wide as each other, rather
  than each in its own half. *Up next* opens in a window from its button, over the
  dimmed lyrics, so the cover stays where it is; Escape, a click elsewhere, or the
  button closes it.
- **No blank page while medleyplay starts or opens something** — the page shows its
  colors, in the theme chosen, and a quiet *medleyplay* mark from the first moment,
  where it was empty for about two seconds; Edit details, Edit album, Now Playing,
  and the add dialogs open at once; the rest load while the browser is idle and show
  a busy frame if opened first. A part that fails to load says why where it would
  show, with *Try again*, or *Reload* when medleyplay was updated, and never empties
  the page. Scripts and styles are sent gzipped, and a browser keeps them through a
  304: the first visit's scripts and styles shrink from 1,107 KB to 484 KB with every
  part preloaded.

- **Coming back to the page waits less** — which songs each lookup may be asked
  about is kept on the server until something changes, and answered 304 to a page
  holding it; the answer says when each song asked before may be asked again, and
  the page applies the wait itself. A return to the tab with nothing changed took
  309 ms, now 32 ms. `GET /api/enrichers/{name}` sends `waiting` and `asks_again` in
  place of `asked_recently`.

- **Covers load small in rows and tiles** — the server keeps a 128-pixel and a
  512-pixel copy of each cover and photo, made ahead by a Job through the new
  `ffmpeg-thumbnails` plugin; song rows, Up next, and the player show the small one,
  album and artist tiles the larger one, and Now Playing, the editors, and *Save*
  the original. Until a copy is made, or without ffmpeg, the original shows as
  before. Scrolling the whole Library of the preview loads 0.9 MB of covers rather
  than 21.6 MB, and the page holds about a third of the memory. New:
  `GET /api/covers/{name}?size=small|medium&recipe=1`.

- **The Library loads faster** — the songs and the artist names are kept once
  built, until something changes, and sent gzipped; a browser holding them gets
  *304 Not Modified*. The reads that take longest to build take turns, rather than
  slowing each other down, and the artist names ask about active Jobs once. Fifteen
  reads at once answer in 0.7 s rather than 1.9 s on a library of 1738 songs.
  Signing out asks the browser to forget what it kept.

- **Coming back to the page costs little when nothing changed** — the page asks
  for the songs and the six lists beside them (artist names, names to tidy, split
  offers, artist splits, shared names, artists missing a photo) with what it holds,
  and an unchanged one comes back as *304 Not Modified* and renders nothing. A heart
  or a rating no longer asks for those lists again, and when a session or device
  was last seen no longer counts as a change. On a library of 1738 songs, coming
  back sends 5.7 kB rather than 148 kB, and a heart sends one request rather than 13.

- **An old artist link names one artist or asks which** — a link by the name alone,
  such as `#/artist?name=Jay` saved before artist pages opened by id, asks *Which
  Jay?* when the name goes by several artists, each a tile told apart by its album.

- **Ask AI in the picture editor asks on opening** — the tab asks the AI the first
  time it opens for an album or artist, without a button to press first. *Ask
  again* takes a note of the picture wanted, as the songs editor does. New: a
  `hint` in the body of `POST /api/image-links/album/suggest` and
  `POST /api/image-links/artist/{id}/suggest`.

- **Dialogs close from a ✕ at their top right,** with Escape and a click outside as
  before; their footers hold only what they do, so *Save* stands alone. The main
  action reads *Save* (not *Save songs*, *Save to 2 songs*, or *Use these songs*),
  and the song list's *Back to the songs* is gone, as pressing *List* again does
  the same. A song list's *Save* fills the songs and saves them at once.

- **A faster first load** — the songs are read first and alone, then what shows
  around them once they are drawn, and what only some views need when the browser is
  idle; the Library shows rows shaped like songs meanwhile. Now Playing, the
  editors, and the Insights, Settings, and Clean up views load the first time they
  open. On a Library of 1,590 songs, the first rows show in about 0.6 s instead of
  3.2 s.

- **One way to replace a cover or a photo** — a song's cover, an album's, and an
  artist's photo each show *Save image*, *Replace*, and *Remove* over the picture on
  hover. *Replace* opens a picture editor with a tab for each source: *Upload* (drop
  or choose a file, previewed before use), *MusicBrainz* (covers only), and *Ask AI*.
  An album's cover can now be uploaded too. New dependencies: `@radix-ui/react-tabs`
  and `react-dropzone`.

- **Asking the AI again within a day asks first** instead of refusing: *Ask the AI
  again?* says another request may cost money and likely brings the same answer,
  and asks again once you agree. `GET /api/enrichers/{name}` lists the songs asked
  lately as `asked_recently`, and asking about one is refused with that code.

- **Dynamics move smoothly** — the effect behind Now Playing is drawn on every frame
  the display shows, rather than about 30 times a second, from a finer, blurred copy
  of the cover, so its colors flow without stepping.
- **Compact dialog buttons** — a dialog's own buttons, such as *Close*, *Save*, and
  *Cancel*, are one compact height everywhere, as tall as their words need.

- **The time playing stands apart from the length** — in the player and an
  album's songs, the running time reads first and the length it runs to steps
  back, fainter.

- **A minimized rail names the view once** — with the rail minimized, its menu
  takes the place of a view's heading when the two say the same, as *Library*;
  *Downloaded* now sits below *Playlists* in the rail.

- **A song's album folds away** — in a song's *Edit details*, the album fields
  fold to a line saying its album, or that it is a single, and open when pressed.

- **The album's songs close when the mouse leaves** — opened from the album
  playing, by pointing or a click, they no longer stay until Escape; each song
  leads with a heart to favorite it.

- **Saving details keeps the dialog open** — *Edit details* stays on the details
  as saved and says so, so an album's songs can be split next; *Cancel* reads
  *Close* once nothing is left to save.

- **Controls say why they can't be used** — *AI* and *Snap* in the songs editor,
  and a preset already set up, say why on hover; a heart says whether its song
  is a favorite and what a click does; short buttons no longer wrap their
  labels, and a busy button shows one spinner in its icon's place.

- Renamed the project from stream to medleyplay.
- A Library backend's `locate` answers *missing* for a file that is gone,
  instead of raising, so an unplugged drive can't fault its plugin.
- In a narrow view, such as a laptop's with Up next open, the table leaves out
  the album column so each song's title keeps its room.

### Removed

- **The 2019 prototype** — the Express server, the Create React App client, and
  the library-file builder are retired ahead of a rewrite. They remain in the git
  history.

### Fixed

- The search dropdown stays above the sticky section bar in Settings and Clean up.

- A successful Job's finish time includes saving its result, so a lyrics search
  no longer appears to finish before its songs were found.
- Clicking a split album in the Library plays the whole file. Expand it and
  click a song to play just that song instead.

- **Using a suggested photo or cover shows it was received** — in Clean up, *Use*,
  *Dismiss*, and *Use all* on a suggested artist photo or album cover now fade it and tag
  it *Saving…* at once. It takes no more clicks until it is recorded and leaves; if saving
  fails, it can be used again.
- **Back from a song's Edit songs to its own details** — *Edit songs* in a song's menu
  opened the songs of its file over the whole file's details, so *‹ Details* led to the
  file, which has no lyrics of its own, and *Lyrics* was missing. It now leads back to
  the song chosen, with *Lyrics* as when *Edit details* opens it.
- **Shift + → goes to the next song** — after a click on the position bar, which
  focuses it, Shift + → only showed its focus ring; arrows held with Shift, Alt,
  Ctrl, or ⌘ now always go to the shortcuts. While an album plays, Shift + ← and
  Shift + → step by song, as the tooltip said, rather than by album.

- **A cover chosen in Edit details** — using, uploading, or removing a cover in a
  song's *Edit details* now returns to *Edit details*; it closed the whole dialog. A
  window opened from another one, such as the cover editor, now closes on its own.

- **A song's cover is its album's** — a cover chosen in a song's *Edit details* now
  goes on every song of its album (for a song of a split file, on the file), so *Up
  next* and the album show it on each song; it went on that one song alone. A song on
  no album keeps a cover of its own.

- **The player names the song of a split file** — a file playing whole after it was
  split into songs showed its own title (such as the video's BV code) in the player;
  it now names the song it has reached, as Now Playing does.

- **The songs editor's way back** — *Details* at the top of the songs editor opened
  from *Split into songs* now shows the song's details; it closed the dialog. Saving
  the songs still closes it.

- **Adding from Bilibili answers at once** — its dialog opens the moment Enter is
  pressed, saying it looks the video up, rather than after its code loads; and a
  song just added shows a download mark and how far it has got in its row, its
  cover spinning, rather than *Unavailable*.

- **Song titles readable beside Up next** — a table narrower than 64rem keeps only a
  row's "…" (which holds the queue actions), so a title no longer shrinks to a
  letter or two.

- **A suggested photo's controls are exactly its halves and quarters** — pointed at,
  each tints just its part: the lower half green to use it, the upper right red to
  dismiss it, the upper left in the accent to choose another. They had stopped short
  of the photo's bottom, so the halves weren't halves.

- **Now Playing's lyrics mirror the cover** — they take the half of the page beside
  the cover's half, so "No lyrics for this song." sits level with the player and as
  far right of the middle as the cover is left of it.

- **Asking the AI for a file's songs can be stopped:** pressing *AI* again while it
  asks, or closing the editor, cancels the lookup, so no AI round runs for nothing.

- **Tidy and Use … work on names a split file writes** — tidying an album name
  that only a split file's songs showed, as when the file named the album by its
  title, changed nothing while saying it changed every song; now the file takes
  the tidy name and its songs follow. *Use …* in Link artist names did nothing
  for a name only a split file wrote; it now renames the file, and says so when no
  song shows the name any more.

- **An AI model now finds pictures for a cover or an artist** — it was asked for
  exact image links, which it rarely knows, so it mostly named none. It now names
  Wikipedia articles, in the language the album or artist is known in, and files on
  Wikimedia Commons, each shown by its lead image from the MediaWiki API.

- **Taking out earbuds pauses, and it stays paused** — the system's *pause* no
  longer starts playing again when it comes twice, once per earbud, and a change
  of audio devices pauses, so the music doesn't carry on through the speakers.

- **Selected text takes the accent color** — highlighting text shows the accent
  chosen in Appearance, not always jade.

- **The player's heart is Now Playing's** — while a whole album in one file plays,
  the player's heart favorites the album, as Now Playing's does, rather than the
  file; while a split file plays whole, it favorites the song playing.

- **A minimized rail stays above the view** — it is a band under the header that
  the view scrolls beneath, rather than a pill the view's text showed through and
  that scrolled away; section bars and the songs' header stick below it.

- **Adding from a site names its fields** — the parts' boxes say *Title* and
  *Artist* above them, as *Quality* does, and the quality chosen no longer shows
  cut off.

- **Covers keep to a square** — a cover that isn't square, on a Radio shelf or
  an artist's or album's tile, is cropped to the tile rather than stretching it.

- **Reach the album's songs over the seek bar** — the card of the album's songs
  shown while hovering its seek bar now stays as the pointer moves up onto it,
  holding still there, and a song chosen on it plays.

- In *Link artist names*, hovering a name or its song count, or focusing the
  count, shows its songs with their albums, so which artist it names can be told;
  and *Asking the AI…* shows one spinner, not two.

- **Ask AI keeps its recommendations true** — a recommendation is no longer
  shown once the name is offered other artists; a song with a very long title no
  longer stops the AI being asked; a name written only as an album artist is shown
  to the model with its songs; one choice the model writes in words no longer
  spoils the rest; asking again while it is asked is refused rather than skipping
  names; and *Ask AI* appears only when there is a name it can ask about.

- **Why an AI provider's answer couldn't be used** now shows on its card in
  Settings, such as *It answered 400: check the model and the base URL* or *Its
  answer ran out of room before it finished*, and a reasoning model such as
  DeepSeek has room to think before it answers, rather than being cut off.

- In Edit details, the Song and Album choice no longer shows stray round marks
  below it when the Kind is settled, and *Read details* fits its button.
- In Safari, scrolling the Library no longer leaps hundreds of pixels at a time,
  which lit another row than the one under the pointer.
- Finding a Track on MusicBrainz searches for a whole album when the Track's
  Kind is album, as the Library shows it, rather than by its own 20-minute
  rule; a file shorter than the household's album length is searched for as a
  song. Changing the album length now reaches every open page at once.
- Why a Job failed, which may name a path on the server's disk, shows only to
  the Account that asked for the Job and to admins; anyone else sees the kind of
  failure alone, in the Jobs list and the event stream.
- A proxy whose login is outside ASCII is refused when its URL, written with
  each such byte as `%XX`, passes 512 characters, rather than being kept and
  then refused when read back.
- A song's menu taller than the window scrolls, so its last items can be reached
  on a short screen.
- A stopping server no longer waits forever for a page still open in a
  browser; it closes the page's connection after 5 seconds.
- A row's song or album mark changes as soon as its details are saved, not on
  the next reload.
- An empty song list's two-line example is numbered 1 and 2, so it no longer
  reads as one line, and its caret is one line tall rather than spanning both.
- Asking a second lookup about a song, such as *Find on MusicBrainz* while its
  *Find details online* waits, now queues that lookup instead of returning the
  first one's.
- Songs saved as fragmented `.m4a` or `.mp4` files, as Bilibili downloads are,
  now show their length instead of none.
- A too-large id in a request is refused, not a server error.
- On a phone, a long Library's song titles take the row's width again, rather
  than a few letters of it.
- A removed Track's id is never given to a new one, so a queue still naming it
  can't play another song in its place.
