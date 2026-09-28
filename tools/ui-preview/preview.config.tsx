/**
 * Soccer Board in the browser.
 *
 *   npm run preview:install   (once)
 *   npm run preview           -> http://localhost:5178
 *
 * Every scenario is a saved board in AsyncStorage, loaded by the plugin's own
 * startup code, so what you see is exactly what the device would restore.
 * Pieces drag with the mouse. "Export to Note" shows the page it would add in
 * the "Last capture" card, then walks the SDK calls (see the browser console).
 */
import type { PreviewConfig } from './src/config';
import App from '../../App';
import { BOARD_KEY } from '../../src/board/storage';
import { CANVAS_METRES, PITCH } from '../../src/board/geometry';

/** Pitch metres from the top-left corner flag -> saved canvas fraction. */
function at(id: string, x: number, y: number) {
  return {
    id,
    x: (PITCH.margin + x) / CANVAS_METRES.w,
    y: (PITCH.margin + y) / CANVAS_METRES.h,
  };
}

const board = (...placed: ReturnType<typeof at>[]) => ({
  [BOARD_KEY]: { version: 1, placed },
});

/** Team X in a 4-3-3 defending the bottom goal, Team O in a 4-4-2 at the top. */
const fullMatch = board(
  at('x1', 34, 101),
  at('x2', 10, 88), at('x3', 26, 90), at('x4', 42, 90), at('x5', 58, 88),
  at('x6', 20, 72), at('x7', 34, 75), at('x8', 48, 72),
  at('x9', 12, 58), at('x10', 34, 56), at('x11', 56, 58),
  at('o1', 34, 4),
  at('o2', 10, 17), at('o3', 26, 15), at('o4', 42, 15), at('o5', 58, 17),
  at('o6', 8, 33), at('o7', 25, 32), at('o8', 43, 32), at('o9', 60, 33),
  at('o10', 27, 46), at('o11', 41, 46),
  at('ball1', 34, 52.5),
);

/** A 4v2 rondo in a coned 20m square, with a pair of cones as an exit gate. */
const rondo = board(
  at('cone1', 24, 42), at('cone2', 44, 42), at('cone3', 24, 62), at('cone4', 44, 62),
  at('cone5', 30, 78), at('cone6', 38, 78),
  at('x1', 34, 43), at('x2', 25, 52), at('x3', 43, 52), at('x4', 34, 61),
  at('o1', 31, 49), at('o2', 37, 55),
  at('ball1', 30, 44.5),
);

const config: PreviewConfig = {
  name: 'Soccer Board',
  Panel: App,

  sdk: {
    page: {
      filePath: '/storage/emulated/0/Note/Training/U12 Drills.note',
      pageNum: 4,
      totalPages: 12,
    },
  },

  // The plugin lays itself out in dp. PixelRatio is 1 here, so these presets
  // use each device's dp size to show the layout the device will draw.
  devices: [
    { id: 'manta', label: 'Manta (A5X2)', width: 1024, height: 1365, note: '1024 × 1365 dp · 1920 × 2560 px page' },
    { id: 'a5x', label: 'A5X', width: 994, height: 1325, note: '994 × 1325 dp · 1404 × 1872 px page' },
    { id: 'landscape', label: 'Manta, turned sideways', width: 1365, height: 1024, note: 'Portrait-only notice' },
  ],

  scenarios: [
    {
      id: 'fresh',
      label: 'First run',
      note: 'Nothing saved: every piece waits in the tray.',
      storage: {},
    },
    {
      id: 'rondo',
      label: 'Rondo drill',
      note: '4v2 rondo in a coned square, with an exit gate.',
      storage: rondo,
    },
    {
      id: 'full-match',
      label: 'Full match shape',
      note: '4-3-3 against 4-4-2, all 22 players on the pitch.',
      storage: fullMatch,
    },
    {
      id: 'not-a-note',
      label: 'Export from a PDF',
      note: 'The open file is a document, so Export refuses with a toast.',
      storage: rondo,
      sdk: { page: { filePath: '/storage/emulated/0/Document/Laws of the Game.pdf' } },
    },
    {
      id: 'template-refused',
      label: 'Template path refused',
      note: 'insertNotePage rejects a PNG template: Export falls back to a picture on a blank page.',
      storage: rondo,
      sdk: {
        overrides: {
          PluginFileAPI: {
            insertNotePage: (params: { template: string }) => {
              console.log('[preview-sdk] PluginFileAPI.insertNotePage', params);
              return Promise.resolve(
                params.template === 'style_white'
                  ? { success: true, result: true }
                  : { success: false, error: { code: 108, message: 'template not found' } },
              );
            },
          },
        },
      },
    },
    {
      id: 'corrupt',
      label: 'Damaged save',
      note: 'Unreadable storage loads as an empty board instead of crashing.',
      storage: { [BOARD_KEY]: '{"version":1,"placed":[{"id":"x1",' },
    },
  ],
};

export default config;
