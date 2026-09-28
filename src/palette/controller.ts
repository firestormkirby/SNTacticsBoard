/**
 * The floating button's brain: turns its events into changes on the note, and
 * keeps a handle over every piece on whatever page is showing.
 *
 * Started once from index.js, so it runs whether or not the plugin panel is
 * open; most of the time it isn't. Two host rules shape it:
 *
 *  - SDK calls can deadlock while the panel is open, so nothing here touches
 *    the note then. The host's plugin_life events say when it opens (start)
 *    and when the host closes it (stop); our own closes go through
 *    closePanelThen, since the host sends no stop for those.
 *  - With the panel closed the host suspends JS timers. The native module
 *    emits a "tick" every second instead, which is how a page turn is noticed
 *    and the handles follow it.
 *
 * Events are handled one at a time, in order, so a quick drop-then-move can't
 * interleave two edits of the same page.
 */
import {ToastAndroid} from 'react-native';
import {PluginCommAPI, PluginFileAPI, PluginManager} from 'sn-plugin-lib';

import {
  LayoutPiece,
  SavedLayout,
  listLayouts,
  pendingRemovals,
  removalDone,
  replaceLayouts,
  saveLayout,
} from '../layouts/layoutStore';
import {
  NewPage,
  NotANoteError,
  PageContext,
  PagePiece,
  copyPage,
  describeLibraryPage,
  getContext,
  listLibrary,
  loadFromLibrary,
  movePiece,
  placePiece,
  readPieces,
  removeFromLibrary,
  removePiece,
  replacePieces,
  saveToLibrary,
  tagLibraryPage,
} from '../page/pageOps';
import {PieceKind, Point, pieceSizeFor} from '../page/pieceShapes';
import {answer, check} from '../sdk/response';
import {PaletteEvent, ScreenPoint, onPaletteEvent, palette} from './bridge';
import {loadPaletteSettings, updatePaletteSettings} from './settings';

const TICK_MS = 1000;

/**
 * Tell the user something. With the panel closed the plugin is a background
 * app, whose toasts Android may not show, so the native module draws the
 * message in its own window; the toast is the fallback.
 */
function toast(message: string): void {
  log('message:', message);
  if (panelOpen || !palette.notify(message)) {
    ToastAndroid.show(message, ToastAndroid.LONG);
  }
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

/**
 * What happened the last time the button was asked to come up, for the menu
 * to report. On a device there is no other way to tell "not in this build"
 * from "not allowed" from "failed".
 */
export type ButtonProblem =
  | 'no-native' // app.npk without the SoccerPalette package
  | 'no-permission' // "Display over other apps" not allowed for the host
  | 'failed'; // the native show threw; see lastButtonError()

let problem: ButtonProblem | null = null;
let problemDetail = '';

export function buttonProblem(): ButtonProblem | null {
  return problem;
}

export function lastButtonError(): string {
  return problemDetail;
}

function log(...args: unknown[]) {
  console.log('[snsoccer]', ...args);
}

/** Put the button up where it was left. Resolves false if it can't be. */
export async function showButton(): Promise<boolean> {
  if (!palette.available) {
    problem = 'no-native';
    log('button: the SoccerPalette native module is not in this build');
    return false;
  }
  const s = await loadPaletteSettings();
  const screen = await palette.getScreenInfo();
  // The panel opened while this was loading (index.js starts the controller
  // as the plugin loads, and that load is often the panel opening): stay
  // down, or the button would sit over the panel. Closing brings it back.
  if (panelOpen) {
    return false;
  }
  let shownOk = false;
  try {
    shownOk = await palette.show({
      open: s.open,
      penLock: s.penLock,
      pieceSize: pieceSizeFor(screen?.width ?? 1404),
      ...(s.x !== null && s.y !== null ? {x: s.x, y: s.y} : {}),
    });
    problem = shownOk ? null : 'no-permission';
    problemDetail = '';
  } catch (e) {
    problem = 'failed';
    problemDetail = (e as Error)?.message ?? String(e);
  }
  log('button: show ->', shownOk, problem ?? '', problemDetail);
  if (shownOk) {
    shown = null; // lay the handles out afresh on the next tick
    if (!panelOpen) {
      palette.startTicking(TICK_MS);
    }
  }
  return shownOk;
}

/** The menu's toggle. On: the button comes up when the menu closes. */
export async function setButtonOn(on: boolean): Promise<void> {
  await updatePaletteSettings({visible: on});
  if (!on) {
    palette.stopTicking();
    palette.hide();
    shown = null;
    problem = null;
  }
}

/**
 * The panel is opening: take the overlay down (its windows would sit over the
 * panel) and stop ticking, since reading the note now can deadlock.
 */
export function panelOpened(): void {
  if (!panelOpen) {
    log('menu open');
  }
  panelOpen = true;
  palette.stopTicking();
  palette.hide();
  for (const fn of openListeners) {
    fn();
  }
}

const openListeners = new Set<() => void>();

/**
 * Called each time the menu opens. The menu's React tree stays mounted
 * between openings, so its mount effect only sees the first.
 */
export function onMenuOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => {
    openListeners.delete(fn);
  };
}

