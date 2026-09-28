/**
 * Everything the plugin does to a note page: place, move and remove pieces,
 * copy a page, add a pitch page, and save pages to and load them from the
 * layouts note.
 *
 * All of it runs with the plugin panel CLOSED (state 0), driven by events from
 * the floating palette. That is where Modulanner does its page work on
 * devices: SDK calls can deadlock while the panel is open, and none of this
 * waits on a JS timer, which the host suspends in state 0.
 *
 * Finding our own pieces again
 * ────────────────────────────
 * Each piece is several geometry elements, all tagged in `userData` with the
 * piece's kind, id and centre (see pieceShapes.ts). Modulanner found that some
 * firmware does not keep `userData`, so every write is also recorded in
 * AsyncStorage per note page, and untagged elements whose geometry exactly
 * matches a recorded piece count as that piece. The match is exact to a
 * pixel, so it cannot pick up the user's own drawing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
} from 'sn-plugin-lib';

import {answer, check} from '../sdk/response';
import {
  GeoSpec,
  PIECE_PEN,
  PieceKind,
  PieceTag,
  Point,
  newPieceId,
  parseTag,
  pieceSizeFor,
  shapesFor,
  tagFor,
} from './pieceShapes';

const TYPE_GEO = 700;
/** Name of the layer pieces go on, where a page has one. */
export const PIECES_LAYER_NAME = 'Pieces';
/** Where the plugin keeps PNGs the note app has to read. */
export const EXPORT_SUBDIR = 'SNSoccer';

export interface PageContext {
  notePath: string;
  page: number;
  pageSize: {width: number; height: number};
}

/** A piece found on the page, and the elements that draw it. */
export interface PagePiece extends PieceTag {
  layer: number;
  nums: number[];
}

// ── Context ─────────────────────────────────────────────────────────────────

export class NotANoteError extends Error {}

export async function getContext(): Promise<PageContext> {
  const notePath = answer<string>(
    await PluginCommAPI.getCurrentFilePath(),
    'getCurrentFilePath',
  );
  if (!/\.note$/i.test(notePath)) {
    throw new NotANoteError('Open a note to use Soccer Board.');
  }
  const page = answer<number>(
    await PluginCommAPI.getCurrentPageNum(),
    'getCurrentPageNum',
  );
  const pageSize = answer<{width: number; height: number}>(
    await PluginFileAPI.getPageSize(notePath, page),
    'getPageSize',
  );
  return {notePath, page, pageSize};
}

export async function exportDir(): Promise<string> {
  const root: string = await FileUtils.getExportPath();
  const dir = `${root}/${EXPORT_SUBDIR}`;
  await FileUtils.makeDir(dir);
  return dir;
}

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Where the blank pitch background for a page size is kept. */
export async function pitchPngPath(size: {
  width: number;
  height: number;
}): Promise<string> {
  return `${await exportDir()}/pitch-${size.width}x${size.height}.png`;
}

// ── Registry: the fallback for firmware that drops userData ─────────────────

const registryKey = (ctx: PageContext) =>
  `snsoccer:page:v1:${ctx.notePath}#${ctx.page}`;

async function loadRegistry(ctx: PageContext): Promise<PieceTag[]> {
  try {
    const json = await AsyncStorage.getItem(registryKey(ctx));
    const list = json ? (JSON.parse(json) as unknown[]) : [];
    return list
      .map(item => parseTag(item))
      .filter((t): t is PieceTag => t !== null);
  } catch {
    return [];
  }
}

async function saveRegistry(ctx: PageContext, pieces: PieceTag[]) {
  try {
    await AsyncStorage.setItem(
      registryKey(ctx),
      JSON.stringify(pieces.map(tagFor)),
    );
  } catch (e) {
    console.warn('[snsoccer] could not save the page registry', e);
  }
}

// ── Reading pieces ──────────────────────────────────────────────────────────

interface RawGeometry {
  type?: string;
  points?: Point[];
  ellipseCenterPoint?: Point | null;
  ellipseMajorAxisRadius?: number;
}

