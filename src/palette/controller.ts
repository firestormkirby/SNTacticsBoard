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
  SavedLayout,
  listLayouts,
  pendingRemovals,
  removalDone,
  replaceLayouts,
  replaceVersions,
  saveLayout,
} from '../layouts/layoutStore';
import {
  LIBRARY_NAME,
  LibraryEntry,
  NewPage,
  NotANoteError,
  PageContext,
  PagePiece,
  copyPage,
  describeLibraryPage,
  contextAt,
  getContext,
  layoutKeyword,
  loadFromLibrary,
  movePiece,
  piecesLayer,
  placePiece,
  readPieces,
  removeFromLibrary,
  boardName,
  libraryPage,
  removePiece,
  saveToLibrary,
  scanLibrary,
  tagLibraryPage,
  templateNameOf,
  versionKeyword,
} from '../page/pageOps';
import {
  PageName,
  SCRATCHPAD,
  archiveBoard,
  clearInPlace,
  clearPageName,
  pageName,
  pruneVersions,
  replaceInPlace,
  replacePage,
  setPageName,
  writePageLabel,
} from '../page/boards';
import {PieceKind, Point, pieceSizeFor} from '../page/pieceShapes';
import {
  AFTER_UNLOCK_MS,
  noteBusyFor,
  pageEdit,
  resetNoteGate,
  setSleeper,
  whenNoteQuiet,
} from '../sdk/noteGate';
import {cleanUp, describeCleanup} from '../page/cleanup';
import {hasDeleteAccess} from '../sdk/filePermissions';
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

const TURNED = 'Rotation is not supported yet.';

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

/** Put a handle over each piece on this page, and show the page's name. */
async function syncHandles(ctx: PageContext): Promise<void> {
  await showHandles(ctx, await readPieces(ctx));
  await showName(ctx);
}

/** The board the page showing is, or null for the scratchpad. */
let currentName: PageName | null = null;

/** For the menu: the name of the page showing when it opened. */
export function getPageName(): string {
  return currentName?.name ?? SCRATCHPAD;
}

/** Read the page's name and put it on the palette. */
async function showName(ctx: PageContext): Promise<void> {
  try {
    currentName = await pageName(ctx);
  } catch (e) {
    log('page name unavailable', e);
    currentName = null;
  }
  palette.setPageName(currentName?.name ?? SCRATCHPAD);
}

/**
 * Put handles over these pieces. After the plugin's own edit it knows what's
 * on the page, and reading it again would hold up the next edit.
 */
