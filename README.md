# Tactics Board for Supernote

A coach's whiteboard plugin for Supernote. Draw runs and passes on the note
page with your pen, and drag players, cones and balls onto it from a floating
button that stays out of the way while you write.

![Tactics Board: a rondo drill, with the floating button and its pieces](docs/board.png)

## How it works

- **The floating button** is a small round chip over the note, like
  Modulanner's, switched on with the toggle at the top of the menu. It comes
  up when the menu closes. The pen keeps writing everywhere around it, and
  there's no mode to switch:

  | On the button | What it does |
  |---|---|
  | Tap | Opens or closes the palette of pieces below it: Team X player, Team O player, cone, ball. |
  | Drag | Moves the button. The palette goes with it, and the spot is remembered. |
  | Hold (0.8 s) | Opens the menu. |

- **Placing and moving pieces.** Drag a piece out of the palette and a new one
  is placed where you let go. Drag a piece that's already on the page and it
  moves. Drop a piece on the button or the palette to remove it. All of it
  works with the pen or a finger.
- **The pen doesn't write while it drags.** The pen writes into the note
  through the digitizer, whatever window it's over, so a pen drag on the
  button, the palette or a piece would draw a line. For the length of a pen
  drag the pen is locked, the way the Supernote plugin notes describe (the
  plugin's view goes to state 1, which makes the Note app turn the pen off,
  and back to state 0 at the drop); the screen may flash as it does. Any
  stroke that still gets through, begun before the lock lands, is erased
  after the drop: the SDK's `event_pen_up` hands over each finished stroke,
  and one that ends during a pen drag, or within 2.5 s of it, is deleted.
  Only strokes, and only those. The lock can be switched off in the menu;
  the erasing always happens.
- **Pieces are real note shapes**, lines, circles and polygons drawn by the
  Note app. They're told apart by shape, not colour, for the greyscale screen,
  and they stay on the page after the plugin closes. They go on a layer
  named "Pieces", which the first drop on a page adds (while the page has one
  of its three custom layers free; otherwise the main layer), so the pieces
  and the drawing can be erased apart. Adding it doesn't change the layer
  you're writing on. A piece placed before its page had the layer moves onto
  it the next time it's moved.
