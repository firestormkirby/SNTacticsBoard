/**
 * Named pages ("boards") and their earlier versions.
 *
 * A page of the user's note is named by a keyword on it, the same one its
 * saved copy carries in the layouts note: "~BOARD:<template>:<name>". A page
 * without one is the scratchpad. So a named page knows which board it is:
 * saving it again updates that board, and resetting it goes back to it.
 *
 * Nothing is thrown away. Before a board's saved copy is replaced, it becomes
 * a version ("~BOARD-OLD:...", pageOps.ts); before a page is replaced by a
 * load or a reset, the page as it was is saved as a version too. A board
 * keeps its last VERSIONS_KEPT.
 */
import {
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
} from 'sn-plugin-lib';

import {pageEdit, whenNoteQuiet} from '../sdk/noteGate';
import {answer, check} from '../sdk/response';
import {
  LibraryEntry,
  NewPage,
  PageContext,
  VERSIONS_KEPT,
  backgroundOf,
  copyPageTo,
  libraryPage,
  libraryPath,
  pageTemplate,
  parseLayoutKeyword,
  piecesLayer,
  readPieces,
  recordPieces,
  sameBackground,
  scanLibrary,
  tryJumpToPage,
  versionKeyword,
} from './pageOps';

export const SCRATCHPAD = 'Scratchpad';

export interface PageName {
  keyword: string;
  name: string;
  template: string;
}

async function keywordsOf(
  ctx: PageContext,
): Promise<Array<{keyword: string; index: number}>> {
  const all =
    answer<Array<{keyword: string; page: number; index?: number}> | null>(
      await PluginFileAPI.getKeyWords(ctx.notePath, [ctx.page]),
      'getKeyWords',
    ) ?? [];
  // deleteKeyWord takes the firmware's index for a keyword: from 1, on a
  // Manta, so not its place in the list.
  return all
    .filter(k => k.page === ctx.page)
    .map((k, i) => ({keyword: k.keyword ?? '', index: k.index ?? i}));
}

/** This page's board keywords: its name, one normally. */
async function boardKeywordsOf(
  ctx: PageContext,
): Promise<Array<{keyword: string; index: number}>> {
  return (await keywordsOf(ctx)).filter(k => parseLayoutKeyword(k.keyword));
}

/** The board this page is, or null for the scratchpad. */
export async function pageName(ctx: PageContext): Promise<PageName | null> {
  for (const {keyword} of await boardKeywordsOf(ctx)) {
    const parts = parseLayoutKeyword(keyword);
    if (parts) {
      return {keyword, ...parts};
    }
  }
  return null;
}

/** Take any board name off a page: it's the scratchpad after. */
export async function clearPageName(ctx: PageContext): Promise<void> {
  const mine = await boardKeywordsOf(ctx);
  if (mine.length === 0) {
    return;
  }
  // Highest index first, so the indexes of the rest hold.
  for (const k of [...mine].sort((a, b) => b.index - a.index)) {
    check(
      await PluginFileAPI.deleteKeyWord(ctx.notePath, ctx.page, k.index),
      'deleteKeyWord',
    );
  }
}

/** Where a keyword is in the note: each page it's on, and its index there. */
async function holdersOf(
  notePath: string,
  keyword: string,
): Promise<Array<{page: number; index: number}>> {
  const total = answer<number>(
    await PluginFileAPI.getNoteTotalPageNum(notePath),
    'getNoteTotalPageNum',
  );
  const all =
    answer<Array<{keyword: string; page: number; index?: number}> | null>(
      await PluginFileAPI.getKeyWords(
        notePath,
        Array.from({length: total}, (_, i) => i),
      ),
      'getKeyWords',
    ) ?? [];
  const perPage = new Map<number, number>();
  const holders: Array<{page: number; index: number}> = [];
  for (const k of all) {
    const place = perPage.get(k.page) ?? 0;
    perPage.set(k.page, place + 1);
    if (k.keyword === keyword) {
      holders.push({page: k.page, index: k.index ?? place});
    }
  }
  return holders;
}

/**
 * Put a board's keyword on a page. The Note app refuses a keyword the note
 * already has ("Duplicate keyword"): then another page is still named for
 * the board, and gives the name up to this one.
 */