async function showHandles(
  ctx: PageContext,
  pieces: PagePiece[],
): Promise<void> {
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

// ── Where the pen can't write ───────────────────────────────────────────────
//
// Over a view of the note that takes no handwriting (the Note app's menus
// and dialogs, its page overview, another app in front), pieces can't go on
// the page, so the button goes too, and comes back when writing can.

/** Ticks of "can't write here" before the button goes: not for a blink. */
const HIDE_AFTER_TICKS = 2;
let cantWriteTicks = 0;
let hiddenForView = false;
let lastCanWrite = '';

/**
 * Whether the pen can write where the user is, asked before each tick reads
 * the page: away from the note (Settings) those reads hang. The answer is
 * waited for a moment, on the native clock, and no answer is a no: in some
 * places it never comes. A question still unanswered is asked again only
 * after a while, so they don't pile up.
 */
const ASK_NO_ANSWER_MS = 1500;
const ASK_AGAIN_MS = 5000;
let canWriteAsk: {since: number; answer: Promise<boolean>} | null = null;

function askCanWrite(can: () => Promise<unknown>): Promise<boolean> {
  if (!canWriteAsk || Date.now() - canWriteAsk.since >= ASK_AGAIN_MS) {
    const ask = {
      since: Date.now(),
      answer: Promise.resolve()
        .then(() => can.call(PluginCommAPI))
        .then(
          (res: any) => {
            const said = JSON.stringify(res);
            if (said !== lastCanWrite) {
              lastCanWrite = said;
              log('canHandwrite ->', said);
            }
            return canWriteFrom(res);
          },
          () => true, // unsure is yes
        ),
    };
    canWriteAsk = ask;
    ask.answer.then(() => {
      if (canWriteAsk === ask) {
        canWriteAsk = null;
      }
    });
  }
  return canWriteAsk.answer;
}

async function canWriteHere(): Promise<boolean> {
  const can = (PluginCommAPI as any).canHandwrite;
  if (typeof can !== 'function') {
    return true; // older firmware
  }
  const noAnswer = Symbol('no answer');
  const answer = await Promise.race([
    askCanWrite(can),
    palette.wait(ASK_NO_ANSWER_MS).then(() => noAnswer),
  ]);
  return answer !== noAnswer && answer === true;
}

/**
 * {success, result: boolean}. Away from the note it fails instead, and
 * that's a no too: 118 "The handwriting app is not open" (the Files view),
 * 102 "This app is not allowed to use this API" (Settings).
 */
function canWriteFrom(res: any): boolean {
  return res?.success !== false && res?.result !== false;
}

/** On each tick: hide or bring back the button. False: leave the page be. */
async function followWritable(): Promise<boolean> {
  if (!(await canWriteHere())) {
    if (!hiddenForView && ++cantWriteTicks >= HIDE_AFTER_TICKS) {
      log("button: hidden, the pen can't write here");
      hiddenForView = true;
      palette.hide(); // the ticks go on, to see writing come back
      shown = null;
      current = null;
    }
    return false; // and don't read the page: away from the note, reads hang
  }
  cantWriteTicks = 0;
  if (hiddenForView) {
    log('button: back, the pen can write again');
    await showButton(); // lays the handles out on the next tick
    return false;
  }
  return true;
}

/** On each tick: has the page changed under the handles? */
async function followPage(): Promise<void> {
  if (!(await followWritable())) {
    return;
  }
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
    // The note and page were just read: only the page size is needed.
    await syncHandles(await contextAt(notePath, page));
    ticksSinceRead = 0;
    return;
  }
  // The Note app can move, copy or erase pieces too (lasso, eraser), and says
  // nothing: look again every few ticks, without saving the note, and move
  // the handles if the pieces moved.
  if (++ticksSinceRead >= RECHECK_TICKS && current) {
    ticksSinceRead = 0;
    const pieces = await readPieces(current.ctx, {save: false});
    // To a few pixels: a drawn shape's middle is its tag's centre, rounded.
    const where = (list: PagePiece[]) =>
      list
        .map(p => `${p.id}@${Math.round(p.x / 4)},${Math.round(p.y / 4)}`)
        .sort()
        .join(' ');
    if (where(pieces) !== where(current.pieces)) {
      log('pieces changed on the page; handles follow');
      await showHandles(current.ctx, pieces);
    }
  }
}

/** A palette Save, Load or Reset is waiting or running. */
let pageActionBusy = false;

/** The palette's page actions: they read or replace whole pages. */
type PageAction = 'save' | 'load' | 'copy' | 'reset' | 'clear';

/**
 * A Save, Load, Copy or Reset that hasn't started: page work waits for the pen
 * lock to lift, and it only lifts once the pen is out of hover range, so a
 * pen held near the palette after tapping holds it up. Ticks count how long.
 */
let waitingAction: {
  kind: PageAction;
  ticks: number;
  hinted: boolean;
} | null = null;
/** Ticks a page action waits on the pen before saying to lift it. */
const LIFT_HINT_TICKS = 2;

function liftHint(kind: PageAction): string {
  return `Lift the pen away to ${kind}.`;
}

/** On each tick with the pen locked: say to lift it, once, after a moment. */
function hintLiftPen(): void {
  if (
    waitingAction &&
    !waitingAction.hinted &&
    ++waitingAction.ticks >= LIFT_HINT_TICKS
  ) {
    waitingAction.hinted = true;
    toast(liftHint(waitingAction.kind));
  }
}

/** Ticks between looks at the page for pieces the Note app moved. */
const RECHECK_TICKS = 3;
let ticksSinceRead = 0;

// ── Showing the button ──────────────────────────────────────────────────────

/**
 * What happened the last time the button was asked to come up, for the menu
 * to report. On a device there is no other way to tell "not in this build"
 * from "not allowed" from "failed".
 */
export type ButtonProblem =
  | 'no-native' // app.npk without the TacticsPalette package
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
  console.log('[tactics]', ...args);
}

