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

**Interface language belongs to the device.** The page follows the browser's
language preferences until someone chooses English or Simplified Chinese at
sign-in or in Settings → Appearance. The choice updates the page without
reloading the player. The HTML language matches the active translation.
Interface messages use i18next; names, lyrics, and text entered by the
household are not translation keys. Screens without a translation use English.

- **The client loads the whole Library once:** `GET /api/tracks` when the page
  opens, keyed by id. Every view, sort, and search is worked out in the browser
  from that data, with pure functions, so moving between views asks the server
  nothing. Until the first answer, the Library shows rows shaped like songs, still
  under reduced motion, and tells a screen reader it is loading.
- **The first load comes in stages,** as the server answers one read faster than
  many at once, and reads sent beside the songs' made them wait:
  1. the songs and the favorites, alone;
  2. once the songs are drawn, the Playlists, the Mode, the Downloads under way,
     the features, and what each enricher may be asked about;
  3. once the browser is idle (or within two seconds), what only some views need:
     the artist names, the names to tidy, the split offers, and the names to split.
     These wait for the songs, and are read again as the songs change.
- **What opens only when asked for loads then:** Now Playing, the editors (details,
  an album, songs, lyrics), adding a link or a file, listening on another device,
  and the Insights, Settings, and Clean up views each load the first time they
  open, so the first page loads less script.
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
- **While a song plays,** the client prepares the album and artist song lists
  for it and the next queue entry. It asks the browser to prefetch their local
  heading pictures. Preparing the pages does not open them, ask an outside
  site, or start a Job to search for artwork.

## Views

Each view is a hash route, so Back, Forward, and a bookmark work, and a reload
keeps the view. The routes are a few lines of our own over `hashchange`, with
no router package.

