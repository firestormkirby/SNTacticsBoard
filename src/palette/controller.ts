/**
 * The floating button's brain: turns its events into changes on the note, and
 * keeps a handle over every piece on whatever page is showing.
 *
 * Started once from index.js, so it runs whether or not the plugin panel is
 * open; most of the time it isn't. Two host rules shape it:
 *
 *  - SDK calls can deadlock while the panel is open, so nothing here touches
 *    the note then. The panel tells us when it opens and closes.
 *  - With the panel closed the host suspends JS timers. The native module
 *    emits a "tick" every second instead, which is how a page turn is noticed
 *    and the handles follow it.
 *
 * Events are handled one at a time, in order, so a quick drop-then-move can't
 * interleave two edits of the same page.
 */
import {ToastAndroid} from 'react-native';
import {PluginCommAPI, PluginManager} from 'sn-plugin-lib';

import {LayoutPiece} from '../layouts/layoutStore';
import {
  NoPitchError,
  NotANoteError,
  PageContext,
  PagePiece,
  addPitchPage,
  copyPage,
  getContext,
  movePiece,
  placePiece,
  readPieces,
  removePiece,
  replacePieces,
} from '../page/pageOps';
import {PieceKind, Point, pieceSizeFor} from '../page/pieceShapes';
import {PaletteEvent, ScreenPoint, onPaletteEvent, palette} from './bridge';
import {loadPaletteSettings, updatePaletteSettings} from './settings';

const TICK_MS = 1000;

function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.LONG);
}

/**
 * Screen pixels -> page pixels, or null when the device is turned.
 *
 * Upright, the note page fills the screen at 1:1 (Modulanner measured this on
 * a Manta: the overlay sits at 0,0 and page px == screen px), so this is a
 * straight scale. Turned, the mapping hasn't been measured on a device yet,
 * so placing is refused rather than guessed.
 */