/** Put the button up where it was left. Resolves false if it can't be. */
export async function showButton(): Promise<boolean> {
  if (!palette.available) {
    problem = 'no-native';
    log('button: the TacticsPalette native module is not in this build');
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
    hiddenForView = false;
    cantWriteTicks = 0;
    shown = null; // lay the handles out afresh on the next tick
    showBoards(await listLayouts()); // for the Load list
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
  // The menu's actions are page work: saving, copying, restoring.
  enqueue(
    async () => {
      const message = await work();
      if (message) {
        toast(message);
      }
    },
    false,
    undefined,
    PAGE_WORK_TICKS,
  );
}

/** Note work that waits for the panel to be closed, whoever closed it. */
function afterClose(): void {
  enqueue(syncLibrary, true);
  enqueue(applyPageLabel, true);
  if (cleanupSwitchedOn) {
    cleanupSwitchedOn = false;
    enqueue(cleanUpIfOn, true, undefined, PAGE_WORK_TICKS);
  }
}

// ── Clean-up ────────────────────────────────────────────────────────────────

/** The menu's "Clean up automatically" was turned on: once, as it closes. */
let cleanupSwitchedOn = false;

export async function setAutoCleanup(on: boolean): Promise<void> {
  await updatePaletteSettings({autoCleanup: on});
  cleanupSwitchedOn = on;
}

/** The menu's "Clean up now", after it closes. */
export async function cleanUpNow(): Promise<string> {
  return describeCleanup(await cleanUp());
}

/**
 * The automatic clean-up, after page work: quietly, and only with delete
 * permission already given (the host can't ask with the menu closed).
 */
async function cleanUpIfOn(): Promise<void> {
  if (!(await loadPaletteSettings()).autoCleanup) {
    return;
  }
  if (!(await hasDeleteAccess())) {
    log('cleanup: on, but not allowed to delete files');
    return;
  }
  try {
    log('cleanup:', describeCleanup(await cleanUp()));
  } catch (e) {
    log('cleanup: failed', e);
  }
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

  const lib = await scanLibrary();
  if (!lib) {
    await replaceLayouts(list);
    showBoards(list);
    return; // no layouts note, or it couldn't be read: change nothing
  }
  await refreshVersions();
  const found = lib.boards;
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
  showBoards(list);
}

/** The saved boards, for the palette's Load list. */
function showBoards(list: SavedLayout[]): void {
  palette.setBoards(
    list.filter(l => l.keyword).map(l => ({keyword: l.keyword!, name: l.name})),
  );
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
export async function saveThisPage(rawName: string): Promise<string> {
  // As long as a keyword can carry it (pageOps.NAME_MAX).
  const name = boardName(rawName);
  const ctx = await getContext();
  const now = Date.now();
  // A board already saved under this name becomes a version first, so its
  // page gives up the keyword before the new page takes it: the Note app
  // refuses a keyword the note already has.
  const before = (await listLayouts()).find(
    l => l.name.toLowerCase() === name.toLowerCase(),
  );
  if (before?.keyword) {
    try {
      await archiveBoard(before.keyword, before.savedAt);
    } catch (e) {
      log('layouts: could not keep the old page', before.keyword, e);
    }
  }
  const saved = await saveToLibrary(ctx, name);
  const {layout} = await saveLayout(name, saved.pieces, ctx.pageSize, now, {
    keyword: saved.keyword,
    template: saved.template,
    background: saved.background,
    marks: saved.marks,
  });
  // This page is that board now.
  await setPageName(ctx, saved.keyword);
  await afterRename(ctx);
  await markClean(ctx);
  showBoards(await listLayouts());
  tidyVersionsLater(before?.keyword ? layout.name : null);
  return `Saved "${layout.name}".`;
}

/** Bring the menu's list of versions in line with the layouts note. */
async function refreshVersions(): Promise<void> {
  const lib = await scanLibrary();
  if (lib) {
    await replaceVersions(
      lib.versions.map(({keyword, name, template, savedAt}) => ({
        keyword,
        name,
        template,
        savedAt,
      })),
    );
  }
}

/** The page's name changed: the palette and the page itself say so. */
async function afterRename(ctx: PageContext): Promise<void> {
  await showName(ctx);
  if ((await loadPaletteSettings()).pageLabel) {
    await writePageLabel(ctx, currentName?.name ?? null);
  }
}

// ── Named pages: save, load, reset ──────────────────────────────────────────

/** Which part of the menu to open at, when the palette opens it. */
let menuFocus: 'save' | null = null;

/** For the menu: what to focus as it opens, once. */
export function takeMenuFocus(): 'save' | null {
  const f = menuFocus;
  menuFocus = null;
  return f;
}

/**
 * The palette's Save: a named page is saved again at once; the scratchpad
 * needs a name first, so the menu opens at the name box.
 */
async function saveFromPalette(): Promise<string | void> {
  const ctx = await getContext();
  const named = await pageName(ctx);
  if (!named) {
    menuFocus = 'save';
    panelOpened();
    PluginManager.showPluginView();
    return;
  }
  toast(`Saving "${named.name}"…`);
  return saveThisPage(named.name);
}

// Pages as they were right after the plugin saved, loaded or reset them, by
// a signature of their elements. A page still like that has nothing a
// version would keep that its board doesn't: Reset on it needn't copy it
// into the layouts note again, which is most of Reset's time.
const cleanPages = new Map<string, string>();
const pageKey = (ctx: PageContext) => `${ctx.notePath}#${ctx.page}`;

/** The page's elements, in order: which kind, on which layer, which number. */
async function pageSignature(ctx: PageContext): Promise<string> {
  await whenNoteQuiet(); // straight after an edit, reads are of before it
  const els = answer<
    Array<{
      type?: number;
      layerNum?: number;
      numInPage?: number;
      recycle?: () => void;
    }>
  >(await PluginFileAPI.getElements(ctx.page, ctx.notePath), 'getElements');
  const sig = els
    .map(e => `${e.type}:${e.layerNum ?? 0}:${e.numInPage}`)
    .join(',');
  els.forEach(el => el.recycle?.());
  return sig;
}

async function markClean(ctx: PageContext): Promise<void> {
  cleanPages.set(pageKey(ctx), await pageSignature(ctx));
}

/** Step timings for page work, in the log. */
function timer(what: string) {
  const start = Date.now();
  let last = start;
  return (step: string) => {
    const now = Date.now();
    log(`${what}: ${step} ${now - last} ms (${now - start} ms in all)`);
    last = now;
  };
}

/**
 * Keep this page as a version before it's replaced, unless it's blank or
 * just as it was last saved or loaded. Filed under its name, or as the
 * scratchpad. Returns the name, or null when nothing was kept.
 */
async function keepAsVersion(ctx: PageContext): Promise<string | null> {
  const sig = await pageSignature(ctx);
  if (!sig || cleanPages.get(pageKey(ctx)) === sig) {
    return null;
  }
  const name = (await pageName(ctx))?.name ?? SCRATCHPAD;
  const now = Date.now();
  await saveToLibrary(ctx, name, () => versionKeyword(name, now));
  return name;
}

/**
 * Put a layouts-note page in place of this one, keeping this one as a
 * version first. `board` names the page it becomes (null: scratchpad).
 */
async function replaceWith(
  entry: LibraryEntry,
  board: {keyword: string; name: string} | null,
  background?: string,
): Promise<{kept: string | null; replaced: boolean; page: number}> {
  const step = timer('replace');
  const ctx = await getContext();
  const kept = await keepAsVersion(ctx);
  step(kept ? 'kept the page as a version' : 'nothing to keep');
  // The version went on the end of the layouts note: entry.page still holds.
  // Same background: refill this page's layers in place, quick. Otherwise
  // (or if that fails part-way; the page is kept as a version) a new page
  // takes this one's place.
  let r: {page: number; jumped: boolean; replaced: boolean};
  const labelOn = (await loadPaletteSettings()).pageLabel;
  const label = labelOn ? board?.name ?? null : undefined;
  const inPlace = await replaceInPlace(ctx, entry, label).catch(e => {
    log('replace: in place failed; replacing the page', e);
    return false;
  });
  if (inPlace) {
    if (board) {
      await setPageName(ctx, board.keyword);
    } else {
      await clearPageName(ctx);
    }
    r = {page: ctx.page, jumped: true, replaced: true};
    step('refilled the page in place');
  } else {
    r = await replacePage(ctx, entry, board?.keyword ?? null, background);
    step('replaced the page');
  }
  const now = {...ctx, page: r.page};
  shown = null; // lay the handles out afresh
  if (r.jumped) {
    await showName(now);
    step('named');
    if (labelOn && !inPlace) {
      await writePageLabel(now, currentName?.name ?? null);
      step('labelled');
    }
    await markClean(now);
    step('noted as unchanged');
  }
  tidyVersionsLater(kept);
  return {kept, replaced: r.replaced, page: r.page};
}

/**
 * Prune a name's old versions and refresh the menu's list of them, after
 * the page work is done and its message shown: each reads every keyword in
 * the layouts note, seconds when it's grown, and nothing waits on either.
 */
function tidyVersionsLater(name: string | null): void {
  enqueue(
    async () => {
      if (name) {
        await pruneVersions(name).catch(e => log('versions: prune failed', e));
      }
      await refreshVersions();
      await cleanUpIfOn();
    },
    true,
    undefined,
    PAGE_WORK_TICKS,
  );
}

function keptNote(kept: string | null): string {
  return kept ? ' The page as it was is under Previous versions.' : '';
}

/** The palette's Load: this page becomes the saved board. */
export async function loadBoardHere(keyword: string): Promise<string> {
  const lib = await scanLibrary();
  const entry = lib?.boards.find(b => b.keyword === keyword);
  if (!entry) {
    throw new Error(`Couldn't find that board in ${LIBRARY_NAME}.`);
  }
  toast(`Loading "${entry.name}"…`);
  const layout = (await listLayouts()).find(l => l.keyword === keyword);
  const r = await replaceWith(entry, entry, layout?.background);
  return r.replaced
    ? `Loaded "${entry.name}".${keptNote(r.kept)}`
    : `"${entry.name}" added as page ${
        r.page + 1
      }, after this one. Turn the page to see it.`;
}

/** The palette's Reset: this page back to how its board was last saved. */
export async function resetPage(): Promise<string> {
  const ctx = await getContext();
  const named = await pageName(ctx);
  if (!named) {
    return "This page hasn't been saved yet, so there's nothing to reset it to.";
  }
  const lib = await scanLibrary();
  const entry =
    lib?.boards.find(b => b.keyword === named.keyword) ??
    lib?.boards.find(b => b.name.toLowerCase() === named.name.toLowerCase());
  if (!entry) {
    throw new Error(`Couldn't find "${named.name}" in ${LIBRARY_NAME}.`);
  }
  toast(`Resetting "${entry.name}"…`);
  const layout = (await listLayouts()).find(l => l.keyword === entry.keyword);
  const r = await replaceWith(entry, entry, layout?.background);
  return r.replaced
    ? `Reset "${entry.name}" to its last save.${keptNote(r.kept)}`
    : `The saved "${entry.name}" was added as page ${
        r.page + 1
      }. Turn the page to see it.`;
}

/**
 * The palette's Trash, tapped twice: this page back to blank, and unnamed,
 * so it's the Scratchpad. Its background stays: a page can't change that.
 */
export async function clearPage(): Promise<string> {
  const ctx = await getContext();
  // Kept as a version first, as Reset keeps the page it replaces: not when
  // it's blank, or just as it was last saved or loaded.
  const kept = await keepAsVersion(ctx);
  await clearInPlace(ctx);
  await clearPageName(ctx);
  shown = null; // lay the (now no) handles out afresh
  await showName(ctx);
  await markClean(ctx);
  tidyVersionsLater(kept);
  return `Cleared this page.${keptNote(kept)}`;
}

/** Put an earlier version in place of this page. */
export async function restoreVersion(keyword: string): Promise<string> {
  const lib = await scanLibrary();
  const entry = lib?.versions.find(v => v.keyword === keyword);
  if (!entry) {
    throw new Error(`Couldn't find that version in ${LIBRARY_NAME}.`);
  }
  // Versions don't carry their template (the keyword's too short); the page
  // they're on knows it.
  const template =
    entry.template || (await templateNameOf(await libraryPage(entry.page)));
  const board =
    entry.name === SCRATCHPAD
      ? null
      : {keyword: layoutKeyword(template, entry.name), name: entry.name};
  const r = await replaceWith(entry, board);
  return r.replaced
    ? `Restored "${entry.name}" as it was.${keptNote(r.kept)}`
    : `The version was added as page ${r.page + 1}. Turn the page to see it.`;
}

/** The menu's "name on the page" switch: applied once the menu has closed. */
let labelChanged = false;

export async function setPageLabelOn(on: boolean): Promise<void> {
  await updatePaletteSettings({pageLabel: on});
  labelChanged = true;
}

/**
 * As the menu closes: switched off, the label comes off this page; on, this
 * page gets one (an older page too, so opening and closing the menu on it
 * labels it). Nothing's written when the page already says so.
 */
async function applyPageLabel(): Promise<void> {
  const on = (await loadPaletteSettings()).pageLabel;
  if (!labelChanged && !on) {
    return;
  }
  labelChanged = false;
  const ctx = await getContext();
  const named = await pageName(ctx);
  await writePageLabel(ctx, on && named ? named.name : null);
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
      const started = Date.now();
      log('drop:', e.kind, 'at screen', Math.round(e.x), Math.round(e.y));
      const where = await atPage(e);
      if (where) {
        const layer = await piecesLayer(where.ctx, true);
        const strokes = await dragStrokesToDrop(where.ctx, layer);
        const piece = await placePiece(
          where.ctx,
          e.kind as PieceKind,
          where.at,
          strokes,
          layer,
        );
        if (strokes.length > 0) {
          log('pen: removed', strokes.length, 'stroke(s) drawn by a drag');
        }
        log(
          'drop: placed',
          piece.kind,
          piece.id,
          'on page',
          where.ctx.page + 1,
          `in ${Date.now() - started} ms`,
        );
        await updateHandles(where.ctx, pieces => [...pieces, piece]);
      }
      return;
    }

    case 'move': {
      const started = Date.now();
      log('move:', e.id);
      const where = await atPage(e);
      if (where) {
        await deleteDragStrokes(where.ctx);
        const tag = await movePiece(where.ctx, e.id, where.at);
        renumberedAt = Date.now();
        log(
          'move:',
          tag ? 'moved' : 'not found on the page',
          `in ${Date.now() - started} ms`,
        );
        if (tag) {
          await updateHandles(where.ctx, pieces =>
            pieces.map(p => (p.id === tag.id ? {...p, x: tag.x, y: tag.y} : p)),
          );
        } else {
          await syncHandles(where.ctx);
        }
      }
      return;
    }

    case 'save': {
      const message = await saveFromPalette();
      if (message) {
        toast(message);
      }
      return;
    }

    case 'load':
      toast(await loadBoardHere(e.keyword));
      return;

    case 'reset':
      toast(await resetPage());
      return;

    case 'copy':
      toast(await copyThisPage());
      return;

    case 'clear':
      toast(await clearPage());
      return;

    case 'remove': {
      log('remove:', e.id);
      const ctx = await getContext();
      await deleteDragStrokes(ctx);
      const removed = await removePiece(ctx, e.id);
      renumberedAt = Date.now();
      if (removed) {
        await updateHandles(ctx, pieces => pieces.filter(p => p.id !== e.id));
      } else {
        await syncHandles(ctx);
      }
      return;
    }
  }
}