| View | Route | Shows |
| --- | --- | --- |
| Library | `#/library`, `#/library?focus=<id>`, `#/library?artist=<name>`, `#/library?group=artist` | Every song and album, a split file's songs folded under it; see [The Library](#the-library). `artist` filters to the artist's songs by every name they are written by, `group` groups by a Group by choice; each is set once, then the address drops it |
| Radio | `#/radio` | *My station*, *Favorites*, and shelves of albums for the Account; see [Recommendations](Recommendations.md#the-radio-tab) |
| Artists | `#/artists` | Each artist, with how many Tracks and how long; one opens its Tracks |
| Albums | `#/albums`, `#/albums?artist=<name>` | Each album, under its album artist, or its artist when that is blank; `artist` keeps the albums the artist sings on, by any name it goes by, with a chip that removes it |
| Playlists | `#/playlists` | *Favorites* first, then the Account's Playlists |
| Downloaded | `#/downloaded` | The songs downloading, each with its state and a bar, then the Tracks with `downloaded`, in the song table |
| Search | `#/search?q=…` | What the search found |
| Settings | `#/settings`, `#/settings?section=ai` | See [Settings](#settings); `section` opens and goes to the section of that id |
| Clean up | `#/clean-up` | The Library's names that could read better: to [tidy](<Track details.md>), to [split into the artists they list](Artists.md#names-written-as-several-artists), and to [link to one artist](Artists.md#the-web-client); and long files to [split by the list found](Segments.md#split-offers) |

- **An artist's or album's Tracks** open at `#/artist?id=…&name=…` and
  `#/album?artist=…&name=…`, in the song table, so a name with a `/` is safe. An
  artist opens by the id of the Library's artist, headed by the name most of its
  songs write; with no id, or one no song is bound to any more, by the name, so
  `#/artist?name=…` links made before ids still open.
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
- **Clean up sits under Insights** in the rail, set in, with how many names and
  long files wait, named *N to clean up*, rather than as a row in each view those names show in: both are about
  the Library itself, where Settings is about how medleyplay behaves. A phone's
  tab bar has no room for a ninth tab, so there Insights carries the count, and
  its page opens with *Clean up 37 names*. Each kind of change is a section headed by its
  name, how many wait, and its action for all of them: *Tidy all*, which tidies
  the names listed in one request, *Look up 24 names*, and *Split all*. A bar above the
  sections goes to each, with its count or a check once done; the sections with
  names waiting come first. Within *Link artist names*, what can be done now
  comes first: a name with a recommendation to link, then one with artists to
  choose from, then one still to look up, and the names linked or kept apart
  last.
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
  asks for the Tracks again, so their kinds show at once. Beneath it, *Split
  albums*: *Off*, *Ask first*, or *Auto*, each saying what it does
  ([Split offers](Segments.md#split-offers)).
- **A split file's songs fold under it,** behind a caret named *Show the songs
  of 生如夏花*, which states `aria-expanded`; its songs are set in under it,
  with smaller covers, on a guide that runs down from the caret and turns into
  the last song. The
  table keeps `role="table"` with a disclosure button rather than a treegrid,
  which would promise arrow-key moves between cells. Sorting sorts the songs
  under each file too; a filter keeps a file while it keeps any of its songs,
  showing only those. Grouped, the table lists every song in its file's place,
  as other tables do.
- **Clicking the album row plays the whole file**, folded or expanded. Clicking
  a song under it plays just that song in the album's place in the queue.
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
  name are two groups. Groups keep the order their first song has, and *Play
  all* plays every group's songs, folded or open. A group's row has a cell per
  column, as a spacer row has, so a column hidden for width goes from it too.
- **Expand all** and **Collapse all**, one button beside *Group by*, open or
  fold every group, or every split file's songs when nothing is grouped. It
  shows only when something folds. This browser keeps the last choice
  (`medleyplay.folds`) and folds start that way, including when the grouping
  changes; until one is chosen, groups open when made and a split file's songs
  stay folded.
- **One table module owns TanStack's types,** so the rest of the client sees
  Tracks and callbacks only; the Filter panel is given plain choices and
  values.

## A song's menu

- **A "…" button holds a song's less frequent actions,** each an icon and
  words: *Play next* and *Add to queue*, *Go to artist* and *Go to album*,
  *Show in Library*, *Rate*, and *Add to playlist…*. Each song row has one, after its queue buttons, which a
  phone hides, since the menu holds them; the player has one beside the heart,
  without the queue actions.
- **A Track from a site** also has *Add the file yourself…*, which opens the
  dialog for adding its audio file by hand; a Track whose Download failed shows
  a warning mark in its row, named *Download failed*, which opens why, *Retry
  download*, and *Add the file…*. See
  [Manual downloads](Manual%20downloads.md#the-web-client).
- **A Track downloading says so in its row,** from the moment it is added: where a
  Track that can't play says why, a download mark and how far it has got (*42%*,
  *Waiting*, *When online*), said in full in its tooltip and to a screen reader;
  its cover spins, or shows a clock while it waits for Online.
- **A narrow table keeps the title readable:** below 64rem it keeps only a row's
  "…", which holds *Play next* and *Add to queue* too; below 52rem the album goes.
- **Go to** opens the artist's view, or the album's under its album artist, as
  the Albums view groups it.
- **Show in Library** opens `#/library?focus=<id>`: the Library clears its
  filters if they hide the song, unfolds the file it was split from, scrolls it
  to the middle, focuses its title, and lights the row for a moment. Once shown,
  the address drops `focus`, so going back doesn't scroll again.
- **Rate** opens a submenu of five stars down to one, and *No rating*, the
  song's own rating checked; it is saved at once, as the stars in a row are.
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
  player's controls, the volume, *Lyrics*, and *Up next*. Beside it show the song's
  lyrics, or *Up next* when it is open ([Lyrics](Lyrics.md#showing-them)).
- **It opens from the player's cover,** which shows on every width for that,
  or with F, and closes with Escape, its close button, F again, or by going to
  another view, as its artist and album links and its menu's *Go to* do.
- **Its own palette is light on dark,** whatever the theme: it sets the page's
  tokens inside itself, so the controls it shares with the player take white
  for the accent. Without a cover, the blur is a gradient of the theme's accent.
- **Paused, the cover settles back** a little, and grows again when the music
  plays; with reduced motion, it stays put and the view opens without rising.
- **Dynamics move the cover behind it,** one of three effects chosen in
  Settings, drawn by a shader over a blurred 160-pixel copy of the cover, fine
  enough to blend smoothly as it moves: *Flow*, three turning copies blended through slow
  noise, as Apple Music's background moves; *Drift*, two enlarged copies turning
  against each other; and *Mesh*, five colors of the cover's palette as lights
  wandering. Or *Off*, the still blur.
  - **Smooth, and still cheap:** the canvas is drawn on every frame the display
    shows, at half the page's resolution, and not at all while the page is hidden; the
    WebGL library and shaders, 16 KB gzipped, load only when Now Playing shows
    an effect. A new cover fades in over the last.
  - **It fades in once drawn,** over the still blur, so without WebGL 2 the blur
    shows as before; with reduced motion the effect is drawn still, once a cover.
  <!-- cspell:ignore AMLL Vanta Granim -->
  - **ogl draws it,** chosen over the libraries that do similar: the one
    drawing Apple Music's own background, from AMLL, is AGPL; ShaderGradient
    draws a glossy gradient of three colors, not the cover, at 273 KB gzipped
    with three.js, and broke on the current three.js; Vanta and Granim have had
    no release since 2022. ogl, in the public domain with no dependencies, gives
    the WebGL plumbing; the effects are ours.
- ***Up next*** shows the queue beside the song on a wide screen, and in the
  cover's place on a phone; Q opens and closes it there.
- **The shortcuts work while it is open,** though it is a modal `<dialog>`: it
  is marked `data-shortcuts`, which lets the keys through.

## Keyboard shortcuts

| Keys | Command |
| --- | --- |
| Space or K | Play or pause |
| ← and → | Back or ahead 5 seconds |
| Shift + ← and Shift + → | Previous and Next song; past an album's first or last song, on by album |
| Alt + Shift + ← and Alt + Shift + → | Previous and Next album |
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
- **A control names its keys** in its tooltip, its name then each key as a cap of
  its own (the modifiers as ⇧ ⌥ ⌃ ⌘ on Apple devices, as words elsewhere), and in
  `aria-keyshortcuts`; a screen reader hears *Play (Space or K)*. Radix's tooltip
  draws it, after a short rest of the pointer or when the control is reached with
  the keyboard; the search box's shows on hover alone, so it never covers what is
  typed. The header's keyboard button, or *?*, lists them
  all, with a link to change them; a phone, which has no keyboard, hides the
  button.
- **Holding ⌘** (Ctrl off Apple devices) on its own for a second and a half shows the same
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

<!-- cspell:ignore ｍｅｌｔ beatls -->

- **One search box in the header,** taking its room as on an iPad, with a scope
  toggle at its end: *Library*, shown as its icon in the rail, or Bilibili, shown
  as its mark, each named on hover and to a screen reader. Bilibili shows only while the `bilibili` plugin is
  on. With it
  chosen, the box takes a link or a bare video code and *Enter* opens the add
  dialog; it doesn't search anything else. See
  [Manual downloads](Manual%20downloads.md#the-web-client).
- **Typing `bilibili:` chooses Bilibili,** as its toggle does, at a word's start
  in the box; what follows it stays typed, so `bilibili:BV1…` pasted is ready for
  *Enter*. The tags listed in an empty box end with it, and Backspace in an empty
  box with Bilibili chosen goes back to the Library, as it removes a tag.
- **A word being typed completes to a tag or a site** it begins, from its second
  letter: `bi` offers `bilibili:` (where Bilibili can be searched) and `ar`
  offers `artist:`, first in the panel, above the artists. Choosing one is typing
  it in full, keeping the words before it; *Tab* takes the first, or the one the
  arrow keys point at. One letter offers nothing, as it begins too many names.
- **Library search** matches the words typed, each anywhere in a Track's title,
  artist, or album, ignoring case, width, and hiragana or katakana: NFKC, lower
  case, and katakana shifted to hiragana, so `ｍｅｌｔ` finds *Melt* and
  `くじら` finds *クジラ*. Each Track's folded text is worked out once, when the
  list loads, and the search runs a moment after typing stops. The first search
  opens the results and later ones change them in place, so Back leaves the
  search in one step. The results show
  the matching Tracks in the song table, and the artists and albums whose names
  match.
- **Close first, then loose.** Names holding every word side by side come
  first, in Library order; then names holding the letters in order with some
  left out, best first, so `beatls` finds *The Beatles*. fuzzysort scores the
  loose matches, each name on its own, and one scoring under 0.32 is left out,
  so `jay` finds *Jay Chou* but not *Jealousy*. Fewer than three letters match
  only side by side. fuzzysort was chosen as small, without dependencies, and
  fast enough to run on every keystroke; one module owns it.
- **Tags** narrow a search to one field. `artist:Jay` keeps the songs whose
  artist or album artist is close to *Jay* (side by side, or loosely when no
  name is), and the words then search among them; a value with a space is
  quoted, as `artist:"Jay Chou"`. The fields:

  | Tag | Keeps |
  | --- | --- |
  | `artist:` | Songs by a close artist or album artist, by any name it goes by |
  | `album:` | Songs on a close album |
  | `song:` | Songs with a close title |
  | `kind:` | Only `songs`, `albums`, or `artists` among the results |
  | `rating:` | Songs you rated at least so many stars, or whose album you did |
  | `favorite:` | Songs with a heart (`yes`) or without (`no`) |

- **A tag typed becomes a capsule** in the box: typing `artist:` shows
  *Artist:*, and what follows is its value until *Enter* keeps it and the box
  takes plain words again. *Backspace* at the start chooses the capsule before
  the caret, outlined, and a second removes it (a held key doesn't); each
  capsule also has its own remove button. Words typed before a tag return to
  the box. The box's clear button, or *Escape*, empties it, capsules and all,
  in place of the browser's own clear, which left the capsules behind. Tags
  pasted in become capsules too. The capsules describe the box to a screen
  reader, and choosing or removing one is announced. The search's text, tags
  written out, is what `#/search?q=` holds, so a link or Back shows the same
  capsules, and the results are titled by them, as *Results for Artist: Jay
  Chou, “love”*.
- **Suggestions as you type.** Under the box, a panel offers up to three artists
  the search names: its `artist:` tag's value, or else its words, found as the
  search finds artists, by any name. Each row goes to the artist's page, and
  its *Songs* and *Albums* show the Library filtered to its songs, or the albums
  it sings on, by every name its songs are written by, as its page counts them. Last, *Group the Library by artist*.
  Choosing one leaves the search and empties the box. The box is a combobox:
  the arrow keys move through the choices, *Enter* takes the one pointed at,
  and *Escape* closes the panel before it clears the box. On a phone the *Songs*
  and *Albums* chips show their icons alone.
- **The tags, when the box is empty:** resting the pointer on it a moment, or
  pressing ↓ in it, lists each tag with what its value is; choosing one starts
  that tag in the box.
- **Artists and albums found are whole:** one is listed, with all its songs,
  when a song the tags keep is its, so `rating:4` lists albums with their full
  counts; under `artist:`, only the artists the tag names are listed. A `kind:`
  value it doesn't know, as one still being typed, is ignored.

## Favorites and ratings

- **A filled heart** marks a favorite, in a row and in the player. Hovering over
  a Library row or focusing a control in it shows an empty heart in the accent
  color if the song is not a favorite. On touch screens the heart stays visible.
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
- **The server keeps artists by id, albums by name:** `GET /api/favorites` lists
  them, `PUT /api/favorites/artists/{id}` takes `{favorite}` for one of the
  Library's artists, and `PUT /api/albums/favorite` takes `{artist, name,
  favorite}`; each answers with all of them, and each value is absolute. A heart
  names an artist as written, and the client sends the id its songs are bound to.
  Album names that differ only in case or width are one favorite, and one no
  longer in the Library stays until it is unfavorited; the client says which
  album of the Library a name is, folding names as the views do.

## Settings

One view, in sections, each saved on its own:

- **Appearance:** the theme, the same choice as the header's switch; every
  switch on the page shows the one chosen. *Dynamics*, what moves behind Now
  Playing, kept per browser like the theme, as a device's graphics and battery
  are its own: *Off*, *Flow* (the default), *Drift*, or *Mesh*, saying what the
  chosen one shows. And the accent color, jade unless
  this browser chose another: a swatch opens react-colorful's color square and
  hue slider, a field takes a hex code, the dice roll a hue as strong as jade,
  and *Back to jade* forgets the choice.
  - **One color, a shade per scheme.** The chosen color is moved in OKLCH
    lightness only, keeping its hue, until it reads on each card: darkened to
    4.5:1 on light, lightened to 6.5:1 on dark; one that already does is left as
    chosen. The ink on it is white or a near-black of its hue, whichever reads
    better. `accent.ts` writes the four shades as `--chosen-accent-*` on the root
    before the first render, and the schemes' `--accent` tokens read them before
    falling back to jade; `--accent-soft` mixes from `--accent`, so it follows.
  - **Kept per browser,** like the theme, since how a screen looks belongs to
    the screen.
  - **Colors to choose again.** The heart saves the color shown among up to 10
    small tiles, the newest first; saving one more forgets the oldest, and the
    heart pressed again forgets the color shown. A tile uses its color; pointed
    at or focused, it shows a large swatch with its hex, in white or black,
    whichever reads on it. They are kept per browser, beside the accent.
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
and its last button folds or opens them all. A link that names a section, such as
`#/settings?section=ai`, does the same on arrival.

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

Wider than 64rem, the rail sits on a surface of its own with a soft shadow,
quieter than Up next's, and the wordmark above it takes its width, so the search
starts where the page does. The view shown is lit as a pill set in from the
rail's edges. Two controls sit at the rail's top right, and each browser
remembers both choices:

- **Icons or names.** The rail collapses to its icons, each naming its view on
  hover, with Clean up's count on its icon.
- **Minimize or show it whole.** Minimized, the rail is one line above the view,
  the view shown and the way back; the view takes the rail's column. The view
  shown opens a menu of every view, with Clean up's count and, at its foot, who
  is signed in and *Sign out*. A view headed by its own name in the rail, as
  *Library* is, then leaves its heading to that menu: the heading stays for a
  screen reader, and what the view says under it shows under the menu. A view
  with a name of its own, as an artist's, keeps its heading.

**The order of the views** is each browser's own too: Library, Artists, Albums,
Radio, Playlists, Downloaded, and Insights until it chooses another. Clean up stays
under Insights and Settings stays last. A mouse drags a view to another place once
it has moved a few pixels, and a finger once it has held a moment, so a click or a
tap still opens the view; the click that ends a drag opens nothing. Settings ›
Appearance lists the same views with a handle to drag, *Move up*, *Move down*, and
*Reset order*, which is also how a keyboard moves them: in the rail, Enter on a view
opens it. Dragging uses `@dnd-kit`, as the songs editor does.

Who is signed in sits at the rail's foot, as a round initial and the name,
opening a menu with *Sign out*; the header leaves them out. Narrower, where
there is no rail, the same menu sits in the header instead, as only the initial
on a phone.

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