- **Each piece is one or two elements** (the X's bars cross): the Note app
  takes ~60 ms to insert each, so the solid shapes are drawn as one line
  that zigzags or spirals to fill them. A dropped piece stays on screen where
  it landed until the note has drawn it.
- **The menu** (hold the button, or open **Tactics Board** from the Note
  toolbar) is a popout, two thirds of the screen each way, with the note
  still showing around it; tap outside it to close it. It has saving, the
  saved layouts and the setup (Copy is on the palette):

  | Section | What it does |
  |---|---|
  | Floating button | The on/off toggle. Below it, what's stopping the button if something is: a build without its native code, or Android not allowing the plugin host to display over other apps (with a button to that setting). |
  | Save this page | Saves the whole page, background, drawing and pieces, under a name. A drawing with no pieces is fine: a base to start from. Saving under an existing name replaces it. |
  | Saved layouts | **New page** adds a copy of the saved page after the one you're on. The ▾ beside a layout lists its previous versions, with **Restore**; deleting a layout deletes them too. The heading's own ▾ folds the list away. |
  | Storage | The size of `EXPORT/SNTacticsBoard/`, **Clean up now**, and **Clean up automatically** (after each Save, Load and Reset). Both ask for permission to delete files first. |

  New pages come after the one you're on. Where the firmware can't go to a
  page by itself (`jumpToPage` arrived with the 2026-08-24 plugin firmware),
  the message says which page it is so you can turn to it.

- **Saved layouts live in a note**, `EXPORT/SNTacticsBoard/Layouts.note`, one page
  per layout, copied in and out the way Copy page copies. Each page is tagged
  with a keyword, `~BOARD:<template>:<name>`, and found by it:
  `~BOARD:Futsal Court:Rondo 4v2` is "Rondo 4v2" on a page whose background
  is "Futsal Court". The template part is the name of the page's background:
  a built-in template's name ("Dot Grid") or a custom template's file name.
  Previous versions are pages tagged `~OLD:<name>:<time>`. The `~` sorts the
  tags after your own keywords.

  So the note can be opened, reordered and edited in the Note app. Each time
  the menu closes, the list catches up with it: a page deleted there drops off
  the list, and a page you tag `~BOARD:<template>:<name>` there joins it.

- **Permissions.** Tactics Board declares `plugin.permission.FILE:READ`,
  `FILE:WRITE` and `FILE:DELETE` in `PluginConfig.json`, because it saves page
  backgrounds for copies and the layouts note in `EXPORT/SNTacticsBoard/`, and
  can clean them up. Delete is only asked for by a clean-up. The menu asks for
  read and write when it
  opens; choose **Always allow**, since "this time only" lapses when the
  plugin closes. Without them, Copy and Save are held back and the menu
  offers to ask again. Placing, moving and saving layouts don't need them. The
  floating button separately needs Android's "Display over other apps" for
  the plugin host.

## Roadmap

- **Your own pieces.** Replace or add to the four built-in pieces with your
  own images or drawings: lasso something drawn on a page (or pick an image)
  and save it as a piece, then drag it out of the palette like the others. It
  would be kept as elements or a sticker (`saveStickerByLasso`), shown in the
  palette as a thumbnail, and placed by copying its elements to where it's
  dropped; its handle and tag would work as the built-in pieces' do.
- **Field templates.** A set of field backgrounds for different sports, to
  start a page from.
- **Turned pages.** Placing and moving on a rotated screen, once the
  screen-to-page mapping is measured on a device.

## How it's built

| Path | What it is |
|---|---|
| `index.js` | Registers the menu, starts the button's controller, adds the NOTE toolbar button |
| `App.tsx` | The menu: button setup, saving, layouts, storage |
| `android/.../palette/` | The button, palette and piece handles in Kotlin, each a small system overlay window (`TacticsPaletteModule`, registered in `MainApplication`) |
| `src/palette/controller.ts` | Turns button events into page edits, one at a time, and keeps the handles on the page showing |
| `src/layouts/layoutStore.ts` | The saved-layouts list in AsyncStorage; the pages themselves are in the layouts note |
| `src/page/pageOps.ts` | Place, move, remove and replace pieces; copy a page; save to and load from the layouts note |
| `src/page/pieceShapes.ts` | Each piece as note geometry, and the `userData` tag that identifies it |
| `src/page/boards.ts` | Named pages, versions, replacing a page in place, the page label |
| `src/page/cleanup.ts` | Clean up: spare background PNGs and leftover layouts-note pages |

**Why the pen can still write around the button.** Each window is only as big
as what it draws: the button, the open palette, and one invisible *handle*
exactly over each piece on the current page. A window takes the touches that
land on it and lets every other touch through to the note (Modulanner's
arrangement, `FLAG_NOT_TOUCH_MODAL`). So the pen writes anywhere that isn't a
piece or the button, and dragging a piece needs no mode. While a piece is
dragged, its handle draws it and a white patch hides the old spot until the
note has been updated.

**Following the page.** With the menu closed the host suspends JS timers, so
the native module sends a tick every second instead. On each tick the
controller checks the page and file and, when either changed, reads the
pieces and lays the handles out again. Away from a note, the handles come
down.

The page work follows what the Modulanner plugin established on devices:

- Every page edit runs with the menu **closed**, because SDK calls can
  deadlock while it's open. The button and handles come down while the menu
  is open and back when it closes. The host's `plugin_life` events say when
  the menu opens (`start`) and when the host closes it (`stop`); for the
  plugin's own close there's no event, so the button is put back up just
  before `closePluginView()`, as Modulanner's is. Saving a layout uses the pieces the
  controller last read, since the menu can't read the note itself.
- `saveCurrentNote()` runs before a page is inserted, or strokes still on
  screen are lost.
- `insertNotePage`'s `page` is the index the new page takes, and a PNG path
  works as its template.
- Only an explicit `success: false` is a failure. Older firmware answers
  `null` from calls that worked.
- Pieces are tagged with `userData`. Some firmware drops it, so every write is
  also recorded per page in AsyncStorage, and untagged shapes that match a
  recorded piece exactly count as that piece. The user's own drawing is never
  touched.

## Build

Requirements are those of the Supernote template: Node 18+, JDK 19+, Android
SDK 35, and React Native **0.79.2** (locked to the PluginHost runtime).

```bash
npm install
npm run build:plugin          # -> build/outputs/tacticsboard.snplg
```

`build:plugin` runs Gradle's autolinking step and then the template's
`buildPlugin.sh`, or `buildPlugin.ps1` on Windows. The plugin carries native
code (the floating button, AsyncStorage and ViewShot), which `buildPlugin` compiles into
`app.npk` and lists in `PluginConfig.json`'s `reactPackages`. It reads the
autolinked part of that list from Gradle output that doesn't exist on a clean
checkout, so running `buildPlugin` directly the first time produces a plugin
that fails on launch; running it a second time also fixes that.

Install on the device:

```bash
adb push build/outputs/tacticsboard.snplg /storage/emulated/0/MyStyle/
# Then on the device: Settings → Apps → Plugins → Add Plugin
```

### Device loop (Windows)

Scripts adapted from
[Ziv-Ink/supernote-plugin-template](https://github.com/Ziv-Ink/supernote-plugin-template)
for Windows PowerShell 5.1. Point them at the device in a gitignored
`devconfig.json` (a wifi `host:port` is connected automatically):

```json
{ "device": "192.168.86.52:5555" }
```

| Command | What it does |
|---|---|
| `npm run deploy` | Build, push to `MyStyle/` (skipped when unchanged), and install through the Plugin Manager by UI automation. `-- -SkipBuild` reuses the last build. |
| `npm run run` | Open NOTE and launch Tactics Board from the toolbar. |
| `npm run deploy:run` | Both in turn. |
| `npm run logs` | Stream `TacticsPalette`, `ReactNativeJS`, `PluginHost` and `SNPlugin`. `-- -Clear`, `-- -Dump`. |

The UI automation matches English labels. The template's `send` (a JS-only
hot install through PluginHost's `plugin.action.DEBUG` broadcast) is left
out: on PluginHost 1.00.26009090 the receiver reads the broadcast's extras
and returns without installing anything, so every change goes through
`deploy`.

`PluginConfig.json` is committed with a fixed `pluginID`. Keep it unchanged
once the plugin has been shared, because the device identifies plugins by that
ID.

## Preview in a browser

`tools/ui-preview` is a copy of
[sn-plugin-ui-preview](https://github.com/firestormkirby/sn-plugin-ui-preview)
extended with a simulated note. It runs the real menu and the real controller
against an in-memory note. A web stand-in for the native windows
(`tools/ui-preview/tactics/WebPalette.tsx`) has the same sizes and rules and
sends the same events as the Kotlin one. The mouse is the pen anywhere else on
the page. Like a device's page, the simulated one has no toolbar: Page Up /
Page Down turn the page and P opens the menu.

```bash
npm run preview:install       # once
npm run preview               # http://localhost:5178
```

Scenarios: *Drawing a drill*, *The menu*, *First run*, *Button allowed*,
*Blank note* and *In a PDF*. The browser console logs every SDK call. The
preview can't reproduce the device's pen hardware, SDK threading or real file
writes.

## Develop

```bash
npm test           # piece shapes, page operations (with and without userData), layouts, controller, menu
npm run typecheck
npm run lint
```

The Kotlin was compiled against the Android framework and React Native
0.79.2's signatures, but it hasn't run on a device yet.

## To check on the first device install

- **The button appears** when the toggle is on and the menu closes, and
  stays over the note. If it doesn't, the menu says why under the toggle next
  time it opens; for the full story, capture the log while switching it on and
  closing the menu:

  ```bash
  adb logcat -c
  # switch the button on, close the menu, wait a few seconds
  adb logcat -d -s TacticsPalette:V ReactNativeJS:V
  ```

  `TacticsPalette` lines come from the native side (`canDrawOverlays`,
  `show: button at …`); `[tactics]` lines from the JS side (`menu open`,
  `menu closed`, `button: show -> …`). If neither appears, the build is
  missing the native module: check that the built `PluginConfig.json` lists
  `com.tacticsboard.palette.TacticsPalettePackage` in `reactPackages` and the
  `.snplg` holds an `app.npk`.
- **Saved layouts.** Save a page, check `EXPORT/SNTacticsBoard/Layouts.note` gets a
  page (`createNote` makes it the first time) with its `~BOARD:…` keyword in
  the Note app's keyword list, then New page brings it back.
- **The popout menu.** The note should show around the menu. If the host
  paints the plugin's window white regardless, the card still works; only the
  see-through part is lost.
- **File permission.** The menu's first open should show the host's
  permission dialog for file access. After "Always allow", Copy page and
  Save should work from the background once the menu closes. Check that
  "this time only" still covers that close.
- **Drops.** A dropped piece should appear where it's let go. If it
  vanishes, the log says how far it got: `[tactics] drop: … at screen`,
  then `drop: placed …` once it's on the page. A message on screen says what
  went wrong, and if the note never answers, the plugin gives up after ten
  seconds and says so, rather than silently holding up every later drop.
- **The pen lock.** Drag the button and a piece with the pen: `TacticsPalette`
  should log `pen lock: plugin state 1` then `0`, `[tactics] pen locked` /
  `unlocked`, and no line should be left behind (`pen: removed … stroke(s)`
  when one got through and was erased). If the menu flashes up during a drag,
  or the lock logs `no pluginApp field` / `no showPluginView(int)`, switch
  the lock off in the menu; the erasing still works without it.
- **Writing next to a piece** still writes. A handle covers only the middle
  of its piece (45% of the piece box for the ball, 65-70% for the others),
  and grows to the whole piece only while it's carrying it.
- **Pieces look right.** Geometry `penWidth` units aren't documented. The
  pieces use 300, and their solid shapes are nested outlines 3px apart. If
  they come out hairline or blobby, tune `PIECE_PEN.width` in
  `src/page/pieceShapes.ts`.
- **Handles line up with the pieces.** The mapping assumes the page fills the
  screen at 1:1, as Modulanner measured on a Manta.
- **Moving and removing find the pieces.** Check the log for
  `insertPageElements` / `batchUpdatePageElements` results, and whether
  `userData` survives (if not, the AsyncStorage fallback takes over).
- **Copy page** carries drawings over (`insertElements` with elements read
  from the source page).
- **Rotation.** Placing and moving are limited to the upright screen for now,
  and the button says so when turned. Turned pages need the screen-to-page
  mapping measured on a device.

## Contact

Bug reports and feature requests: sebastiancraftco@gmail.com