/**
 * After the plugin's own edit of this page: the handles from what it last
 * read, changed by `edit`, or a fresh read if it last read another page.
 */
async function updateHandles(
  ctx: PageContext,
  edit: (pieces: PagePiece[]) => PagePiece[],
): Promise<void> {
  if (
    current &&
    current.ctx.notePath === ctx.notePath &&
    current.ctx.page === ctx.page
  ) {
    await showHandles(ctx, edit(current.pieces));
  } else {
    await syncHandles(ctx);
  }
}

function explain(e: unknown): string {
  if (e instanceof NotANoteError) {
    return e.message;
  }
  return `Tactics Board: ${(e as Error)?.message ?? String(e)}`;
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
/**
 * Saving, loading, resetting and copying pages take seconds, more with a big
 * layouts note. Given up on after 10 ticks they'd carry on underneath the
 * next job, two page edits at once, so they get this long instead.
 */
const PAGE_WORK_TICKS = 90;

interface Job {
  work: () => Promise<void>;
  quiet: boolean;
  /** The palette event it handles, if any. */
  kind?: PaletteEvent['type'];
  /** Ticks before it's given up on. */
  limit: number;
}

const jobs: Job[] = [];
let running: {ticks: number; limit: number; giveUp: () => void} | null = null;

function enqueue(
  work: () => Promise<void>,
  quiet = false,
  kind?: Job['kind'],
  limit = WATCHDOG_TICKS,
): void {
  jobs.push({work, quiet, kind, limit});
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
  const me = {ticks: 0, limit: job.limit, giveUp};
  running = me;
  // So a pen hovering over the button doesn't lock (and open our view) mid-edit.
  palette.setBusy(true);
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
      console.error('[tactics] palette work failed', err);
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
      if (!running) {
        palette.setBusy(false);
      }
    });
}

