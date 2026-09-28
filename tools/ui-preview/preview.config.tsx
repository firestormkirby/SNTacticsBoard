/**
 * Soccer Board in the browser.
 *
 *   npm run preview:install   (once)
 *   npm run preview           -> http://localhost:5178
 *
 * The note is simulated (src/NotePage.tsx): the mouse is the pen on the page.
 * The floating palette is a web stand-in for the native one
 * (soccer/WebPalette.tsx) that drives the plugin's real controller, so
 * dragging a piece off it runs the same page code a device does. Every SDK
 * call is logged in the browser console.
 */
import type { PreviewConfig } from './src/config';
import App from '../../App';
import { startPaletteController } from '../../src/palette/controller';
import PaletteOverlay, { setPaletteState } from './soccer/WebPalette';
import { preparePitchImage, seedDrill } from './soccer/seed';

const paletteUp = () => setPaletteState({ permission: true, showing: true });

const setups: Record<string, () => Promise<void> | void> = {
  'palette-ready': () => setPaletteState({ permission: true }),
  drill: async () => {
    paletteUp();
    await seedDrill();
  },
  'blank-note': async () => {
    paletteUp();
    await preparePitchImage();
  },
  'not-a-note': paletteUp,
};

const config: PreviewConfig = {
  name: 'Soccer Board',
  Panel: App,
  Overlay: PaletteOverlay,
  simulateNote: true,
  // The panel photographs the pitch in the background; the result shows up
  // as the pitch page itself, so the capture card would only be in the way.
  showCaptures: false,

  // What index.js does on a device: the controller listens to the palette
  // whether or not the panel is open.
  boot: async scenario => {
    startPaletteController();
    await setups[scenario.id]?.();
  },

  sdk: {
    page: {
      filePath: '/storage/emulated/0/Note/Training/U12 Drills.note',
      pageNum: 0,
      totalPages: 3,
    },
  },

  // The plugin lays itself out in dp. PixelRatio is 1 here, so these presets
  // use each device's dp size to show the layout the device will draw.
  devices: [
    { id: 'manta', label: 'Manta (A5X2)', width: 1024, height: 1365, note: '1024 × 1365 dp · 1920 × 2560 px page' },
    { id: 'a5x', label: 'A5X', width: 994, height: 1325, note: '994 × 1325 dp · 1404 × 1872 px page' },
  ],

  scenarios: [
    {
      id: 'drill',
      label: 'Drawing a drill',
      note: 'A pitch page with a rondo and two pen arrows. Drag pieces off the palette, draw with the mouse, try Move and Copy.',
      panel: 'closed',
    },
    {
      id: 'first-run',
      label: 'First run',
      note: 'The panel before the palette is allowed. Allow it, show it, then add a pitch page.',
    },
    {
      id: 'palette-ready',
      label: 'Palette allowed',
      note: 'Permission granted: Show the palette returns to the note with the palette up.',
    },
    {
      id: 'blank-note',
      label: 'Blank note',
      note: 'An ordinary page with the palette up. Tap Pitch to add a pitch page, or place pieces anywhere.',
      panel: 'closed',
    },
    {
      id: 'not-a-note',
      label: 'In a PDF',
      note: 'The open file is a document: the palette explains that pieces need a note.',
      panel: 'closed',
      sdk: { page: { filePath: '/storage/emulated/0/Document/Laws of the Game.pdf' } },
    },
  ],
};

export default config;
