# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