/** Each native tick: count against the running job. */
function watchdog(): void {
  if (running && ++running.ticks >= running.limit) {
    running.giveUp();
  }
}

// ── The pen ─────────────────────────────────────────────────────────────────
//
// A pen drag on the button, the palette or a piece would also write into the
// note (the digitizer writes whatever window the pen is over). Two defences:
//  1. The native module locks the pen while it hovers over those windows and
//     for any drag (see TacticsPaletteModule), which opens the plugin's view in
//     the background; while it's locked the menu stays blank and the
//     lifecycle's "start" is not the menu opening.
//  2. Any stroke that got through anyway, begun before the lock landed, is
//     deleted: the SDK's event_pen_up hands over each finished stroke, and one
//     that ends during a pen drag, or just after, came from the drag. It's
//     deleted before any edit that renumbers the page (the queue's order),
//     or in the same edit as a drop when one follows, and checked against
//     its fields first so a renumbered page never loses the wrong stroke.

let penLocked = false;
/**
 * The last pen drag on the button, the palette or a piece: whether it's
 * still going, when it ended, where it started, and whether locking was on.
 */
let penDrag: {
  active: boolean;
  endedAt: number;
  from?: 'button' | 'palette' | 'piece';
  locks?: boolean;
} = {active: false, endedAt: 0};
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
  if (!on) {
    // Every unlock sets the Note app reloading the page, and an edit
    // meanwhile crashes it: wait it out even when the lock was already
    // thought lifted (a native "off" can arrive late or twice).
    noteBusyFor(AFTER_UNLOCK_MS);
  }
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