interface RawElement {
  type?: number;
  layerNum?: number;
  numInPage?: number;
  userData?: string;
  geometry?: RawGeometry | null;
  recycle?: () => unknown;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1;

/** Whether an element draws exactly this spec, to a pixel. */
function drawsSpec(g: RawGeometry, spec: GeoSpec): boolean {
  if (g.type !== spec.type) {
    return false;
  }
  if (spec.type === 'GEO_circle') {
    const c = g.ellipseCenterPoint;
    return (
      !!c &&
      close(c.x, spec.center.x) &&
      close(c.y, spec.center.y) &&
      close(g.ellipseMajorAxisRadius ?? -99, spec.radius)
    );
  }
  const pts = g.points ?? [];
  return (
    pts.length === spec.points.length &&
    pts.every(
      (p, i) => close(p.x, spec.points[i].x) && close(p.y, spec.points[i].y),
    )
  );
}

/** The plugin's pieces on the current page, however this firmware kept them. */
export async function readPieces(ctx: PageContext): Promise<PagePiece[]> {
  check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  const elements = answer<RawElement[]>(
    await PluginFileAPI.getElements(ctx.page, ctx.notePath),
    'getElements',
  );
  const size = pieceSizeFor(ctx.pageSize.width);
  const found = new Map<string, PagePiece>();
  const untagged: RawElement[] = [];

  for (const el of elements) {
    if (el.type !== TYPE_GEO || el.numInPage == null) {
      continue;
    }
    const tag = parseTag(el.userData);
    if (tag) {
      const piece = found.get(tag.id) ?? {
        ...tag,
        layer: el.layerNum ?? 0,
        nums: [],
      };
      piece.nums.push(el.numInPage);
      found.set(tag.id, piece);
    } else if (!el.userData && el.geometry) {
      untagged.push(el);
    }
  }

  // Recorded pieces this firmware didn't tag: claim elements that draw them.
  for (const rec of await loadRegistry(ctx)) {
    if (found.has(rec.id)) {
      continue;
    }
    const specs = shapesFor(rec.kind, rec, size);
    const nums: number[] = [];
    let layer = 0;
    for (const spec of specs) {
      const hit = untagged.find(
        el =>
          el.geometry &&
          drawsSpec(el.geometry, spec) &&
          !nums.includes(el.numInPage!),
      );
      if (hit) {
        nums.push(hit.numInPage!);
        layer = hit.layerNum ?? 0;
      }
    }
    // Only a complete match counts: a partial one is someone's erasing.
    if (nums.length === specs.length) {
      found.set(rec.id, {...rec, layer, nums});
    }
  }

  for (const el of elements) {
    el.recycle?.();
  }
  return [...found.values()];
}

// ── Writing pieces ──────────────────────────────────────────────────────────

/** The Pieces layer on this page if it has one, else the main layer. */
async function piecesLayer(ctx: PageContext): Promise<number> {
  try {
    const res = await PluginFileAPI.getLayers(ctx.notePath, ctx.page);
    const layers = answer<Array<{layerId?: number; name?: string}>>(
      res,
      'getLayers',
    );
    const match = layers.find(l => l.name === PIECES_LAYER_NAME);
    return match?.layerId ?? 0;
  } catch {
    return 0;
  }
}

async function buildElements(tag: PieceTag, size: number, layer: number) {
  const elements: object[] = [];
  for (const spec of shapesFor(tag.kind, tag, size)) {
    const el = answer<Record<string, unknown>>(
      await PluginCommAPI.createElement(TYPE_GEO),
      'createElement',
    );
    el.type = TYPE_GEO;
    el.layerNum = layer;
    el.userData = tagFor(tag);
    el.geometry = {
      penColor: PIECE_PEN.color,
      penType: PIECE_PEN.type,
      penWidth: PIECE_PEN.width,
      type: spec.type,
      points: spec.type === 'GEO_circle' ? [] : spec.points,
      ellipseCenterPoint: spec.type === 'GEO_circle' ? spec.center : null,
      ellipseMajorAxisRadius: spec.type === 'GEO_circle' ? spec.radius : 0,
      ellipseMinorAxisRadius: spec.type === 'GEO_circle' ? spec.radius : 0,
      ellipseAngle: 0,
    };
    elements.push(el);
  }
  return elements;
}

/** Keep a centre far enough inside the page that the whole piece shows. */
function clampToPage(ctx: PageContext, p: Point): Point {
  const half = pieceSizeFor(ctx.pageSize.width) / 2;
  return {
    x: Math.min(ctx.pageSize.width - half, Math.max(half, Math.round(p.x))),
    y: Math.min(ctx.pageSize.height - half, Math.max(half, Math.round(p.y))),
  };
}

const descending = (nums: number[]) => [...nums].sort((a, b) => b - a);

export async function placePiece(
  ctx: PageContext,
  kind: PieceKind,
  at: Point,
): Promise<PieceTag> {
  const pieces = await readPieces(ctx);
  const tag: PieceTag = {kind, id: newPieceId(), ...clampToPage(ctx, at)};
  const layer = await piecesLayer(ctx);
  const size = pieceSizeFor(ctx.pageSize.width);
  check(
    await PluginCommAPI.insertPageElements(
      await buildElements(tag, size, layer),
      ctx.page,
      layer,
    ),
    'insertPageElements',
  );
  await saveRegistry(ctx, [...pieces, tag]);
  return tag;
}

export async function movePiece(
  ctx: PageContext,
  id: string,
  to: Point,
): Promise<PieceTag | null> {
  const pieces = await readPieces(ctx);
  const piece = pieces.find(p => p.id === id);
  if (!piece) {
    return null;
  }
  const tag: PieceTag = {kind: piece.kind, id, ...clampToPage(ctx, to)};
  const size = pieceSizeFor(ctx.pageSize.width);
  check(
    await PluginCommAPI.batchUpdatePageElements(
      descending(piece.nums),
      await buildElements(tag, size, piece.layer),
      ctx.page,
      piece.layer,
    ),
    'batchUpdatePageElements',
  );
  await saveRegistry(
    ctx,
    pieces.map(p => (p.id === id ? tag : p)),
  );
  return tag;
}

export async function removePiece(
  ctx: PageContext,
  id: string,
): Promise<boolean> {
  const pieces = await readPieces(ctx);
  const piece = pieces.find(p => p.id === id);
  if (!piece) {
    return false;
  }
  check(
    await PluginCommAPI.deletePageElements(
      descending(piece.nums),
      ctx.page,
      piece.layer,
    ),
    'deletePageElements',
  );
  await saveRegistry(
    ctx,
    pieces.filter(p => p.id !== id),
  );
  return true;
}

/**
 * Swap every piece on this page for a new set, as when loading a saved
 * layout. Only the plugin's own pieces go; the drawing stays.
 */
export async function replacePieces(
  ctx: PageContext,
  placements: Array<{kind: PieceKind; x: number; y: number}>,
): Promise<PieceTag[]> {
  const old = await readPieces(ctx);
  const byLayer = new Map<number, number[]>();
  for (const p of old) {
    byLayer.set(p.layer, [...(byLayer.get(p.layer) ?? []), ...p.nums]);
  }
  for (const [layer, nums] of byLayer) {
    check(
      await PluginCommAPI.deletePageElements(descending(nums), ctx.page, layer),
      'deletePageElements',
    );
  }

  const layer = await piecesLayer(ctx);
  const size = pieceSizeFor(ctx.pageSize.width);
  const tags: PieceTag[] = [];
  const elements: object[] = [];
  for (const p of placements) {
    const tag: PieceTag = {
      kind: p.kind,
      id: newPieceId(),
      ...clampToPage(ctx, p),
    };
    tags.push(tag);
    elements.push(...(await buildElements(tag, size, layer)));
  }
  if (elements.length > 0) {
    check(
      await PluginCommAPI.insertPageElements(elements, ctx.page, layer),
      'insertPageElements',
    );
  }
  await saveRegistry(ctx, tags);
  return tags;
}

// ── Pages ───────────────────────────────────────────────────────────────────

/** Index the new page takes: straight after the current one. */
async function nextPageIndex(ctx: PageContext): Promise<number> {
  const total = answer<number>(
    await PluginFileAPI.getNoteTotalPageNum(ctx.notePath),
    'getNoteTotalPageNum',
  );
  return Math.min(ctx.page + 1, total);
}

/**
 * Go to a page of the open note, if this firmware can. jumpToPage arrived
 * with the 2026-08-24 plugin firmware; older firmware lacks it or rejects,
 * and Modulanner found no way to ask up front. So try, and report.
 */
export async function tryJumpToPage(page: number): Promise<boolean> {
  try {
    const jump = (PluginCommAPI as any).jumpToPage;
    if (typeof jump !== 'function') {
      return false;
    }
    const res = await jump.call(PluginCommAPI, page);
    return res?.success !== false;
  } catch (e) {
    console.warn('[snsoccer] jumpToPage failed', e);
    return false;
  }
}

/** Where a new page ended up, and whether the note went to it. */
export interface NewPage {
  page: number;
  jumped: boolean;
}

/** Give a page a Pieces layer. Best effort: pieces fall back to main. */
async function addPiecesLayer(notePath: string, page: number): Promise<void> {
  try {
    check(
      await PluginFileAPI.insertLayer(notePath, page, {
        layerId: 1,
        name: PIECES_LAYER_NAME,
        isVisible: true,
        isCurrentLayer: false,
      }),
      'insertLayer',
    );
  } catch (e) {
    console.warn('[snsoccer] no Pieces layer on the new page, using main', e);
  }
}

export class NoPitchError extends Error {}

/** Add a page with the pitch as its background, after this one, and go to it. */
export async function addPitchPage(ctx: PageContext): Promise<NewPage> {
  const png = await pitchPngPath(ctx.pageSize);
  if (!(await FileUtils.exists(png))) {
    throw new NoPitchError(
      'Open Soccer Board from the toolbar once to prepare the pitch.',
    );
  }
  check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  const page = await nextPageIndex(ctx);
  check(
    await PluginFileAPI.insertNotePage({
      notePath: ctx.notePath,
      page,
      template: png,
    }),
    'insertNotePage',
  );
  await addPiecesLayer(ctx.notePath, page);
  return {page, jumped: await tryJumpToPage(page)};
}

// ── Template names ──────────────────────────────────────────────────────────
//
// Saved pages are tagged with the name of the template they're on, "Soccer
// Field" for the plugin's pitch. A copied page's template is a PNG rendered
// from its source, which says nothing about where it came from, so every PNG
// the plugin renders is recorded with its source's name, and a copy of a
// copy of a pitch page is still "Soccer Field".

const TEMPLATE_NAMES_KEY = 'snsoccer:templates:v1';
export const PITCH_TEMPLATE_NAME = 'Soccer Field';

async function templateNames(): Promise<Record<string, string>> {
  try {
    const json = await AsyncStorage.getItem(TEMPLATE_NAMES_KEY);
    return json ? (JSON.parse(json) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function nameTemplate(png: string, name: string): Promise<void> {
  const names = await templateNames();
  names[png] = name;
  await AsyncStorage.setItem(TEMPLATE_NAMES_KEY, JSON.stringify(names));
}

/** "style_dot_grid" -> "Dot Grid"; "/MyStyle/Kanban.png" -> "Kanban". */
function readableTemplate(nameOrPath: string): string {
  const base = nameOrPath
    .split('/')
    .pop()!
    .replace(/\.[a-z0-9]+$/i, '');
  const words = base
    .replace(/^style_/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? words.replace(/\b[a-z]/g, c => c.toUpperCase()) : 'Page';
}

/** What a page's template is called, for its keyword. */
export async function templateNameOf(src: PageContext): Promise<string> {
  let template: {name?: string; path?: string} | null = null;
  try {
    template = answer(
      await PluginFileAPI.getNotePageTemplate(src.notePath, src.page),
      'getNotePageTemplate',
    );
  } catch (e) {
    console.warn('[snsoccer] template name unavailable', e);
  }
  const path = template?.path ?? '';
  if (/\/pitch-\d+x\d+\.png$/.test(path)) {
    return PITCH_TEMPLATE_NAME;
  }
  const known = path ? (await templateNames())[path] : undefined;
  return known ?? readableTemplate(template?.name || path || '');
}

/** The background of a page, rendered to a PNG that a new page can use. */
async function backgroundOf(src: PageContext, name: string): Promise<string> {
  const png = `${await exportDir()}/${name}.png`;
  check(
    await PluginFileAPI.generateNoteTemplatePng(src.notePath, src.page, png),
    'generateNoteTemplatePng',
  );
  await nameTemplate(png, await templateNameOf(src));
  return png;
}

/**
 * Put a page's layers, drawing and pieces onto a page that already has its
 * background, in the same or another note. The pieces stay pieces: their
 * record goes with them, for firmware that drops userData. Resolves the
 * pieces found and how many elements were copied.
 */
async function copyContents(
  src: PageContext,
  destPath: string,
  destPage: number,
): Promise<{pieces: PagePiece[]; count: number}> {
  const pieces = await readPieces(src); // also saves the open note
  const layers = answer<Array<{layerId?: number}>>(
    await PluginFileAPI.getLayers(src.notePath, src.page),
    'getLayers',
  );
  for (const layer of layers) {
    if (layer.layerId) {
      try {
        check(
          await PluginFileAPI.insertLayer(destPath, destPage, layer),
          'insertLayer',
        );
      } catch (e) {
        console.warn('[snsoccer] copy: layer not copied', layer, e);
      }
    }
  }

  const elements = answer<RawElement[]>(
    await PluginFileAPI.getElements(src.page, src.notePath),
    'getElements',
  );
  try {
    if (elements.length > 0) {
      check(
        await PluginFileAPI.insertElements(destPath, destPage, elements),
        'insertElements',
      );
    }
  } finally {
    for (const el of elements) {
      el.recycle?.();
    }
  }
  await saveRegistry({...src, notePath: destPath, page: destPage}, pieces);
  return {pieces, count: elements.length};
}

/**
 * Copy a page, background, drawing and pieces, to a new page inserted at
 * `at` in `destPath`. Everything on the copy stays editable.
 */
async function copyPageTo(
  src: PageContext,
  destPath: string,
  at: number,
  background?: string,
): Promise<void> {
  const bg = background ?? (await backgroundOf(src, `page-${timestamp()}`));
  check(
    await PluginFileAPI.insertNotePage({
      notePath: destPath,
      page: at,
      template: bg,
    }),
    'insertNotePage',
  );
  await copyContents(src, destPath, at);
}

/** Copy this page to a new page after it, and go there. */
export async function copyPage(ctx: PageContext): Promise<NewPage> {
  check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  const page = await nextPageIndex(ctx);
  await copyPageTo(ctx, ctx.notePath, page);
  return {page, jumped: await tryJumpToPage(page)};
}

// ── The layouts note ────────────────────────────────────────────────────────
//
// A saved layout is a whole page: background, drawing and pieces. Each is a
// page of one note the plugin keeps, EXPORT/SNSoccer/Layouts.note, copied in
// and out the way Copy page copies within a note (Modulanner copies ink
// between notes the same way).
//
// Each page carries a keyword, "~BOARD:<template>:<name>", and is found by
// it, never by position, so the note can be reordered, and pages deleted or
// tagged by hand in the Note app. The "~" sorts the tags after the user's own
// keywords, as Modulanner's "~PLANNER" ones do. The keyword is the truth; the
// list in AsyncStorage (layoutStore.ts) is what the menu can read while open,
// brought back in line with the note whenever the menu closes.

export const LIBRARY_NAME = 'Layouts.note';
export const KEYWORD_PREFIX = '~BOARD:';

export async function libraryPath(): Promise<string> {
  return `${await exportDir()}/${LIBRARY_NAME}`;
}

/** Keyword fields can't hold ':' (the separator), and are kept short. */
const field = (text: string, max: number) =>
  text.replace(/:/g, '-').replace(/\s+/g, ' ').trim().slice(0, max).trim() ||
  'Untitled';

export function layoutKeyword(template: string, name: string): string {
  return `${KEYWORD_PREFIX}${field(template, 24)}:${field(name, 40)}`;
}

/** A layout keyword's parts, or null for anyone else's keyword. */
export function parseLayoutKeyword(
  keyword: string,
): {template: string; name: string} | null {
  if (!keyword.startsWith(KEYWORD_PREFIX)) {
    return null;
  }
  const rest = keyword.slice(KEYWORD_PREFIX.length);
  const at = rest.indexOf(':');
  return at > 0 && at < rest.length - 1
    ? {template: rest.slice(0, at), name: rest.slice(at + 1)}
    : null;
}

/** A layout page found in the layouts note. */
export interface LibraryEntry {
  keyword: string;
  page: number;
  /** Its position among the keywords on its page, for deleteKeyWord. */
  index: number;
  template: string;
  name: string;
}

/**
 * Every layout page in the layouts note, by keyword. Null when there is no
 * layouts note, or the note couldn't be read (not the same as "none").
 */
export async function listLibrary(): Promise<LibraryEntry[] | null> {
  const lib = await libraryPath();
  if (!(await FileUtils.exists(lib))) {
    return null;
  }
  try {
    const total = answer<number>(
      await PluginFileAPI.getNoteTotalPageNum(lib),
      'getNoteTotalPageNum',
    );
    const pages = Array.from({length: total}, (_, i) => i);
    const all =
      answer<Array<{keyword: string; page: number}> | null>(
        await PluginFileAPI.getKeyWords(lib, pages),
        'getKeyWords',
      ) ?? [];
    const perPage = new Map<number, number>();
    const found: LibraryEntry[] = [];
    for (const k of all) {
      const index = perPage.get(k.page) ?? 0;
      perPage.set(k.page, index + 1);
      const parts = parseLayoutKeyword(k.keyword ?? '');
      if (parts) {
        found.push({keyword: k.keyword, page: k.page, index, ...parts});
      }
    }
    return found;
  } catch (e) {
    console.warn('[snsoccer] could not read the layouts note', e);
    return null;
  }
}

async function libraryPage(page: number): Promise<PageContext> {
  const notePath = await libraryPath();
  const pageSize = answer<{width: number; height: number}>(
    await PluginFileAPI.getPageSize(notePath, page),
    'getPageSize',
  );
  return {notePath, page, pageSize};
}

/** The page carrying a keyword, other than `except`. */
async function findInLibrary(
  keyword: string,
  except?: number,
): Promise<LibraryEntry | null> {
  return (
    (await listLibrary())?.find(
      e => e.keyword === keyword && e.page !== except,
    ) ?? null
  );
}

export class LayoutMissingError extends Error {}

/** What saving a page to the layouts note made. */
export interface SavedPage {
  keyword: string;
  template: string;
  /** Its page in the layouts note, as it was when saved. */
  libPage: number;
  /** Its background, to give a page it's loaded onto. */
  background: string;
  pieces: PieceTag[];
  /** How many elements are drawing rather than pieces. */
  marks: number;
}

/**
 * Save this page, all of it, as a new page at the end of the layouts note,
 * tagged with its keyword.
 */
export async function saveToLibrary(
  ctx: PageContext,
  name: string,
  fileId: string,
): Promise<SavedPage> {
  check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  const template = await templateNameOf(ctx);
  const keyword = layoutKeyword(template, name);
  const background = await backgroundOf(ctx, `layout-${fileId}`);
  const lib = await libraryPath();

  let libPage: number;
  if (await FileUtils.exists(lib)) {
    libPage = answer<number>(
      await PluginFileAPI.getNoteTotalPageNum(lib),
      'getNoteTotalPageNum',
    );
    check(
      await PluginFileAPI.insertNotePage({
        notePath: lib,
        page: libPage,
        template: background,
      }),
      'insertNotePage',
    );
  } else {
    // A new note starts with one page, on this background.
    check(
      await PluginFileAPI.createNote({
        notePath: lib,
        template: background,
        mode: 0,
        isPortrait: ctx.pageSize.width <= ctx.pageSize.height,
      }),
      'createNote',
    );
    libPage = 0;
  }
  const {pieces, count} = await copyContents(ctx, lib, libPage);
  check(
    await PluginFileAPI.insertKeyWord(lib, libPage, keyword),
    'insertKeyWord',
  );
  const pieceNums = pieces.reduce((n, p) => n + p.nums.length, 0);
  return {
    keyword,
    template,
    libPage,
    background,
    pieces: pieces.map(({kind, id: pid, x, y}) => ({kind, id: pid, x, y})),
    marks: Math.max(0, count - pieceNums),
  };
}

/** A saved page's pieces and how much drawing it has, for the list. */
export async function describeLibraryPage(page: number): Promise<{
  pieces: PieceTag[];
  marks: number;
  pageSize: PageContext['pageSize'];
}> {
  const src = await libraryPage(page);
  const pieces = await readPieces(src);
  const all = answer<RawElement[]>(
    await PluginFileAPI.getElements(page, src.notePath),
    'getElements',
  );
  for (const el of all) {
    el.recycle?.();
  }
  const pieceNums = pieces.reduce((n, p) => n + p.nums.length, 0);
  return {
    pieces: pieces.map(({kind, id, x, y}) => ({kind, id, x, y})),
    marks: Math.max(0, all.length - pieceNums),
    pageSize: src.pageSize,
  };
}

/** Add the saved page with this keyword after this one, and go to it. */
export async function loadFromLibrary(
  ctx: PageContext,
  keyword: string,
  background?: string,
): Promise<NewPage> {
  const entry = await findInLibrary(keyword);
  if (!entry) {
    throw new LayoutMissingError(
      `Couldn't find its page in ${LIBRARY_NAME}. Was it deleted there?`,
    );
  }
  check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  const src = await libraryPage(entry.page);
  const page = await nextPageIndex(ctx);
  const bg =
    background && (await FileUtils.exists(background))
      ? background
      : await backgroundOf(src, `layout-${timestamp()}`);
  await copyPageTo(src, ctx.notePath, page, bg);
  return {page, jumped: await tryJumpToPage(page)};
}

/** Tag a page of the layouts note, as for a layout saved before keywords. */
export async function tagLibraryPage(
  libPage: number,
  name: string,
): Promise<string> {
  const src = await libraryPage(libPage);
  const keyword = layoutKeyword(await templateNameOf(src), name);
  check(
    await PluginFileAPI.insertKeyWord(src.notePath, libPage, keyword),
    'insertKeyWord',
  );
  return keyword;
}

/**
 * Take the page with this keyword out of the layouts note (other than
 * `except`, a page just saved under the same keyword). A note keeps at least
 * one page, so the last one stays, untagged: no longer a layout.
 */
export async function removeFromLibrary(
  keyword: string,
  except?: number,
): Promise<void> {
  const entry = await findInLibrary(keyword, except);
  if (!entry) {
    return; // already gone
  }
  const lib = await libraryPath();
  const total = answer<number>(
    await PluginFileAPI.getNoteTotalPageNum(lib),
    'getNoteTotalPageNum',
  );
  if (total > 1) {
    check(
      await PluginFileAPI.removeNotePage(lib, entry.page),
      'removeNotePage',
    );
  } else {
    check(
      await PluginFileAPI.deleteKeyWord(lib, entry.page, entry.index),
      'deleteKeyWord',
    );
  }
}
