# Web client

> [!NOTE]
> **Status: implemented.** This note describes the client's views: the song
> table, Artists, Albums, Downloaded, Playlists, search, Now Playing, the
> keyboard shortcuts, and Settings, and how they get their data. What the client must do is in [MVP](MVP.md#client-notes);
> the player, the queue, and play modes are in
> [Playback](Playback.md#the-web-client); adding from Bilibili and adding a
> Track's file by hand are in [Manual downloads](Manual%20downloads.md#the-web-client).

## Contents

- [Data](#data)
- [Views](#views)
- [The song table](#the-song-table)
- [A song's menu](#a-songs-menu)
- [Now Playing](#now-playing)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Search](#search)
- [Favorites and ratings](#favorites-and-ratings)
- [Settings](#settings)
- [Listening on another device](#listening-on-another-device)
- [Layout](#layout)
- [Testing](#testing)
- [Left for later](#left-for-later)

## Data

- **The client loads the whole Library once:** `GET /api/tracks` and
  `GET /api/playlists` when the page opens, keyed by id. Every view, sort, and
  search is worked out in the browser from that data, with pure functions, so
  moving between views asks the server nothing. Until the first answer, the
  page says it is loading.
- **A change the client makes shows at once.** Setting a favorite or a rating
  changes that field of that Track, then sends the absolute value. Each write
  has a number, and only the answer to a field's latest write counts, so quick
  toggles can't settle out of order; the answer changes only the field it was
  about. A refused write puts back the last value the server confirmed, and
  says why. A fresh list from the server keeps any write still under way.
- **The client asks for the Tracks again** when a page that was hidden is shown
  again, when the event stream reconnects, and once a scan or a Download Job
  finishes, a second after the last such event. So a favorite set on another
  device, or a Download the storage limit removed, shows on coming back to the
  page.
- **The server adds one field, `downloaded`,** to each Track: whether a Source
  of the Track has a Download row, so a cache copy of a zip member doesn't
  count. Nothing else in the client's data can tell, and the catalog already
  finds it to work out availability. The client also reads `album_artist`,
  `added_at`, and `last_played_at`, which the API already has. Two more say
  where a site Track's audio stands: `download_failed`, and `site`, the kind of
  site it comes from, if any; see [Manual downloads](Manual%20downloads.md).
- **Large Libraries:** the Track list is loaded whole and the table draws only
  the rows on screen, so tens of thousands of Tracks scroll smoothly. Loading
  page by page from the server would make every view and search a server query;
  it waits until a Library is too large to load whole.

## Views

Each view is a hash route, so Back, Forward, and a bookmark work, and a reload
keeps the view. The routes are a few lines of our own over `hashchange`, with
no router package.

| View | Route | Shows |
| --- | --- | --- |
| Library | `#/library` | Every song and album, a split file's songs folded under it; see [The Library](#the-library) |
| Radio | `#/radio` | *My station*, and shelves of albums for the Account; see [Recommendations](Recommendations.md#the-radio-tab) |
| Artists | `#/artists` | Each artist, with how many Tracks and how long; one opens its Tracks |
| Albums | `#/albums` | Each album, under its album artist, or its artist when that is blank |
| Downloaded | `#/downloaded` | The Tracks with `downloaded`, in the song table |
| Playlists | `#/playlists` | *Favorites* first, then the Account's Playlists |
| Search | `#/search?q=…` | What the search found |
| Settings | `#/settings` | See [Settings](#settings) |

- **An artist's or album's Tracks** open at `#/artist?name=…` and
  `#/album?artist=…&name=…`, in the song table, so a name with a `/` is safe.
- **Artists are the artist field as written:** `初音ミク/米津玄師` is an artist
  of its own, since splitting names on a separator guesses wrong as often as
  right. Names that differ only in case or width are one artist. A blank artist
  or album is listed as *Unknown artist* or *Unknown album*.
- **Favorites** is the smart playlist of favorite Tracks that the server keeps
  for every Account; see [Download policy](Download%20policy.md#smart-playlists).
  The client shows it once, first, with a heart, at `#/playlist?id=favorites`,
  and works out its Tracks from the hearts it already holds, newest added first
  as the server orders them, so a heart counts at once. The server doesn't
  record when a Track became a favorite, so *recently liked* waits for that.
- **Playlists gain songs from a song's menu;** renaming, reordering, and
  removing wait. See [A song's menu](#a-songs-menu).
- **Playing from a view** queues the Tracks the view shows, in their order at
  the click; a later sort or a fresh list doesn't change the queue. A Track that
  can't play stays in the queue, and *Next* skips it.

## The Library

The Library holds two kinds of item, songs and albums in one file, which
support different things: an album is browsed into and played whole, a song is
played on its own. See [Track details](Track%20details.md#the-details) for how a
Track's kind is decided.

- **Each item is a row,** marked with a note for a song or a record for an
  album, each named *Song* or *Album* for screen readers and in its tooltip; the
  marks show in every song table and in Up next. A settled kind has a solid
  mark; a guessed one an outline, sitting back a little, named *Album, guessed
  from its length*. Choosing Song or Album in Edit details settles it.
- **Settings → Songs and albums** says how long a file is guessed an album, 20
  minutes unless an admin sets another length or turns the guess off; saving
  asks for the Tracks again, so their kinds show at once.
- **A split file's songs fold under it,** behind a caret named *Show the songs
  of 生如夏花*, which states `aria-expanded`; its songs are set in under it,
  with smaller covers, on a guide that runs down from the caret and turns into
  the last song. The
  table keeps `role="table"` with a disclosure button rather than a treegrid,
  which would promise arrow-key moves between cells. Sorting sorts the songs
  under each file too; a filter keeps a file while it keeps any of its songs,
  showing only those. Grouped, the table lists every song in its file's place,
  as other tables do.
- **The heading counts both:** *2 albums, 120 songs, 9 hr 5 min*, the songs of
  split files among the songs.
- **`#/songs`**, the route the Library had when it was called Songs, opens it,
  so old bookmarks still work.
- **A *music folder*** is what people see for a folder or zip an admin adds;
  the code and the API call it a Library, as before, and the page keeps
  *Library* for all the household's music.
- **Play and Shuffle play the Library's order:** each item in its place, a split
  file as its songs in their order. A caret beside each offers the other two
  orders, *by album* and *by song*; see [Playback](Playback.md#the-web-client).

## The song table

- **TanStack Table 9 with TanStack Virtual,** headless, so the page keeps its
  own look and real `<table>` semantics. Only the Tracks on screen are in the
  page; the rows above and below are spacer rows hidden from screen readers,
  and the table states `aria-rowcount`, the Tracks and the header row, with
  `aria-rowindex` on each row, so a screen reader counts every Track.
- **The song playing shows bars over its cover,** so its title stays where it
  was, and its row has `aria-current`. A lookup asked about a song takes the
  cover's place while it runs, as [Track details](Track%20details.md) says.
- **A click anywhere on a song's row plays it,** with the songs shown queued
  around it, as its title button does. A click on the row's own controls (the
  heart, the stars, the queue buttons, the menu, a link) does only what that
  control does, and a click that ends selecting text plays nothing. The title
  stays the control for the keyboard and screen readers, so the row itself
  isn't a second tab stop.
- **Columns:** favorite, title, artist, album, time, rating, plays, and added,
  and album artist, year, and genre, hidden at first.
  Each sorts by a button in its header, which states `aria-sort`: a click sorts
  it, again the other way, and a third time returns to the server's order, the
  oldest added first. One column sorts at a time, since a second sort key would
  need a modifier key a touch screen lacks. Text sorts as people read it, by
  locale, with numbers in order and case ignored; time, rating, plays, and added
  sort as numbers and dates, smallest first.
- **Columns can be hidden and resized,** from a menu in the header row; the
  choice is kept per browser, versioned, and ignored when it can't be read.
- **The header stays in view:** it sticks under the top bar while the songs
  scroll, on a solid band with a rule below it, its names in the ink color.
- **Filters** are TanStack's own column filters, in a *Filter* panel of native
  controls, so a phone shows its own pickers: kind (songs or albums), artist,
  album, genre, and year,
  each offering only the values the other filters leave, with how many songs
  each keeps; a rating of at least so many stars, or none; favorites only; and
  only the songs that play now. A genre such as `alternative rock; britpop`
  matches each of its parts. Each filter on shows as a chip that removes it,
  beside how many of the songs are shown and *Clear filters*. Play, Shuffle, and
  choosing a song play the songs the filters leave. Filters last while the view
  is open.
- **Group by** album, artist, album artist, year, or genre puts each group's
  songs under a row naming it, as *生如夏花 · 朴树 · 2 songs*, which folds and
  opens them; an album is its name and its album artist, so two albums of one
  name are two groups. Groups open whenever the grouping changes, and keep the
  order their first song has. A group's row has a cell per column, as a spacer
  row has, so a column hidden for width goes from it too.
- **One table module owns TanStack's types,** so the rest of the client sees
  Tracks and callbacks only; the Filter panel is given plain choices and
  values.

## A song's menu

- **A "…" button holds a song's less frequent actions,** each an icon and
  words: *Play next* and *Add to queue*, *Go to artist* and *Go to album*, and
  *Add to playlist…*. Each song row has one, after its queue buttons, which a
  phone hides, since the menu holds them; the player has one beside the heart,
  without the queue actions.
- **A Track from a site** also has *Add the file yourself…*, which opens the
  dialog for adding its audio file by hand; a Track whose Download failed shows
  *Download failed* beside *Add the file…* in its row. See
  [Manual downloads](Manual%20downloads.md#the-web-client).
- **Go to** opens the artist's view, or the album's under its album artist, as
  the Albums view groups it.
- **Radix's dropdown menu** draws it: unstyled, it handles the arrow keys, Home
  and End, typeahead, Escape returning focus to the button, and keeping the
  menu on screen, and it draws in a portal, so a table row doesn't clip it. It
  was chosen over Headless UI, Ariakit, React Aria, and writing one: it passed
  every keyboard check in the spike, is the most used, and is the smallest of
  the four. One module owns it, as with TanStack.
- **Add to playlist** is a native modal `<dialog>`: it lists the Account's own
  plain Playlists, those already holding the song checked and disabled, and one
  or several are chosen. Naming a new Playlist adds it, chosen, but it is made
  only when the song is added, so Cancel leaves nothing behind. Adding puts each
  chosen Playlist whole with the song at its end, keeping its *Keep downloaded*;
  the Playlists the server saves show at once, and the dialog says why if it
  refuses one. Escape, Cancel, or a click outside close it. A notice above the
  player says where the song went.

## Now Playing

- **The song playing, over the whole screen:** its cover large, over the same
  cover blurred far past recognition, then its title, its artist and album as
  links to their views, the position with the time gone and left, the
  player's controls, the volume, and *Up next*.
- **It opens from the player's cover,** which shows on every width for that,
  or with F, and closes with Escape, its close button, F again, or by going to
  another view, as its artist and album links and its menu's *Go to* do.
- **Its own palette is light on dark,** whatever the theme: it sets the page's
  tokens inside itself, so the controls it shares with the player take white
  for the accent. Without a cover, the blur is a gradient of the theme's accent.
- **Paused, the cover settles back** a little, and grows again when the music
  plays; with reduced motion, it stays put and the view opens without rising.
- ***Up next*** shows the queue beside the song on a wide screen, and in the
  cover's place on a phone; Q opens and closes it there.
- **The shortcuts work while it is open,** though it is a modal `<dialog>`: it
  is marked `data-shortcuts`, which lets the keys through.

## Keyboard shortcuts

| Keys | Command |
| --- | --- |
| Space or K | Play or pause |
| ← and → | Back or ahead 5 seconds |
| Shift + ← and Shift + → | Previous and Next |
| - and = | Volume down and up, a mark at a time |
| M | Mute or unmute; changing the volume turns the sound back on |
| S, R, and L | Shuffle, Repeat, and favorite the song playing |
| / | Go to the search box |
| Q | Open or close *Up next*; where it is always open, go to it |
| F | Open or close Now Playing |
| Shift + / (?) | List the shortcuts |

- **Keys are physical keys,** as `KeyboardEvent.code` names them, so a shortcut
  sits in the same place on any keyboard layout; *?* is Shift and the */* key.
  A label names the key as the keyboard prints it, where the browser says
  (`navigator.keyboard.getLayoutMap()`, in Chromium), so the key a French
  keyboard prints *A* reads *A*; elsewhere, labels are a US keyboard's. A key
  held with Ctrl, Alt, or ⌘ is left to the browser unless a binding names that
  modifier.
- **A command has any number of keys,** none included, up to four.
- **The focused control keeps the keys it uses:** typing goes into a text box,
  an arrow moves a focused slider, and Space or Enter presses a button reached
  with the keyboard. A button focused by a click doesn't keep Space, so Space
  after clicking a song pauses it rather than playing it again. An open dialog
  or menu keeps every key, except Now Playing.
- **Holding a key** repeats seeking and the volume, but not the others, so
  holding Space doesn't flicker between play and pause.
- **A screen reader's browse mode** takes bare letters and arrows for itself,
  so the shortcuts work in its focus mode, as on any page.
- **A control names its keys** in its hover text, such as *Play (Space or K)*,
  and in `aria-keyshortcuts`. The header's keyboard button, or *?*, lists them
  all, with a link to change them; a phone, which has no keyboard, hides the
  button.
- **Holding ⌘** (Ctrl off Apple devices) on its own for a second shows the same
  list for a glance, until the key comes up. It is a dialog that isn't modal and
  takes no focus or clicks, so the key's release still reaches the page and
  nothing under it changes. A quick press never shows it, nor a shortcut made
  with the key, such as ⌘ + K: any other key while it is down cancels it until it
  comes up. It doesn't show while typing in a text box, or while the list's own
  dialog is open, and it closes when the window loses focus or the page is
  hidden, so switching apps with ⌘ + Tab can't leave it open. Settings turns it
  off; the choice is the browser's, kept in `localStorage`, since it belongs to
  the keyboard in front of it.
- **Changing a shortcut** is in Settings: each key of a command has a remove
  button, and *Add keys* waits for the next press, modifiers included, and adds
  it, unless another command has it, which it names, waiting for other keys.
  Escape, or moving away, adds nothing, and *Reset to defaults* puts every
  command back. Keys the browser or the system keeps, such as ⌘ + W or F5, are
  refused too, since the page would never see them or would take them from the
  browser.
- **The shortcuts are the Account's,** so they follow it to any browser or
  device: `GET` and `PUT /api/me/preferences` hold the commands changed from
  the defaults, at the revision read, and a command left on its defaults takes
  a new default when the page gains one. The server keeps the keys without
  knowing the commands. The page shows this browser's copy of the Account's
  at once, then the server's, and reads them again when it is shown. A save
  that finds them saved elsewhere since reads the revision and saves again: the
  change chosen last wins. A saved command on keys another command has, as when
  a new command's default is keys already saved, goes back to its default; the
  rest stay as saved.
- **react-hotkeys-hook** listens for them: it matches physical keys with their
  modifiers and leaves out form fields, and the page decides which keys a
  focused control keeps. It was chosen over tinykeys, hotkeys-js, and writing
  the listener: it is the most used, has no dependencies, and is a hook, so a
  listener comes and goes with the page. One module owns it, with one listener
  for each command.

## Search

<!-- cspell:ignore ｍｅｌｔ -->

- **One search box in the header,** with a scope toggle: *Library* or
  *Bilibili*. Bilibili shows only while the `bilibili` plugin is on. With it
  chosen, the box takes a link or a bare video code and *Enter* opens the add
  dialog; it doesn't search anything else. See
  [Manual downloads](Manual%20downloads.md#the-web-client).
- **Library search** matches the words typed, each anywhere in a Track's title,
  artist, or album, ignoring case, width, and hiragana or katakana: NFKC, lower
  case, and katakana shifted to hiragana, so `ｍｅｌｔ` finds *Melt* and
  `くじら` finds *クジラ*. Each Track's folded text is worked out once, when the
  list loads, and the search runs a moment after typing stops. The first search
  opens the results and later ones change them in place, so Back leaves the
  search in one step. The results show
  the matching Tracks in the song table, and the artists and albums whose names
  match.

## Favorites and ratings

- **A heart** marks a favorite, in a row and in the player.
- **Five stars** rate a Track in its row; choosing the rating already given
  clears it. A phone, which has no room for the rating column, rates from the
  player.
- Both use `PUT /api/tracks/{id}/favorite` and `PUT /api/tracks/{id}/rating`,
  which take an absolute value, so a retry is harmless.
- **An artist or an album is a favorite of its own,** by a heart beside its
  name on its page. A favorite one has a ring and a small heart on its tile in
  Artists, Albums, and search. An album is its album artist, else its artist,
  and its name, as the Albums view groups it; an artist or album with no name,
  or one named for a video's id, has no heart.
- **Several loved songs suggest the group:** 3 favorite songs, or 2 that are
  at least half of its songs, make the heart beat three times on landing, with
  a note such as *3 songs you love* that goes after 6 seconds unless the heart
  is pointed at or focused. Each artist and album is suggested once per Account
  in a browser, which remembers it in `localStorage`; reduced motion stills the
  beat.
- **They tune Radio and nothing else:** a song by a favorite artist or from a
  favorite album is liked a little more, as
  [Recommendations](Recommendations.md#how-songs-are-scored) says. They don't
  keep songs downloaded or put them in *Favorites*, which follow each song's
  own heart.
- **The server keeps each by name:** `GET /api/favorites` lists them,
  `PUT /api/artists/favorite` takes `{name, favorite}`, and
  `PUT /api/albums/favorite` takes `{artist, name, favorite}`; each answers with
  all of them, and each value is absolute. Names that differ only in case or
  width are one favorite, and one no longer in the Library stays until it is
  unfavorited. The client alone says which artist or album of the Library a
  name is, folding names as the views do.

## Settings

One view, in sections, each saved on its own:

- **Appearance:** the theme, the same choice as the header's switch; every
  switch on the page shows the one chosen.
- **Keyboard shortcuts:** each command's keys, and changing them; see
  [Keyboard shortcuts](#keyboard-shortcuts).
- **Network:** whether medleyplay is Online or Offline and why, the network the
  server is on, and how many downloads wait for Online, from the `mode` event
  and `GET /api/mode`; the setting and the metered networks, from `GET
  /api/mode/settings`. An admin chooses the setting, which saves at once, marks
  the network the server is on metered with a name, and removes a mark; a member
  sees them. See [Mode](Mode.md#the-web-client).
- **Downloads and storage:** what the Downloads, prepared copies, and Downloads
  under way use, against the limit or the free disk, and what kept Playlists
  want, from `GET /api/storage`; and the storage limit, from `GET` and `PUT
  /api/settings`. Sizes are in decimal units, as Finder shows them.
  - **An admin changes the limit:** no limit, or a size in GB. A moment after
    the size stops changing, the page asks `GET /api/storage?limit=` what that
    limit would remove, and says so before saving. Saving sends the revision
    read; if someone saved first, the page shows the settings as they are now.
  - **A member sees the limit** and what it holds, with nothing to change.
  - **The removal order** has one choice today, so it is said in a sentence
    rather than offered as a menu.
- **Later sections** come with their features: linked accounts, Libraries,
  Accounts, and plugins.

Each section folds under its heading, a button that says whether it is open;
which are folded is kept per browser. A bar of the section names stays under the header as the page scrolls:
choosing one opens that section, scrolls to it, and moves focus to its heading,
and its last button folds or opens them all.

## Listening on another device

- ***Listen on your device*** in the header opens a guide: the address to open
  on a phone, as a QR code to scan with its camera and as text with *Copy*, and
  the steps around it: join the same Wi-Fi, sign in as the same Account, and
  add it to the Home Screen.
- **The address is the server's on the network,** from `GET /api/addresses`:
  the names it answers to that another device can open, its IPv4 addresses
  first, then dotted names such as `mac-mini.local`, all on this page's port.
  Where the page itself was opened comes first when that is not this machine
  alone, since it already works. With several, each can be chosen; with none,
  the guide says to connect the computer to the phone's Wi-Fi.
- **The QR code is drawn as one SVG path,** dark on light in either theme, from
  [uqr](https://github.com/unjs/uqr)'s matrix, which only `qr.ts` imports. It
  was chosen over lean-qr and `qrcode-generator`, which encoded as well in a
  spike; each address the spike tried was decoded back by jsQR.
- ***Play on*** in the player, on a page that isn't on the computer, plays the
  music on the computer instead; see [Remote play](<Remote play.md>).

## Layout

| Width | Navigation | Queue |
| --- | --- | --- |
| Wider than 64rem | A rail on the left | A panel on the right |
| 48rem to 64rem | Tabs under the header | A panel opened from the player |
| Up to 48rem | A tab bar along the bottom, below the player | A sheet opened from the player |

A touch screen, which can't point, shows a row's actions all the time. The
page sizes itself to the dynamic viewport (`dvh`) and keeps the player and the
tab bar clear of the iPhone's home indicator (`env(safe-area-inset-bottom)`).

## Testing

- **Pure functions** for grouping, search, and the Favorites list, with Vitest.
- **The song table** in Vitest with virtualization off, since jsdom has no
  layout; Playwright scrolls a large Library in Chromium and checks that the
  page holds only the rows on screen.
- **Playwright** for moving between views, Back and Forward, search, favorites,
  ratings, the keyboard shortcuts, and Settings, at phone, tablet, and laptop
  widths. Whether a click or the keyboard focused a button differs only in a
  browser, so Space after a click is checked there.

## Left for later

- **Searching Bilibili by words** and the *Downloads* tab of Jobs.
- **Editing Playlists** from the client: renaming, reordering, and removing.
- **Loading Tracks page by page,** if a Library outgrows loading whole, and
  answering an unchanged list with a 304.
- **Recently liked,** which needs the server to record when a Track became a
  favorite.
- **Sorting by a second column,** through a menu that works on touch.