export function screenToPage(
  p: Pick<ScreenPoint, 'x' | 'y' | 'screenWidth' | 'screenHeight' | 'rotation'>,
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

// ── State ───────────────────────────────────────────────────────────────────

let panelOpen = false;
/** The page the handles were last laid out for. */
let shown: {notePath: string; page: number} | null = null;
/** Its pieces, for the panel, which can't read the note itself. */
let current: {ctx: PageContext; pieces: PagePiece[]} | null = null;

/** The pieces on the page showing when the panel opened. */
export function getCurrentPieces() {
  return current;
}

/** Put a handle over each piece on this page. */
async function syncHandles(ctx: PageContext): Promise<void> {
  const pieces = await readPieces(ctx);
  current = {ctx, pieces};
  shown = {notePath: ctx.notePath, page: ctx.page};
  const screen = await palette.getScreenInfo();
  if (!screen || screen.rotation !== 0) {
    palette.setPieces([], 0);
    return;
  }
  const size =
    (pieceSizeFor(ctx.pageSize.width) * screen.width) / ctx.pageSize.width;
  palette.setPieces(
    pieces.map(p => ({
      id: p.id,
      kind: p.kind,
      ...pageToScreen(p, ctx.pageSize, screen),
    })),
    size,
  );
}

/** On each tick: has the page changed under the handles? */
async function followPage(): Promise<void> {
  let notePath: string | undefined;
  let page: number | undefined;
  try {
    const [f, p] = await Promise.all([
      PluginCommAPI.getCurrentFilePath() as Promise<any>,
      PluginCommAPI.getCurrentPageNum() as Promise<any>,
    ]);
    if (f?.success !== false && p?.success !== false) {
      notePath = f?.result;
      page = p?.result;
    }
  } catch {
    // Not in front, or between pages: try again next tick.
  }
  if (!notePath || page == null || !/\.note$/i.test(notePath)) {
    if (shown) {
      shown = null;
      current = null;
      palette.setPieces([], 0);
    }
    return;
  }
  if (shown?.notePath !== notePath || shown?.page !== page) {
    await syncHandles(await getContext());
  }
}

// ── Showing the button ──────────────────────────────────────────────────────

/** Put the button up where it was left. Resolves false without permission. */
export async function showButton(): Promise<boolean> {
  const s = await loadPaletteSettings();
  const screen = await palette.getScreenInfo();
  // The panel opened while this was loading (index.js starts the controller
  // as the plugin loads, and that load is often the panel opening): stay
  // down, or the button would sit over the panel. Closing brings it back.
  if (panelOpen) {
    return false;
  }
  const shownOk = await palette.show({
    open: s.open,
    pieceSize: pieceSizeFor(screen?.width ?? 1404),
    ...(s.x !== null && s.y !== null ? {x: s.x, y: s.y} : {}),
  });
  if (shownOk) {
    await updatePaletteSettings({visible: true});
    shown = null; // lay the handles out afresh on the next tick
    if (!panelOpen) {
      palette.startTicking(TICK_MS);
    }
  }
  return shownOk;
}

export async function hideButton(): Promise<void> {
  palette.stopTicking();
  palette.hide();
  shown = null;
  await updatePaletteSettings({visible: false});
}

/**
 * The panel is opening: take the overlay down (its windows would sit over the
 * panel) and stop ticking, since reading the note now can deadlock.
 */
export function panelOpened(): void {
  panelOpen = true;
  palette.stopTicking();
  palette.hide();
}

/** The panel has closed: bring the button back if it was on. */
export async function panelClosed(): Promise<void> {
  panelOpen = false;
  if ((await loadPaletteSettings()).visible) {
    await showButton();
  }
}

/**
 * Close the panel, then do some note work. The work waits for the close
 * because SDK calls can deadlock while the panel is open.
 */
export function closePanelThen(work: () => Promise<string | void>): void {
  panelOpen = false;
  PluginManager.closePluginView();
  enqueue(async () => {
    const message = await work();
    await panelClosed();
    if (message) {
      toast(message);
    }
  });
}

// ── Menu actions, run after the panel closes ────────────────────────────────

export async function copyThisPage(): Promise<string> {
  const page = await copyPage(await getContext());
  return `Copied to page ${page + 1}.`;
}

export async function addPitch(): Promise<string> {
  const page = await addPitchPage(await getContext());
  return `Pitch added as page ${page + 1}.`;
}

export async function loadLayoutHere(
  name: string,
  pieces: LayoutPiece[],
): Promise<string> {
  const ctx = await getContext();
  await replacePieces(
    ctx,
    pieces.map(p => ({
      kind: p.kind,
      x: p.x * ctx.pageSize.width,
      y: p.y * ctx.pageSize.height,
    })),
  );
  return `Loaded "${name}".`;
}

// ── Events ──────────────────────────────────────────────────────────────────

async function atPage(
  e: ScreenPoint,
): Promise<{ctx: PageContext; at: Point} | null> {
  const ctx = await getContext();
  const at = screenToPage(e, ctx.pageSize);
  if (!at) {
    toast(TURNED);
    await syncHandles(ctx);
    return null;
  }
  return {ctx, at};
}

export async function handle(e: PaletteEvent): Promise<void> {
  switch (e.type) {
    case 'tick':
      if (!panelOpen) {
        await followPage();
      }
      return;

    case 'tapPiece':
      toast('Drag the piece onto the page.');
      return;

    case 'position':
      await updatePaletteSettings({x: e.x, y: e.y});
      return;

    case 'open':
      await updatePaletteSettings({open: e.open});
      return;

    case 'longPress':
      panelOpened();
      PluginManager.showPluginView();
      return;

    case 'drop': {
      const where = await atPage(e);
      if (where) {
        await placePiece(where.ctx, e.kind as PieceKind, where.at);
        await syncHandles(where.ctx);
      }
      return;
    }

    case 'move': {
      const where = await atPage(e);
      if (where) {
        await movePiece(where.ctx, e.id, where.at);
        await syncHandles(where.ctx);
      }
      return;
    }

    case 'remove': {
      const ctx = await getContext();
      await removePiece(ctx, e.id);
      await syncHandles(ctx);
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

function enqueue(work: () => Promise<void>, quiet = false): void {
  queue = queue.then(work).catch(err => {
    console.error('[snsoccer] palette work failed', err);
    if (!quiet) {
      toast(explain(err));
    }
    // Whatever happened, get the handles back in line with the page.
    shown = null;
  });
}

let stop: (() => void) | null = null;
let busyTicks = 0;

/** Start listening to the button, and bring it back if it was left on. */
export function startPaletteController(): void {
  if (stop) {
    return;
  }
  stop = onPaletteEvent(event => {
    // A tick that finds the last one still running just skips: they are only
    // a check, and piling them up would lag every real edit behind them.
    if (event.type === 'tick' && busyTicks > 0) {
      return;
    }
    if (event.type === 'tick') {
      busyTicks++;
      enqueue(
        () =>
          handle(event).finally(() => {
            busyTicks--;
          }),
        true,
      );
      return;
    }
    enqueue(() => handle(event));
  });
  loadPaletteSettings()
    .then(s => (s.visible && !panelOpen ? showButton() : false))
    .catch(() => {});
}

/** For tests. */
export function stopPaletteController(): void {
  stop?.();
  stop = null;
  panelOpen = false;
  shown = null;
  current = null;
  busyTicks = 0;
}