/** The panel has closed: bring the button back if it was on. */
export async function panelClosed(): Promise<void> {
  log('menu closed');
  panelOpen = false;
  if ((await loadPaletteSettings()).visible) {
    await showButton();
  }
}

/**
 * Close the panel, then do some note work. The work waits for the close
 * because SDK calls can deadlock while the panel is open.
 *
 * The button goes up first, while the panel is still open, as Modulanner's
 * does: an overlay added after closePluginView() may not get drawn before
 * the host puts the plugin in the background. Capped, so a slow show can't
 * keep the menu open.
 */
export async function closePanelThen(
  work: () => Promise<string | void>,
): Promise<void> {
  panelOpen = false;
  await Promise.race([
    panelClosed().catch(e => log('button: could not come up', e)),
    new Promise(done => setTimeout(done, 1500)),
  ]);
  PluginManager.closePluginView();
  afterClose();
  enqueue(async () => {
    const message = await work();
    if (message) {
      toast(message);
    }
  });
}

/** Note work that waits for the panel to be closed, whoever closed it. */
function afterClose(): void {
  enqueue(syncLibrary, true);
}

/**
 * Bring the saved list in line with the layouts note, the truth:
 *  1. remove the pages of layouts deleted in the menu;
 *  2. tag pages saved before keywords;
 *  3. drop layouts whose page has gone from the note, and list pages tagged
 *     "~BOARD:..." there that the list doesn't know yet.
 */
export async function syncLibrary(): Promise<void> {
  for (const keyword of await pendingRemovals()) {
    try {
      await removeFromLibrary(keyword);
      await removalDone(keyword);
    } catch (e) {
      log('layouts: could not remove', keyword, e);
    }
  }

  let list = await listLayouts();
  for (const l of list) {
    if (l.keyword === undefined && l.libPage !== undefined) {
      try {
        l.keyword = await tagLibraryPage(l.libPage, l.name);
        delete l.libPage;
      } catch (e) {
        log('layouts: could not tag', l.name, e);
      }
    }
  }

  const found = await listLibrary();
  if (!found) {
    await replaceLayouts(list);
    return; // no layouts note, or it couldn't be read: change nothing
  }
  const inNote = new Set(found.map(f => f.keyword));
  list = list.filter(l => l.keyword === undefined || inNote.has(l.keyword));
  const listed = new Set(list.map(l => l.keyword));
  for (const f of found) {
    if (listed.has(f.keyword)) {
      continue;
    }
    listed.add(f.keyword);
    try {
      const page = await describeLibraryPage(f.page);
      list.push({
        id: `${f.page}-${Date.now().toString(36)}`,
        name: f.name,
        savedAt: Date.now(),
        keyword: f.keyword,
        template: f.template,
        marks: page.marks,
        pieces: page.pieces.map(p => ({
          kind: p.kind,
          x: p.x / page.pageSize.width,
          y: p.y / page.pageSize.height,
        })),
      });
    } catch (e) {
      log('layouts: could not read', f.keyword, e);
    }
  }
  await replaceLayouts(list);
}

// ── Menu actions, run after the panel closes ────────────────────────────────

/** "Page 4.", or how to get there when this firmware can't jump. */
function landedOn(p: NewPage): string {
  return p.jumped
    ? `page ${p.page + 1}.`
    : `page ${p.page + 1}, after this one. Turn the page to see it.`;
}

export async function copyThisPage(): Promise<string> {
  return `Copied to ${landedOn(await copyPage(await getContext()))}`;
}

