/**
 * Turns floating-palette events into changes on the note page.
 *
 * Started once from index.js, so it runs whether or not the plugin panel is
 * open; most of the time it isn't. Everything here is event-driven and awaits
 * only SDK calls, never a timer: with the panel closed the host suspends the
 * JS timer queue.
 *
 * Events are handled one at a time, in order, so a quick drop-then-move can't
 * interleave two edits of the same page.
 */
import {ToastAndroid} from 'react-native';

import {
  NoPitchError,
  NotANoteError,
  PageContext,
  addPitchPage,
  copyPage,
  getContext,
  movePiece,
  placePiece,
  readPieces,
  removePiece,
} from '../page/pageOps';
import {Point, pieceSizeFor} from '../page/pieceShapes';
import {
  PaletteEvent,
  ScreenPoint,
  TOOL_STYLUS,
  onPaletteEvent,
  palette,
} from './bridge';
import {loadPaletteSettings, savePaletteSettings} from './settings';

function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.LONG);
}

/**
 * Screen pixels -> page pixels, or null when the device is turned.
 *
 * Upright, the note page fills the screen, so this is a straight scale (1:1 on
 * every current device). Turned, the Note app rotates the page and the
 * mapping has not been measured on a device yet, so placing is refused rather
 * than guessed.
 */
export function screenToPage(
  p: ScreenPoint,
  pageSize: {width: number; height: number},
): Point | null {
  if (p.rotation !== 0 || !p.screenWidth || !p.screenHeight) {
    return null;
  }
  return {
    x: (p.x * pageSize.width) / p.screenWidth,
    y: (p.y * pageSize.height) / p.screenHeight,
  };
}

export function pageToScreen(
  p: Point,
  pageSize: {width: number; height: number},
  screen: {width: number; height: number},
): Point {
  return {
    x: (p.x * screen.width) / pageSize.width,
    y: (p.y * screen.height) / pageSize.height,
  };
}

const TURNED =
  'Turn your Supernote upright to place or move pieces. Turned pages come later.';

let moveMode = false;
let penHintShown = false;

/** Tell the move layer where this page's pieces are now. */
async function refreshMoveLayer(ctx: PageContext): Promise<void> {
  const screen = await palette.getScreenInfo();
  if (!screen) {
    return;
  }
  const pieces = await readPieces(ctx);
  const size =
    (pieceSizeFor(ctx.pageSize.width) * screen.width) / ctx.pageSize.width;
  palette.setMoveMode(
    true,
    pieces.map(p => ({
      id: p.id,
      kind: p.kind,
      ...pageToScreen(p, ctx.pageSize, screen),
    })),
    size,
  );
}

function penHint(toolType: number) {
  if (toolType === TOOL_STYLUS && !penHintShown) {
    penHintShown = true;
    toast(
      'Tip: drag pieces with your finger. The pen also writes on the page.',
    );
  }
}

export async function handle(e: PaletteEvent): Promise<void> {
  switch (e.type) {
    case 'tapPiece':
      toast('Drag the piece onto the page with your finger.');
      return;

    case 'position': {
      const s = await loadPaletteSettings();
      await savePaletteSettings({...s, side: e.side, y: e.y});
      return;
    }

    case 'drop': {
      const ctx = await getContext();
      const at = screenToPage(e, ctx.pageSize);
      if (!at) {
        toast(TURNED);
        return;
      }
      await placePiece(ctx, e.kind, at);
      penHint(e.toolType);
      if (moveMode) {
        await refreshMoveLayer(ctx);
      }
      return;
    }

    case 'move': {
      const ctx = await getContext();
      const at = screenToPage(e, ctx.pageSize);
      if (!at) {
        toast(TURNED);
      } else {
        await movePiece(ctx, e.id, at);
        penHint(e.toolType);
      }
      await refreshMoveLayer(ctx);
      return;
    }

    case 'remove': {
      const ctx = await getContext();
      await removePiece(ctx, e.id);
      await refreshMoveLayer(ctx);
      return;
    }

    case 'action':
      switch (e.action) {
        case 'move': {
          const ctx = await getContext();
          const screen = await palette.getScreenInfo();
          if (screen && screen.rotation !== 0) {
            toast(TURNED);
            return;
          }
          moveMode = true;
          await refreshMoveLayer(ctx);
          return;
        }
        case 'moveDone':
          moveMode = false;
          return;
        case 'copy': {
          const page = await copyPage(await getContext());
          toast(`Copied to page ${page + 1}.`);
          return;
        }
        case 'pitch': {
          const page = await addPitchPage(await getContext());
          toast(`Pitch added as page ${page + 1}.`);
          return;
        }
        case 'hide':
          moveMode = false;
          return;
      }
  }
}

function explain(e: unknown): string {
  if (e instanceof NotANoteError || e instanceof NoPitchError) {
    return e.message;
  }
  return `Soccer Board: ${(e as Error)?.message ?? String(e)}`;
}

let queue: Promise<void> = Promise.resolve();
let stop: (() => void) | null = null;

/** Start listening to the palette. Safe to call more than once. */
export function startPaletteController(): void {
  if (stop) {
    return;
  }
  stop = onPaletteEvent(event => {
    queue = queue
      .then(() => handle(event))
      .catch(e => {
        console.error('[snsoccer] palette event failed', event, e);
        toast(explain(e));
        if (moveMode) {
          moveMode = false;
          palette.setMoveMode(false);
        }
      });
  });
}

/** For tests. */
export function stopPaletteController(): void {
  stop?.();
  stop = null;
  moveMode = false;
  penHintShown = false;
}