async function tagPage(ctx: PageContext, keyword: string): Promise<void> {
  const res = (await PluginFileAPI.insertKeyWord(
    ctx.notePath,
    ctx.page,
    keyword,
  )) as {success?: boolean; error?: {message?: string}} | null;
  if (res?.success === false) {
    if (!/duplicate/i.test(res?.error?.message ?? '')) {
      check(res, 'insertKeyWord');
    }
    // Highest index first, so the indexes of the rest hold.
    const holders = await holdersOf(ctx.notePath, keyword);
    for (const h of holders.sort((a, b) => b.index - a.index)) {
      check(
        await PluginFileAPI.deleteKeyWord(ctx.notePath, h.page, h.index),
        'deleteKeyWord',
      );
    }
    check(
      await PluginFileAPI.insertKeyWord(ctx.notePath, ctx.page, keyword),
      'insertKeyWord',
    );
  }
}

/** Make this page the board `keyword`, dropping any name it had. */
export async function setPageName(
  ctx: PageContext,
  keyword: string,
): Promise<void> {
  const mine = await boardKeywordsOf(ctx);
  if (mine.length === 1 && mine[0].keyword === keyword) {
    return;
  }
  await clearPageName(ctx);
  await tagPage(ctx, keyword);
}

// ── Versions ────────────────────────────────────────────────────────────────

/**
 * Turn a board's saved page into a version of it, as its replacement is
 * saved: retag it, so the page itself stays as it was. `except` is the page
 * just saved under the same keyword.
 */
export async function archiveBoard(
  keyword: string,
  savedAt: number,
  except?: number,
): Promise<void> {
  const lib = await scanLibrary();
  const entry = lib?.boards.find(
    b => b.keyword === keyword && b.page !== except,
  );
  if (!entry) {
    return;
  }
  const libPath = await libraryPath();
  check(
    await PluginFileAPI.deleteKeyWord(libPath, entry.page, entry.index),
    'deleteKeyWord',
  );
  check(
    await PluginFileAPI.insertKeyWord(
      libPath,
      entry.page,
      versionKeyword(entry.name, savedAt),
    ),
    'insertKeyWord',
  );
}

/** Keep a board's last VERSIONS_KEPT versions; remove older ones' pages. */
export async function pruneVersions(name: string): Promise<void> {
  const lib = await scanLibrary();
  if (!lib) {
    return;
  }
  const mine = lib.versions
    .filter(v => v.name.toLowerCase() === name.toLowerCase())
    .sort((a, b) => b.savedAt - a.savedAt);
  const old = mine.slice(VERSIONS_KEPT);
  if (old.length === 0) {
    return;
  }
  const libPath = await libraryPath();
  let total = answer<number>(
    await PluginFileAPI.getNoteTotalPageNum(libPath),
    'getNoteTotalPageNum',
  );
  // Highest page first, so the pages still to go keep their numbers.
  for (const v of [...old].sort((a, b) => b.page - a.page)) {
    if (total > 1) {
      check(
        await PluginFileAPI.removeNotePage(libPath, v.page),
        'removeNotePage',
      );
      total--;
    }
  }
}

// ── Replacing a page ────────────────────────────────────────────────────────

/**
 * Put a copy of a layouts-note page in place of this one: the copy goes in
 * after it, the note turns to it, and this page goes. Where the firmware
 * can't turn pages, this page stays and the copy is left after it.
 * `name` tags the copy as that board.
 */
export async function replacePage(
  ctx: PageContext,
  src: LibraryEntry,
  name: string | null,
  background?: string,
): Promise<NewPage & {replaced: boolean}> {
  await whenNoteQuiet();
  check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  const from = await libraryPage(src.page);
  const bg =
    background && (await FileUtils.exists(background))
      ? background
      : await backgroundOf(from);
  const at = ctx.page + 1;
  // This page is going: its name goes first, so the copy can take it.
  await clearPageName(ctx);
  await copyPageTo(from, ctx.notePath, at, bg);
  if (name) {
    await tagPage({...ctx, page: at}, name);
  }
  if (!(await tryJumpToPage(at))) {
    return {page: at, jumped: false, replaced: false};
  }
  check(
    await PluginFileAPI.removeNotePage(ctx.notePath, ctx.page),
    'removeNotePage',
  );
  const jumped = await tryJumpToPage(ctx.page);
  return {page: ctx.page, jumped, replaced: true};
}

