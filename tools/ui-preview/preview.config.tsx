/**
 * Soccer Board in the browser.
 *
 *   npm run preview:install   (once)
 *   npm run preview           -> http://localhost:5178
 *
 * The note is simulated (src/NotePage.tsx): the mouse is the pen on the page,
 * PageUp / PageDown turn pages and P opens the plugin, standing in for the
 * Note app's own toolbar. The floating button is a web stand-in for the
 * native one (soccer/WebPalette.tsx) that drives the plugin's real
 * controller, so dragging a piece runs the same page code a device does.
 * Every SDK call is logged in the browser console.
 */
import type { PreviewConfig, Scenario } from './src/config';
import App from '../../App';
import { handle, startPaletteController } from '../../src/palette/controller';
import PaletteOverlay, { setPaletteState } from './soccer/WebPalette';
import { RONDO, preparePitchImage, seedDrill } from './soccer/seed';

/** The button switched on, where index.js finds it at startup. */
const BUTTON_ON = { 'snsoccer:palette:v2': { visible: true, x: null, y: null, open: true } };

const DAY = 24 * 60 * 60 * 1000;
const SAVED = (() => {
  const now = Date.UTC(2026, 8, 28, 17);
  const pieces = (list: typeof RONDO) => list.map(([kind, x, y]) => ({ kind, x, y }));
  return [
    { id: 'l1', name: 'Rondo 4v2', savedAt: now - DAY, pieces: pieces(RONDO) },
    {
      id: 'l2', name: 'Shooting, 2 lines', savedAt: now - 3 * DAY,
      pieces: pieces([
        ['cone', 0.3, 0.55], ['cone', 0.7, 0.55],
        ['attacker', 0.3, 0.6], ['attacker', 0.3, 0.64], ['attacker', 0.7, 0.6], ['attacker', 0.7, 0.64],
        ['defender', 0.5, 0.1], ['ball', 0.33, 0.57], ['ball', 0.67, 0.57],
      ]),
    },
  ];
})();

const setups: Record<string, () => Promise<void> | void> = {
  drill: seedDrill,
  menu: async () => {
    await seedDrill();
    // The button has been up on this page, so the menu knows its pieces.
    await handle({ type: 'tick' });
  },
  'blank-note': async () => {
    await preparePitchImage();
  },
};

const allowed = new Set(['drill', 'menu', 'palette-ready', 'blank-note', 'not-a-note']);

const config: PreviewConfig = {
  name: 'Soccer Board',
  Panel: App,
  Overlay: PaletteOverlay,
  simulateNote: true,
  // The panel photographs the pitch in the background; the result shows up
  // as the pitch page itself, so the capture card would only be in the way.
  showCaptures: false,

  // What index.js does on a device, after the page is in place: the
  // controller listens to the button whether or not the panel is open, and
  // brings the button back if it was left on.
  boot: async (scenario: Scenario) => {
    setPaletteState({ permission: allowed.has(scenario.id) });
    await setups[scenario.id]?.();
    startPaletteController();
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
      note: 'Tap the round button to show or hide the pieces. Drag one out to add it, drag any piece on the page to move it, drop it on the button to remove it. Hold the button for the menu. Drag anywhere else to draw; Page Up / Page Down turn the page.',
      panel: 'closed',
      storage: BUTTON_ON,
    },
    {
      id: 'menu',
      label: 'The menu',
      note: 'What holding the button opens: copy the page, save the pieces as a named layout, load a saved one.',
      storage: {
        ...BUTTON_ON,
        'snsoccer:layouts:v1': SAVED,
      },
    },
    {
      id: 'first-run',
      label: 'First run',
      note: 'The menu before the button is allowed. Allow it, then show the button.',
    },
    {
      id: 'palette-ready',
      label: 'Button allowed',
      note: 'Permission granted: Show the button returns to the note with it up.',
    },
    {
      id: 'blank-note',
      label: 'Blank note',
      note: 'An ordinary page with the button up. Place pieces anywhere, or hold the button and add a pitch page.',
      panel: 'closed',
      storage: BUTTON_ON,
    },
    {
      id: 'not-a-note',
      label: 'In a PDF',
      note: 'The open file is a document: dropping a piece explains that pieces need a note.',
      panel: 'closed',
      storage: BUTTON_ON,
      sdk: { page: { filePath: '/storage/emulated/0/Document/Laws of the Game.pdf' } },
    },
  ],
};

export default config;
