# sn-plugin-ui-preview

A user interface preview for Supernote plugins. It runs your plugin's React
Native panel in a browser so you can work on layout, copy and flow without
building a `.snplg` and installing it on a device.

```bash
npm install
npm run dev
```

That serves http://localhost:5178 with a small demo plugin. Point
`preview.config.tsx` at your own panel to see yours instead.

## What it does

**Runs your real components.** Your panel and your stores are imported from
your repo and run as they are. Change a label in your source, save, and the
browser updates.

**Sizes the screen like a device.** The preview is its own document in an
iframe set to the device's screen size, so a panel that measures itself with
`useWindowDimensions()` comes out the shape it will be on a Nomad or a Manta.
Presets for both ship with it, and you can add your own.

**Stages screens from saved data.** A scenario is the AsyncStorage contents of a
device in some state. Your plugin's own startup code reads it, so a staged
screen goes through the same load path as a real one.

**Answers the SDK.** Calls return the SDK's success shape, and anything the mock
has not been told about logs itself with its arguments, which gives you a trace
of what a screen actually asks for. Where a real return value drives the UI, a
page count or a lasso rect or a keyword list, you supply it per scenario.

**Draws a backdrop.** For a plugin that sits on top of a page, a scenario can
put an image behind the panel, so tap placement and overlays have something to
aim at.

**Models closing the panel.** `closePluginView()` shows a closed state with a
reopen button, so you can walk through a flow that leaves the panel, does work
in the background, and comes back.

**Runs on localhost, and on your network too.** It binds to every interface, so
the usual http://localhost:5178 works and you can also open the preview by IP
from a tablet or a second machine, over a LAN or Tailscale, with no extra
config.

## Setting it up for your plugin

**1. Install your plugin's dependencies.** Run `npm install` in your plugin repo
as well as here. Vite reads the nearest `tsconfig.json` to each file it
transforms, and a React Native tsconfig usually extends
`@react-native/typescript-config`, which is a package. Without it you get a
TypeScript config error on every module.

**2. Put the preview where it can see your source.** Either clone it beside your
plugin, or copy it into your repo as `tools/ui-preview/`. Set `PLUGIN_ROOT` at
the top of `vite.config.ts` to your plugin's root. That is the only directory
outside its own root that Vite is allowed to read.

**3. Edit `preview.config.tsx`.**

```tsx
import MyPanel from '../../src/ui/MyPanel';
import { initSettingsFromStorage } from '../../src/storage/settings';

const config: PreviewConfig = {
  name: 'My plugin',
  Panel: MyPanel,

  // Your plugin's own startup, in the order index.js does it.
  boot: async () => {
    await Promise.all([initSettingsFromStorage()]);
  },

  scenarios: [
    { id: 'fresh', label: 'Fresh install', storage: {} },
    {
      id: 'configured',
      label: 'In use',
      storage: { 'myplugin:settings:v1': { weekStart: 1 } },
    },
  ],
};
```

If your plugin loads its storage lazily inside components, leave `boot` out.

Five modules are swapped for browser versions, and everything else comes from
your repo:

| Module | Swapped for |
|---|---|
| `react-native` | `react-native-web`, plus the Android only APIs it lacks |
| `sn-plugin-lib` | a mock that answers every call |
| `react-native-fs` | a fake `/storage` tree |
| `@react-native-async-storage/async-storage` | an in memory map, seeded per scenario |
| `react-native-view-shot` | a capture that shows you what it captured |

## Scenarios

A scenario holds the data behind a screen, and nothing about the screen itself.
As well as `storage` it can carry `files` (entries in the fake filesystem), `sdk`
(different answers from the SDK, a bigger file or a live lasso selection) and
`backdrop` (the image drawn behind the panel).

Reloading the page resets everything, so the same screenshot taken twice looks
the same. Anything you want to keep belongs in a scenario.

## SDK answers

```tsx
sdk: {
  overrides: {
    PluginFileAPI: {
      getKeyWords: () => Promise.resolve({
        success: true,
        result: [{ page: 3, keyWord: 'PLANNER:DAILY:2026-01-23' }],
      }),
    },
  },
}
```

Calls that would write to a file report success and log what they were asked to
do, so clicking around a preview leaves your notes alone.

## Captures

A plugin that uses `react-native-view-shot` to turn a view into an image, say
to insert it into a note, gets a **Last capture** card in the corner of the
device screen showing exactly what `captureRef()` was pointed at, and the size
of image it asked for. The card outlives `closePluginView()`, since closing is
usually what a plugin does next. This is especially useful when the captured
view is rendered out of sight, underneath the visible UI.

The capture is a clone of the DOM, not a PNG, and the returned URI is a
plausible path in the host's cache that nothing was written to.

## Screenshots

**Open device view alone** serves the preview by itself at full device
resolution with no sidebar. Capture that. The zoom control is for looking at the
page while you work; anything below 100% gives you a scaled screenshot.

## Page size and tap coordinates

The mocks report the screen as the iframe, and the pixel ratio as 1, so one CSS
pixel is one page pixel.

This matters for any plugin that maps taps to page coordinates. On a device,
`Dimensions.get('screen')` times `PixelRatio.get()` gives the page's pixel size.
In a browser those describe the desktop you happen to be sitting at. A page size
that disagrees with the screen gets letterboxed, and taps in the bars clamp to
the page edge, which looks like an invisible margin nothing can be placed past.
Keep page size and window size equal.

## The SDK limitation to keep in mind

On a device, `PluginComm` and `PluginFile` calls deadlock while the plugin view
is open. Here they resolve instantly. That behaviour lives in the host process,
so a flow can look right in the browser and lock up on hardware.

Work on the interface here, then confirm behaviour on the device.

One smaller difference worth knowing: react-native-web is CSS flexbox rather
than Yoga. The two agree on almost everything, though `flexShrink` defaults
differ, so layout that leans on flex edge cases can land differently.

## Adding to the mocks

If your plugin imports something react-native-web does not have, add it to
`src/mocks/react-native.ts` next to `ToastAndroid`. If it calls part of the SDK
the mock has no answer for, add it to `src/mocks/sn-plugin-lib.ts`. Both are a
few lines. Pull requests welcome for anything other plugins would use.

## Licence

MIT.