/**
 * A stroke a pen drag drew, as event_pen_up reported it: its number on the
 * page, and a few of its fields to make sure that number is still it. (Its
 * uuid won't do: that names the SDK's cached copy, not the stroke.)
 */
interface DragStroke {
  num: number;
  print: Record<string, number>;
  /** Reported after a move or removal renumbered the page. */
  late: boolean;
}

/** When a move or removal last renumbered the page's elements. */
let renumberedAt = 0;

/** Drag strokes waiting to be deleted. */
let dragStrokes: DragStroke[] = [];

type RawStroke = {
  type?: number;
  numInPage?: number;
  layerNum?: number;
  thickness?: number;
  recognizeResult?: Record<string, unknown> | null;
  recycle?: () => void;
};

/** Fields both event_pen_up and getElements give a stroke, when numbers. */
function fingerprint(el: RawStroke): Record<string, number> {
  const print: Record<string, number> = {};
  const take = (key: string, v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      print[key] = v;
    }
  };
  take('layerNum', el.layerNum);
  take('thickness', el.thickness);
  for (const [k, v] of Object.entries(el.recognizeResult ?? {})) {
    take(`recognizeResult.${k}`, v);
  }
  return print;
}

/** Whether `el` still is the stroke `s`: every field both have agrees. */
function isStroke(el: RawStroke, s: DragStroke): boolean {
  const now = fingerprint(el);
  const shared = Object.keys(s.print).filter(k => k in now);
  if (s.late && shared.length === 0) {
    return false; // its number may be another stroke's now, and nothing says
  }
  return Object.entries(s.print).every(
    ([k, v]) => !(k in now) || Math.abs(now[k] - v) < 0.5,
  );
}

