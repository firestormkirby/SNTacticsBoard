# SNSoccer: Soccer Board for Supernote

A coach's whiteboard plugin for Supernote. Drag players, cones and balls onto a
pitch, then **Export to Note** to add the drill to the open notebook
as a new page. The diagram becomes that page's background, so you can draw
runs and passes over it with the pen.

![Soccer Board, rondo drill](docs/board.png)

## Features

- **The pitch runs along the screen's long side**, with regulation markings
  drawn in proportion. Held upright, the goals are at the top and bottom. Turn
  the Supernote sideways and the goals move to the left and right, with the
  drill turned along with the pitch: the top goal becomes the left one, as if
  you had turned a clipboard. A drill looks the same whichever way round you
  build it.
- **Pieces are told apart by shape, not colour**, for a greyscale screen:
  **X** for Team X, **O** for Team O, solid **▲** cones and solid **●**
  balls. Each piece has a white halo, so it stays visible on a pitch line.
  The tray holds 11 of each team, 6 cones and 3 balls.
- **Drag and drop** uses React Native's `PanResponder`, and pen and finger both
  work. Each touch target is 64dp, about 9mm. Drop a piece on the pitch to
  place it. To take it off, drop it anywhere else or tap it; it goes back to
  its own slot in the tray.
- **Saved automatically** to AsyncStorage after every move, so a drill
  survives closing the plugin, switching notes and rebooting. Positions are
  stored as fractions of the pitch, so a drill comes out the same on every
  device.
- **Clear Board** sends every piece back to the tray at once.
- **Export to Note** adds a page after the current one with the diagram as its
  background, and takes you to it.

## How Export to Note works

`App.tsx` → `src/components/ExportSheet.tsx` → `src/export/exportToNote.ts`

1. `ExportSheet` renders the pitch and the placed pieces on a screen-sized
   white sheet. The tray is left out. The sheet is drawn *underneath* the board
   UI, so it never flashes on screen.
2. `react-native-view-shot` captures that sheet as a PNG at the note page's
   pixel size, 1404 × 1872 or 1920 × 2560. The shapes are drawn at page
   resolution rather than scaled up from the smaller on-screen pitch, which
   keeps them sharp on e-ink.
3. The plugin view closes. Note operations can deadlock while a plugin view is
   open, so every SDK file call happens after this step.
4. The PNG is copied to `EXPORT/SNSoccer/drill-<timestamp>.png`, where the
   Note app can read it.
5. `PluginNoteAPI.saveCurrentNote()`, then
   `PluginFileAPI.insertNotePage({notePath, page, template: pngPath})`, then
   `reloadFile()` and `jumpToPage(page + 1)`.
6. **Fallback:** if the firmware only accepts built-in template names, the
   plugin inserts a blank `style_white` page, jumps to it, and places the
   diagram with `PluginNoteAPI.insertImage()`. That gives a movable picture
   instead of a fixed background, but you can still draw over it.
7. A toast reports the outcome. The export button is registered for NOTE only.

## Build

Requirements are those of the Supernote template: Node 18+, JDK 19+, Android
SDK 35, and React Native **0.79.2** (locked to the PluginHost runtime).

```bash
npm install
npm run build:plugin          # -> build/outputs/snsoccer.snplg
```

`build:plugin` runs Gradle's autolinking step and then the template's
`buildPlugin.sh`, or `buildPlugin.ps1` on Windows. The extra step matters
because AsyncStorage and ViewShot are native modules. `buildPlugin` reads their
package list from Gradle output that doesn't exist on a clean checkout, so
running `buildPlugin` directly the first time produces a plugin that crashes on
launch. Running it a second time also fixes that.

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
[sn-plugin-ui-preview](https://github.com/firestormkirby/sn-plugin-ui-preview).
It runs the real `App.tsx` in a browser, with the SDK, AsyncStorage and
ViewShot mocked:

```bash
npm run preview:install       # once
npm run preview               # http://localhost:5178
```

The scenarios are *First run*, *Rondo drill*, *Full match shape*, *Export from
a PDF*, *Template path refused* (exercises the fallback) and *Damaged save*.
The device list has each screen upright and in landscape.
You can drag pieces with the mouse. When you press **Export to Note**, the
**Last capture** card shows the page that would be added, and the browser
console lists every SDK call in order.

The preview can't reproduce SDK threading or real file writes. Check the
export on a device.

## Develop

```bash
npm test           # board rules, persistence, layout, export flow, App smoke test
npm run typecheck
npm run lint
```

| Path | What it is |
|---|---|
| `index.js` | Registers the component, calls `PluginManager.init()`, adds the NOTE toolbar button |
| `App.tsx` | Root component: toolbar, board, drag wiring, persistence, export trigger |
| `src/board/boardState.ts` | Pure drag-and-drop rules and the save format |
| `src/board/geometry.ts` | Pitch dimensions and the screen layout |
| `src/board/storage.ts` | AsyncStorage load and save |
| `src/components/` | Pitch markings, piece glyphs, draggable piece, export sheet |
| `src/export/exportToNote.ts` | Capture, then copy, then insert the page |

## To check on the first device install

These depend on host behaviour that can't be exercised off-device:

- Whether `insertNotePage` accepts a PNG path as `template`. If it doesn't,
  you get the picture fallback and the toast still reports success. Look for
  `template insert refused` in `adb logcat -s ReactNativeJS:V`.
- Whether the page index is 0-based and inserts *after* `page`, as the SDK
  docs say. The new page should appear directly after the one you were on.
- Whether `Dimensions.get('screen')` times the pixel ratio equals the note
  page size. The export sheet is sized from it, so a mismatch would show up as
  a stretched diagram.
- Exporting in landscape. The page is captured the way the screen is turned,
  1872 × 1404 or 2560 × 1920. Check how the note shows that page, and whether
  the host takes a landscape image as a template.