type Layered = {
  layerNum?: number;
  userData?: string;
  numInPage?: number;
  recycle?: () => void;
};

function byLayer<T extends Layered>(els: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const el of els) {
    const layer = el.layerNum ?? 0;
    m.set(layer, [...(m.get(layer) ?? []), el]);
  }
  return m;
}

/**
 * Put a layouts-note page's contents onto this page, in place: each layer
 * emptied and refilled in one edit, the page itself left where it is. Much
 * quicker than replacePage (no page to add, turn to and remove, and so no
 * whole-note reload), but only for the same background, which a page can't
 * swap in place. Resolves false, having changed nothing, when they differ.
 *
 * `label` is the name to write on the page in the same edit (null: none),
 * in place of the saved page's; left out, the saved page's stays. The page
 * can't be read to see what's on it for a while after an edit (it reads as
 * it was), so it's put right here, not after.
 */
export async function replaceInPlace(
  ctx: PageContext,
  src: LibraryEntry,
  label?: string | null,
): Promise<boolean> {
  const from = await libraryPage(src.page);
  if (!sameBackground(await pageTemplate(ctx), await pageTemplate(from))) {
    return false;
  }
  await whenNoteQuiet();
  const pieces = await readPieces(from); // also saves the open note

  // Layers the saved page has and this one lacks (a Pieces layer, say).
  const want = answer<Array<{layerId?: number; name?: string}>>(
    await PluginFileAPI.getLayers(from.notePath, from.page),
    'getLayers',
  );
  const have = new Set(
    answer<Array<{layerId?: number}>>(
      await PluginFileAPI.getLayers(ctx.notePath, ctx.page),
      'getLayers',
    ).map(l => l.layerId),
  );
  for (const l of want) {
    if (l.layerId && l.layerId > 0 && !have.has(l.layerId)) {
      check(
        await PluginFileAPI.insertLayer(ctx.notePath, ctx.page, {
          layerId: l.layerId,
          name: l.name ?? `Layer ${l.layerId}`,
          isCurrentLayer: false,
          isVisible: true,
        }),
        'insertLayer',
      );
    }
  }

  const mine = answer<Layered[]>(
    await PluginFileAPI.getElements(ctx.page, ctx.notePath),
    'getElements',
  );
  const all = answer<Layered[]>(
    await PluginFileAPI.getElements(from.page, from.notePath),
    'getElements',
  );
  const theirs =
    label === undefined ? all : all.filter(el => el.userData !== LABEL_TAG);
  if (label) {
    theirs.push(
      (await labelElement(ctx, label, await piecesLayer(ctx, true))) as Layered,
    );
  }
  try {
    const old = byLayer(mine);
    const next = byLayer(theirs);
    for (const layer of new Set([...old.keys(), ...next.keys()])) {
      const del = (old.get(layer) ?? [])
        .map(e => e.numInPage)
        .filter((n): n is number => n != null)
        .sort((a, b) => b - a);
      const add = next.get(layer) ?? [];
      if (add.length === 0) {
        check(
          await pageEdit(() =>
            PluginCommAPI.deletePageElements(del, ctx.page, layer),
          ),
          'deletePageElements',
        );
      } else if (del.length === 0) {
        check(
          await pageEdit(() =>
            PluginCommAPI.insertPageElements(add, ctx.page, layer),
          ),
          'insertPageElements',
        );
      } else {
        check(
          await pageEdit(() =>
            PluginCommAPI.batchUpdatePageElements(del, add, ctx.page, layer),
          ),
          'batchUpdatePageElements',
        );
      }
    }
  } finally {
    [...mine, ...all].forEach(el => el.recycle?.());
  }
  // The Note app doesn't always redraw after the last of those: the page
  // changed, but the screen showed it as it was. Turning to it redraws it.
  await pageEdit(() => tryJumpToPage(ctx.page));
  await recordPieces(ctx, pieces);
  return true;
}