/** Where the drag strokes are on this page now: numbers by layer. */
async function findDragStrokes(
  ctx: PageContext,
  strokes: DragStroke[],
): Promise<Map<number, number[]>> {
  const byNum = new Map(strokes.map(s => [s.num, s]));
  const els = answer<RawStroke[]>(
    await PluginFileAPI.getElements(ctx.page, ctx.notePath),
    'getElements',
  );
  const byLayer = new Map<number, number[]>();
  for (const el of els) {
    const num = el.numInPage;
    const s = num != null ? byNum.get(num) : undefined;
    if (s && el.type === TYPE_STROKE) {
      if (isStroke(el, s)) {
        const layer = el.layerNum ?? 0;
        byLayer.set(layer, [...(byLayer.get(layer) ?? []), num!]);
      } else {
        // Renumbered by an edit in between: better left than the wrong one.
        log('pen: stroke', num, 'is not the drag stroke any more; left alone');
      }
    }
    el.recycle?.();
  }
  return byLayer;
}

async function deleteStrokes(
  ctx: PageContext,
  byLayer: Map<number, number[]>,
): Promise<void> {
  for (const [layer, list] of byLayer) {
    check(
      await pageEdit(() =>
        PluginCommAPI.deletePageElements(
          [...list].sort((a, b) => b - a),
          ctx.page,
          layer,
        ),
      ),
      'deletePageElements',
    );
    log('pen: removed', list.length, 'stroke(s) drawn by a drag');
  }
}