/** Save this whole page as a layout, under a name. */
export async function saveThisPage(name: string): Promise<string> {
  const ctx = await getContext();
  const now = Date.now();
  const saved = await saveToLibrary(
    ctx,
    name,
    now.toString(36) + Math.random().toString(36).slice(2, 6),
  );
  const {layout, replaced} = await saveLayout(
    name,
    saved.pieces,
    ctx.pageSize,
    now,
    {
      keyword: saved.keyword,
      template: saved.template,
      background: saved.background,
      marks: saved.marks,
    },
  );
  // Saving under a name again replaces that layout, and its page. The new
  // page may carry the very same keyword, so it's spared by position.
  if (replaced?.keyword) {
    try {
      await removeFromLibrary(replaced.keyword, saved.libPage);
    } catch (e) {
      log('layouts: could not remove the old page', replaced.keyword, e);
    }
  }
  return `Saved "${layout.name}".`;
}

/** Add a saved layout's page after this one. */
export async function loadLayoutAsPage(layout: SavedLayout): Promise<string> {
  if (!layout.keyword) {
    throw new Error(
      layout.libPage === undefined
        ? `"${layout.name}" was saved before whole pages were: it has pieces only.`
        : `"${layout.name}" is being updated. Close the menu, then try again.`,
    );
  }
  const ctx = await getContext();
  const p = await loadFromLibrary(ctx, layout.keyword, layout.background);
  return `"${layout.name}" added as ${landedOn(p)}`;
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
      log('drop:', e.kind, 'at screen', Math.round(e.x), Math.round(e.y));
      const where = await atPage(e);
      if (where) {
        const tag = await placePiece(where.ctx, e.kind as PieceKind, where.at);
        log('drop: placed', tag.kind, tag.id, 'on page', where.ctx.page + 1);
        await syncHandles(where.ctx);
      }
      return;
    }

    case 'move': {
      log('move:', e.id);
      const where = await atPage(e);
      if (where) {
        const tag = await movePiece(where.ctx, e.id, where.at);
        log('move:', tag ? 'moved' : 'not found on the page');
        await syncHandles(where.ctx);
      }
      return;
    }

    case 'remove': {
      log('remove:', e.id);
      const ctx = await getContext();
      await removePiece(ctx, e.id);
      await syncHandles(ctx);
      return;
    }
  }
}

function explain(e: unknown): string {
  if (e instanceof NotANoteError) {
    return e.message;
  }
  return `Soccer Board: ${(e as Error)?.message ?? String(e)}`;
}

// ── The work queue ──────────────────────────────────────────────────────────
//
// Note work runs one job at a time, in order. A call the note never answers
// (one caught by the panel opening, say) would otherwise hold up every job
// after it, and every drop would seem to vanish. JS timers are suspended with
// the panel closed, so the native tick keeps the watchdog's time: a job still
// running after WATCHDOG_TICKS ticks is given up on, and the queue moves on.
// While the pen is locked the plugin's view is open, where note calls can
// hang, so the queue waits for the unlock.

const WATCHDOG_TICKS = 10;

interface Job {
  work: () => Promise<void>;
  quiet: boolean;
}

const jobs: Job[] = [];
let running: {ticks: number; giveUp: () => void} | null = null;

function enqueue(work: () => Promise<void>, quiet = false): void {
  jobs.push({work, quiet});
  runJobs();
}

function runJobs(): void {
  if (running || penLocked) {
    return;
  }
  const job = jobs.shift();
  if (!job) {
    return;
  }
  let giveUp = () => {};
  const gaveUp = new Promise<'gave up'>(done => {
    giveUp = () => done('gave up');
  });
  const me = {ticks: 0, giveUp};
  running = me;
  Promise.race([job.work().then(() => 'done' as const), gaveUp])
    .then(outcome => {
      if (outcome === 'gave up') {
        log('work: gave up waiting on the note');
        busyTicks = 0;
        shown = null;
        if (!job.quiet) {
          toast("The note didn't answer. Please try again.");
        }
      }
    })
    .catch(err => {
      console.error('[snsoccer] palette work failed', err);
      if (!job.quiet) {
        toast(explain(err));
      }
      // Whatever happened, get the handles back in line with the page.
      shown = null;
    })
    .finally(() => {
      if (running === me) {
        running = null;
      }
      runJobs();
    });
}

/** Each native tick: count against the running job. */
function watchdog(): void {
  if (running && ++running.ticks >= WATCHDOG_TICKS) {
    running.giveUp();
  }
}

// ── The pen ─────────────────────────────────────────────────────────────────
//
// A pen drag on the button, the palette or a piece would also write into the
// note (the digitizer writes whatever window the pen is over). Two defences:
//  1. The native module locks the pen for the drag (see SoccerPaletteModule),
//     which opens the plugin's view in the background; while it's locked the
//     menu stays blank and the lifecycle's "start" is not the menu opening.
//  2. Any stroke that got through anyway, begun before the lock landed, is
//     deleted: the SDK's event_pen_up hands over each finished stroke, and one
//     that ends during a pen drag, or just after, came from the drag.

