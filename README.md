# SNSoccer: Soccer Board for Supernote

A coach's whiteboard plugin for Supernote. Draw runs and passes on the note
page with your pen, and drag players, cones and balls onto it from a floating
button that stays out of the way while you write.

![Soccer Board: a rondo drill on a pitch page, with the floating button and its pieces](docs/board.png)

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
- **Pieces are real note shapes**, lines, circles and polygons drawn by the
  Note app. They're told apart by shape, not colour, for the greyscale screen,
  and they stay on the page after the plugin closes. On pitch pages they go on
  their own "Pieces" layer; you write on the main layer, so the native lasso
  and eraser there leave them alone.
- **The menu** (hold the button, or open **Soccer Board** from the Note
  toolbar) has the two exports and the setup:

  | Section | What it does |
  |---|---|
  | Floating button | The on/off toggle. Below it, what's stopping the button if something is: a build without its native code, or Android not allowing the plugin host to display over other apps (with a button to that setting). |
  | Copy this page | Copies the page, background, drawing and pieces, to a new page after it, all still editable. Good for drill progressions. |
  | Save this page | Saves the whole page, background, drawing and pieces, under a name. A drawing with no pieces is fine: a base to start from. Saving under an existing name replaces it. |
  | Saved layouts | **New page** adds a copy of the saved page after the one you're on. **Pieces here** swaps the pieces on this page for the saved ones and keeps your drawing; piece positions are kept as fractions of the page, so they land in the same places on any device. |
  | Pitch pages | Adds a page after this one with a regulation pitch as its background, goals at the top and bottom, and goes to it. Pieces can go on any page, not just pitch pages. |

  New pages come after the one you're on. Where the firmware can't go to a
  page by itself (`jumpToPage` arrived with the 2026-08-24 plugin firmware),
  the message says which page it is so you can turn to it.

- **Saved layouts live in a note**, `EXPORT/SNSoccer/Layouts.note`, one page
  per layout, copied in and out the way Copy page copies. Opening it to look
  is fine, but leave its pages in order: the list in the menu points at them
  by position.

  The first time it opens, the menu draws the pitch background.

- **Permissions.** Soccer Board declares `plugin.permission.FILE:READ` and
  `FILE:WRITE` in `PluginConfig.json`, because it saves the pitch background
  page copies and the layouts note in `EXPORT/SNSoccer/`. The menu asks for them when it
  opens; choose **Always allow**, since "this time only" lapses when the
  plugin closes. Without them, Copy and Pitch pages are held back and the menu
  offers to ask again. Placing, moving and saving layouts don't need them. The
  floating button separately needs Android's "Display over other apps" for
  the plugin host.

## How it's built

| Path | What it is |
|---|---|
| `index.js` | Registers the menu, starts the button's controller, adds the NOTE toolbar button |
| `App.tsx` | The menu: copy, layouts, pitch pages, button setup, pitch preparation |
| `android/.../palette/` | The button, palette and piece handles in Kotlin, each a small system overlay window (`SoccerPaletteModule`, registered in `MainApplication`) |
| `src/palette/controller.ts` | Turns button events into page edits, one at a time, and keeps the handles on the page showing |
| `src/layouts/layoutStore.ts` | The saved-layouts list in AsyncStorage; the pages themselves are in the layouts note |
| `src/page/pageOps.ts` | Place, move, remove and replace pieces; copy a page; add a pitch page; save to and load from the layouts note |
| `src/page/pieceShapes.ts` | Each piece as note geometry, and the `userData` tag that identifies it |
| `src/page/capture.ts`, `src/components/PitchSheet.tsx` | Drawing and saving the pitch background |

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
npm run build:plugin          # -> build/outputs/snsoccer.snplg
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
adb push build/outputs/snsoccer.snplg /storage/emulated/0/MyStyle/
# Then on the device: Settings → Apps → Plugins → Add Plugin
```

`PluginConfig.json` is committed with a fixed `pluginID`. Keep it unchanged
once the plugin has been shared, because the device identifies plugins by that
ID.

## Preview in a browser

`tools/ui-preview` is a copy of
[sn-plugin-ui-preview](https://github.com/firestormkirby/sn-plugin-ui-preview)
extended with a simulated note. It runs the real menu and the real controller
against an in-memory note. A web stand-in for the native windows
(`tools/ui-preview/soccer/WebPalette.tsx`) has the same sizes and rules and
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
  adb logcat -d -s SoccerPalette:V ReactNativeJS:V
  ```

  `SoccerPalette` lines come from the native side (`canDrawOverlays`,
  `show: button at …`); `[snsoccer]` lines from the JS side (`menu open`,
  `menu closed`, `button: show -> …`). If neither appears, the build is
  missing the native module: check that the built `PluginConfig.json` lists
  `com.snsoccer.palette.SoccerPalettePackage` in `reactPackages` and the
  `.snplg` holds an `app.npk`.
- **Saved layouts.** Save a page, check `EXPORT/SNSoccer/Layouts.note` gets a
  page (`createNote` makes it the first time), then New page brings it back.
- **File permission.** The menu's first open should show the host's
  permission dialog for file access. After "Always allow", Copy page and Add
  a pitch page should work from the background once the menu closes. Check
  that "this time only" still covers that close.
- **The pen on the handles.** Modulanner's button takes the pen, so the
  handles should too. Check that dragging a piece with the pen moves it
  without leaving a stroke, and that writing right next to a piece still
  writes. The handle is 1.15 times the piece's size.
- **Pieces look right.** Geometry `penWidth` units aren't documented. The
  pieces use 300, and their solid shapes are nested outlines 3px apart. If
  they come out hairline or blobby, tune `PIECE_PEN.width` in
  `src/page/pieceShapes.ts`.
- **Handles line up with the pieces.** The mapping assumes the page fills the
  screen at 1:1, as Modulanner measured on a Manta.
- **Moving and removing find the pieces.** Check the log for
  `insertPageElements` / `batchUpdatePageElements` results, and whether
  `userData` survives (if not, the AsyncStorage fallback takes over).
- **The Pieces layer** on new pitch pages (`insertLayer`), and that pieces
  land on it.
- **Copy page** carries drawings over (`insertElements` with elements read
  from the source page).
- **Rotation.** Placing and moving are limited to the upright screen for now,
  and the button says so when turned. Turned pages need the screen-to-page
  mapping measured on a device.