/** Delete strokes the pen drew while dragging: only strokes, only these. */
async function flushDragStrokes(): Promise<void> {
  // A drop waiting behind this deletes them in its own edit: one redraw.
  if (dragStrokes.length === 0 || jobs.some(j => j.kind === 'drop')) {
    return;
  }
  await deleteDragStrokes(await getContext());
}

/** Delete the pending drag strokes now, as a move or removal must first. */
async function deleteDragStrokes(ctx: PageContext): Promise<void> {
  if (dragStrokes.length === 0) {
    return;
  }
  const strokes = dragStrokes;
  dragStrokes = [];
  await deleteStrokes(ctx, await findDragStrokes(ctx, strokes));
}

/**
 * The drag strokes a drop can delete in its own edit: those on the pieces
 * layer. Any elsewhere (a page with a Pieces layer) are deleted first.
 */
async function dragStrokesToDrop(
  ctx: PageContext,
  layer: number,
): Promise<number[]> {
  if (dragStrokes.length === 0) {
    return [];
  }
  const strokes = dragStrokes;
  dragStrokes = [];
  const byLayer = await findDragStrokes(ctx, strokes);
  const here = byLayer.get(layer) ?? [];
  byLayer.delete(layer);
  await deleteStrokes(ctx, byLayer);
  return here;
}

/**
 * With pen locking off, a piece dragged on the page leaves the line it drew,
 * as any pen stroke would; a piece brought from the palette (or the button
 * moved) still has its line erased.
 */
function keepsDragStrokes(): boolean {
  return penDrag.from === 'piece' && penDrag.locks === false;
}

function onPenUp(data: unknown): void {
  if (!fromPenDrag() || keepsDragStrokes()) {
    return;
  }
  const list = (Array.isArray(data) ? data : [data]) as RawStroke[];
  const strokes = list
    .filter(el => el?.type === TYPE_STROKE && typeof el.numInPage === 'number')
    .map(el => ({
      num: el.numInPage!,
      print: fingerprint(el),
      late: !penDrag.active && renumberedAt > penDrag.endedAt,
    }));
  for (const s of strokes) {
    log('pen: drag stroke', s.num, JSON.stringify(s.print));
  }
  if (strokes.length > 0) {
    dragStrokes.push(...strokes);
    enqueue(flushDragStrokes, true);
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
  // Page edits wait out the Note app's redraws on the native clock: JS
  // timers stop while the panel is closed.
  setSleeper(ms => palette.wait(ms));
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
        ? {active: true, endedAt: 0, from: event.from, locks: event.locks}
        : {...penDrag, active: false, endedAt: Date.now()};
      return;
    }
    if (event.type === 'tick') {
      watchdog();
      if (penLocked) {
        hintLiftPen();
      }
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
    // Save / Load / Reset replace or copy whole pages and take seconds.
    // Taps while one is waiting or running are dropped, not queued: queued,
    // a few impatient taps became a string of resets.
    if (
      event.type === 'save' ||
      event.type === 'load' ||
      event.type === 'copy' ||
      event.type === 'reset' ||
      event.type === 'clear'
    ) {
      if (pageActionBusy) {
        toast(
          waitingAction && penLocked
            ? liftHint(waitingAction.kind)
            : 'Still working on the last one.',
        );
        return;
      }
      pageActionBusy = true;
      waitingAction = {kind: event.type, ticks: 0, hinted: false};
      enqueue(
        () => {
          waitingAction = null;
          return handle(event).finally(() => {
            pageActionBusy = false;
          });
        },
        false,
        event.type,
        PAGE_WORK_TICKS,
      );
      return;
    }
    enqueue(() => handle(event), false, event.type);
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
  resetNoteGate();
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
  dragStrokes = [];
  renumberedAt = 0;
  ticksSinceRead = 0;
  pageActionBusy = false;
  waitingAction = null;
  cleanupSwitchedOn = false;
  canWriteAsk = null;
  lastCanWrite = '';
  cantWriteTicks = 0;
  hiddenForView = false;
  cleanPages.clear();
}