/**
 * Empty this page, every layer, in place: one edit per layer, as
 * replaceInPlace does, so its background and layers stay as they are.
 */
export async function clearInPlace(ctx: PageContext): Promise<number> {
  await whenNoteQuiet();
  const mine = answer<Layered[]>(
    await PluginFileAPI.getElements(ctx.page, ctx.notePath),
    'getElements',
  );
  let cleared = 0;
  try {
    for (const [layer, els] of byLayer(mine)) {
      const nums = els
        .map(e => e.numInPage)
        .filter((n): n is number => n != null)
        .sort((a, b) => b - a);
      if (nums.length > 0) {
        check(
          await pageEdit(() =>
            PluginCommAPI.deletePageElements(nums, ctx.page, layer),
          ),
          'deletePageElements',
        );
        cleared += nums.length;
      }
    }
  } finally {
    mine.forEach(el => el.recycle?.());
  }
  if (cleared > 0) {
    // As after replaceInPlace: the Note app doesn't always redraw.
    await pageEdit(() => tryJumpToPage(ctx.page));
  }
  await recordPieces(ctx, []);
  return cleared;
}

// ── The name on the page ────────────────────────────────────────────────────

const LABEL_TAG = 'tacticsboard:v1:label';
const TYPE_TEXT = 500;

/**
 * Write the page's name at the top of it, on the pieces layer, or take it
 * off (null). A text box the Note app draws, tagged so it's found again.
 */
export async function writePageLabel(
  ctx: PageContext,
  text: string | null,
): Promise<void> {
  // Read after the last edit has landed: straight after one, the page's
  // elements still read as they were before it.
  await whenNoteQuiet();
  const els = answer<
    Array<{
      userData?: string;
      numInPage?: number;
      layerNum?: number;
      textBox?: {textContentFull?: string} | null;
      recycle?: () => void;
    }>
  >(await PluginFileAPI.getElements(ctx.page, ctx.notePath), 'getElements');
  const old = new Map<number, number[]>();
  const texts: Array<string | undefined> = [];
  for (const el of els) {
    if (el.userData === LABEL_TAG && el.numInPage != null) {
      const layer = el.layerNum ?? 0;
      old.set(layer, [...(old.get(layer) ?? []), el.numInPage]);
      texts.push(el.textBox?.textContentFull);
    }
    el.recycle?.();
  }
  // Already says so (a page loaded or reset from a labelled save): each
  // delete and insert is a redraw of the page, a second or more each.
  if (text && texts.length === 1 && texts[0] === text) {
    return;
  }
  for (const [layer, nums] of old) {
    check(
      await pageEdit(() =>
        PluginCommAPI.deletePageElements(
          nums.sort((a, b) => b - a),
          ctx.page,
          layer,
        ),
      ),
      'deletePageElements',
    );
  }
  if (!text) {
    return;
  }
  const layer = await piecesLayer(ctx, true);
  const el = await labelElement(ctx, text, layer);
  check(
    await pageEdit(() =>
      PluginCommAPI.insertPageElements([el], ctx.page, layer),
    ),
    'insertPageElements',
  );
}

/** The name at the top of a page: a text box, tagged so it's found again. */
async function labelElement(
  ctx: PageContext,
  text: string,
  layer: number,
): Promise<Record<string, unknown>> {
  const el = answer<Record<string, unknown>>(
    await PluginCommAPI.createElement(TYPE_TEXT),
    'createElement',
  );
  const w = ctx.pageSize.width;
  const fontSize = Math.round(w * 0.022);
  el.type = TYPE_TEXT;
  el.layerNum = layer;
  el.userData = LABEL_TAG;
  el.textBox = {
    textContentFull: text,
    // Across the top middle: clear of the Note toolbar on either side.
    textRect: {
      left: Math.round(w * 0.2),
      top: Math.round(w * 0.012),
      right: Math.round(w * 0.8),
      bottom: Math.round(w * 0.012 + fontSize * 1.6),
    },
    fontSize,
    textAlign: 1,
    textBold: 1,
    textItalics: 0,
    textFrameWidthType: 0,
    textFrameStyle: 0,
    textEditable: 0,
  };
  return el;
}