let penLocked = false;
let penDrag = {active: false, endedAt: 0};
const PEN_STROKE_GRACE_MS = 2500;
const TYPE_STROKE = 0;
const lockListeners = new Set<(locked: boolean) => void>();

export function isPenLocked(): boolean {
  return penLocked;
}

/** For the menu, which keeps out of sight while the pen is locked. */
export function onPenLock(fn: (locked: boolean) => void): () => void {
  lockListeners.add(fn);
  return () => {
    lockListeners.delete(fn);
  };
}

function setPenLocked(on: boolean): void {
  if (penLocked === on) {
    return;
  }
  penLocked = on;
  log('pen', on ? 'locked' : 'unlocked');
  for (const fn of lockListeners) {
    fn(on);
  }
  if (!on) {
    // The lock opened our view; put it away before any note work.
    PluginManager.closePluginView();
    runJobs();
  }
}

function fromPenDrag(): boolean {
  return penDrag.active || Date.now() - penDrag.endedAt < PEN_STROKE_GRACE_MS;
}

/** Delete strokes the pen drew while dragging: only strokes, only these. */
async function removeDragStrokes(nums: number[]): Promise<void> {
  const ctx = await getContext();
  const els = answer<
    Array<{
      type?: number;
      numInPage?: number;
      layerNum?: number;
      recycle?: () => void;
    }>
  >(await PluginFileAPI.getElements(ctx.page, ctx.notePath), 'getElements');
  const byLayer = new Map<number, number[]>();
  for (const el of els) {
    if (el.type === TYPE_STROKE && nums.includes(el.numInPage ?? -1)) {
      const layer = el.layerNum ?? 0;
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), el.numInPage!]);
    }
    el.recycle?.();
  }
  for (const [layer, list] of byLayer) {
    check(
      await PluginCommAPI.deletePageElements(
        [...list].sort((a, b) => b - a),
        ctx.page,
        layer,
      ),
      'deletePageElements',
    );
    log('pen: removed', list.length, 'stroke(s) drawn by a drag');
  }
}

function onPenUp(data: unknown): void {
  if (!fromPenDrag()) {
    return;
  }
  const list = (Array.isArray(data) ? data : [data]) as Array<{
    type?: number;
    numInPage?: number;
  }>;
  const nums = list
    .filter(el => el?.type === TYPE_STROKE && typeof el.numInPage === 'number')
    .map(el => el.numInPage!);
  if (nums.length > 0) {
    enqueue(() => removeDragStrokes(nums), true);
  }
}

let stop: (() => void) | null = null;
/** sn-plugin-lib's PluginLifeType. */
const LIFE_START = 2;
const LIFE_STOP = 3;
let busyTicks = 0;

/** Start listening to the button, and bring it back if it was left on. */
export function startPaletteController(): void {
  if (stop) {
    return;
  }
  // The host's word on the panel: start when it opens, from the toolbar or
  // anywhere else, and stop when the host closes it (not for our own
  // closePluginView). App.tsx only mounts once per plugin load, so it can't
  // be the signal for a second opening.
  const life = (PluginManager as any).registerPluginLifeListener?.({
    onMsg(data: {state?: number} | undefined) {
      if (data?.state === LIFE_START) {
        if (penLocked) {
          return; // the pen lock opening our view, not the menu
        }
        panelOpened();
      } else if (data?.state === LIFE_STOP) {
        panelClosed().catch(e => log('button: could not come up', e));
        afterClose();
      }
    },
  });
  const penUp = (PluginManager as any).registerEventListener?.(
    'event_pen_up',
    1,
    {onMsg: onPenUp},
  );
  const events = onPaletteEvent(event => {
    // Pen events change state at once; they aren't note work.
    if (event.type === 'penLock') {
      setPenLocked(event.on);
      return;
    }
    if (event.type === 'penDrag') {
      penDrag = event.active
        ? {active: true, endedAt: 0}
        : {active: false, endedAt: Date.now()};
      return;
    }
    if (event.type === 'tick') {
      watchdog();
    }
    // A tick that finds the last one still running just skips: they are only
    // a check, and piling them up would lag every real edit behind them.
    if (event.type === 'tick' && (busyTicks > 0 || penLocked)) {
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
  stop = () => {
    events();
    life?.remove?.();
    penUp?.remove?.();
  };
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
  problem = null;
  problemDetail = '';
  jobs.length = 0;
  running = null;
  penLocked = false;
  penDrag = {active: false, endedAt: 0};
}
