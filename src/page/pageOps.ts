/**
 * Everything the plugin does to a note page: place, move and remove pieces,
 * copy a page, and save pages to and load them from the layouts note.
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

import {pageEdit} from '../sdk/noteGate';
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
/** Where the plugin keeps its files in EXPORT: layouts note and PNGs. */
export const EXPORT_SUBDIR = 'SNTacticsBoard';

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
    throw new NotANoteError('Open a note to use Tactics Board.');
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

export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// ── Registry: the fallback for firmware that drops userData ─────────────────

const registryKey = (ctx: PageContext) =>
  `tacticsboard:page:v1:${ctx.notePath}#${ctx.page}`;

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
    console.warn('[tactics] could not save the page registry', e);
  }
}

/** Record a page's pieces, as when its contents were copied in. */
export const recordPieces = saveRegistry;

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

/** The box a geometry element draws in, or null if it draws nothing. */
function boundsOf(
  g: RawGeometry,
): {left: number; top: number; right: number; bottom: number} | null {
  if (g.type === 'GEO_circle' && g.ellipseCenterPoint) {
    const {x, y} = g.ellipseCenterPoint;
    const r = g.ellipseMajorAxisRadius ?? 0;
    return {left: x - r, top: y - r, right: x + r, bottom: y + r};
  }
  const pts = g.points ?? [];
  if (pts.length === 0) {
    return null;
  }
  return {
    left: Math.min(...pts.map(p => p.x)),
    top: Math.min(...pts.map(p => p.y)),
    right: Math.max(...pts.map(p => p.x)),
    bottom: Math.max(...pts.map(p => p.y)),
  };
}

/**
 * The plugin's pieces on the current page, however this firmware kept them.
 * Each piece is where its shapes are now, not where its tag says it was
 * put: the Note app's lasso can move them. `save: false` skips saving the
 * note first, for the frequent check that the page hasn't changed.
 */
export async function readPieces(
  ctx: PageContext,
  {save = true}: {save?: boolean} = {},
): Promise<PagePiece[]> {
  if (save) {
    check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  }
  const elements = answer<RawElement[]>(
    await PluginFileAPI.getElements(ctx.page, ctx.notePath),
    'getElements',
  );
  const size = pieceSizeFor(ctx.pageSize.width);
  const found = new Map<string, PagePiece>();
  const box = new Map<
    string,
    {left: number; top: number; right: number; bottom: number}
  >();
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
      const b = el.geometry ? boundsOf(el.geometry) : null;
      if (b) {
        const had = box.get(tag.id);
        box.set(
          tag.id,
          had
            ? {
                left: Math.min(had.left, b.left),
                top: Math.min(had.top, b.top),
                right: Math.max(had.right, b.right),
                bottom: Math.max(had.bottom, b.bottom),
              }
            : b,
        );
      }
    } else if (!el.userData && el.geometry) {
      untagged.push(el);
    }
  }
  for (const [id, b] of box) {
    const piece = found.get(id)!;
    piece.x = Math.round((b.left + b.right) / 2);
    piece.y = Math.round((b.top + b.bottom) / 2);
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

/** A note page has the main layer (0) and up to three of its own (1-3). */
const CUSTOM_LAYERS = [1, 2, 3];

/**
 * The Pieces layer on this page if it has one, else the main layer. With
 * `create`, a page without one gets one while it has a layer to spare, so
 * the pieces and the drawing can be erased apart. It's added visible and not
 * made current: the pen keeps writing on the layer it was writing on.
 */
export async function piecesLayer(
  ctx: PageContext,
  create = false,
): Promise<number> {
  let layers: Array<{layerId?: number; name?: string}>;
  try {
    layers = answer(
      await PluginFileAPI.getLayers(ctx.notePath, ctx.page),
      'getLayers',
    );
  } catch {
    return 0;
  }
  const match = layers.find(l => l.name === PIECES_LAYER_NAME);
  if (match?.layerId != null) {
    return match.layerId;
  }
  const used = new Set(layers.map(l => l.layerId));
  const free = CUSTOM_LAYERS.find(id => !used.has(id));
  if (!create || free === undefined) {
    return 0;
  }
  try {
    check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
    check(
      await PluginFileAPI.insertLayer(ctx.notePath, ctx.page, {
        layerId: free,
        name: PIECES_LAYER_NAME,
        isCurrentLayer: false,
        isVisible: true,
      }),
      'insertLayer',
    );
    console.log('[tactics] layers: added', PIECES_LAYER_NAME, 'as', free);
    return free;
  } catch (e) {
    console.warn('[tactics] layers: could not add', PIECES_LAYER_NAME, e);
    return 0;
  }
}

async function buildElements(tag: PieceTag, size: number, layer: number) {
  const specs = shapesFor(tag.kind, tag, size);
  const created = await Promise.all(
    specs.map(() => PluginCommAPI.createElement(TYPE_GEO)),
  );
  const elements: object[] = [];
  for (const [i, spec] of specs.entries()) {
    const el = answer<Record<string, unknown>>(created[i], 'createElement');
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

/**
 * Add a piece. A drop only adds, so the page isn't read first: the registry
 * gets the new piece on top of what it had. `alsoDelete` (elements on the
 * pieces layer, such as strokes a pen drag left) goes in the same edit, so
 * the note redraws once. Pass `layer` if it's known: piecesLayer(ctx).
 */
export async function placePiece(
  ctx: PageContext,
  kind: PieceKind,
  at: Point,
  alsoDelete: number[] = [],
  layer?: number,
): Promise<PagePiece> {
  const tag: PieceTag = {kind, id: newPieceId(), ...clampToPage(ctx, at)};
  layer ??= await piecesLayer(ctx, true);
  const size = pieceSizeFor(ctx.pageSize.width);
  const elements = await buildElements(tag, size, layer);
  if (alsoDelete.length > 0) {
    check(
      await pageEdit(() =>
        PluginCommAPI.batchUpdatePageElements(
          descending(alsoDelete),
          elements,
          ctx.page,
          layer,
        ),
      ),
      'batchUpdatePageElements',
    );
  } else {
    check(
      await pageEdit(() =>
        PluginCommAPI.insertPageElements(elements, ctx.page, layer),
      ),
      'insertPageElements',
    );
  }
  await saveRegistry(ctx, [...(await loadRegistry(ctx)), tag]);
  return {...tag, layer, nums: []};
}

export async function movePiece(
  ctx: PageContext,
  id: string,
  to: Point,
): Promise<PieceTag | null> {
  const pieces = await readPieces(ctx, {save: false});
  const piece = pieces.find(p => p.id === id);
  if (!piece) {
    return null;
  }
  const tag: PieceTag = {kind: piece.kind, id, ...clampToPage(ctx, to)};
  const size = pieceSizeFor(ctx.pageSize.width);
  const layer = await piecesLayer(ctx, true);
  const elements = await buildElements(tag, size, layer);
  if (layer === piece.layer) {
    check(
      await pageEdit(() =>
        PluginCommAPI.batchUpdatePageElements(
          descending(piece.nums),
          elements,
          ctx.page,
          layer,
        ),
      ),
      'batchUpdatePageElements',
    );
  } else {
    // A piece placed before the page had a Pieces layer moves onto it.
    check(
      await pageEdit(() =>
        PluginCommAPI.deletePageElements(
          descending(piece.nums),
          ctx.page,
          piece.layer,
        ),
      ),
      'deletePageElements',
    );
    check(
      await pageEdit(() =>
        PluginCommAPI.insertPageElements(elements, ctx.page, layer),
      ),
      'insertPageElements',
    );
  }
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
  const pieces = await readPieces(ctx, {save: false});
  const piece = pieces.find(p => p.id === id);
  if (!piece) {
    return false;
  }
  check(
    await pageEdit(() =>
      PluginCommAPI.deletePageElements(
        descending(piece.nums),
        ctx.page,
        piece.layer,
      ),
    ),
    'deletePageElements',
  );
  await saveRegistry(
    ctx,
    pieces.filter(p => p.id !== id),
  );
  return true;
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
    console.warn('[tactics] jumpToPage failed', e);
    return false;
  }
}

/** Where a new page ended up, and whether the note went to it. */
export interface NewPage {
  page: number;
  jumped: boolean;
}

// ── Templates ───────────────────────────────────────────────────────────────
//
// Saved pages are tagged with the name of the template they're on. The
// firmware tells a page's template by name and md5 only, no path: a page on
// a PNG is on "user_<its file name>". So a background the plugin renders is
// named after its template ("Futsal Court.png"), and a page on it is on
// "user_Futsal Court", which says what it is. Renders are kept by their
// source's md5 and used again.

const TEMPLATE_NAMES_KEY = 'tacticsboard:templates:v1';
const RENDERS_KEY = 'tacticsboard:renders:v1';

/** Renders from before they were named after their template. */
const OLD_RENDER_FILE = /^(layout|page)-[0-9a-z]+$/i;

async function stored(key: string): Promise<Record<string, string>> {
  try {
    const json = await AsyncStorage.getItem(key);
    return json ? (JSON.parse(json) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function store(key: string, k: string, v: string): Promise<void> {
  const all = await stored(key);
  all[k] = v;
  await AsyncStorage.setItem(key, JSON.stringify(all));
}

export interface PageTemplate {
  /** "style_dot_grid", or "user_<file name>" for a PNG. */
  name: string;
  /** Not given by the firmware; the preview gives it. */
  path: string;
  md5: string;
}

export async function pageTemplate(src: PageContext): Promise<PageTemplate> {
  try {
    const t = answer<{name?: string; path?: string; md5?: string} | null>(
      await PluginFileAPI.getNotePageTemplate(src.notePath, src.page),
      'getNotePageTemplate',
    );
    // The firmware's md5 is the file's, then "_<a number of its own>".
    const md5 = (t?.md5 ?? '').toLowerCase();
    return {
      name: t?.name ?? '',
      path: t?.path ?? '',
      md5: /^[0-9a-f]{32}/.exec(md5)?.[0] ?? md5,
    };
  } catch (e) {
    console.warn('[tactics] template unavailable', e);
    return {name: '', path: '', md5: ''};
  }
}

/** The file name, less ".png", of a template that's a PNG file. */
function templateFile(t: PageTemplate): string | null {
  if (t.path) {
    return t.path
      .split('/')
      .pop()!
      .replace(/\.[a-z0-9]+$/i, '');
  }
  return /^user_(.+)$/.exec(t.name)?.[1] ?? null;
}

/** "style_dot_grid" -> "Dot Grid"; "user_Kanban" -> "Kanban". */
function readableTemplate(name: string): string {
  // "style_" on built-in templates, "user_" on the user's own.
  const words = name
    .replace(/^(style|user)_/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? words.replace(/\b[a-z]/g, c => c.toUpperCase()) : 'Page';
}

/**
 * A template name worth showing, or '' for one that says nothing: the
 * "Layout Mun5n7t1" that saves tagged pages on the old renders with.
 */
export function shownTemplate(template: string): string {
  return /^(layout|page) (?=[0-9a-z]*\d)[0-9a-z]{6,}$/i.test(template)
    ? ''
    : template;
}

/** What a page's template is called, for its keyword. */
export async function templateNameOf(src: PageContext): Promise<string> {
  return nameOfTemplate(await pageTemplate(src));
}

async function nameOfTemplate(t: PageTemplate): Promise<string> {
  const file = templateFile(t);
  const names = await stored(TEMPLATE_NAMES_KEY);
  // By file name; by path, as renders were kept before.
  const known =
    (file && names[file]) ||
    (file && names[`${await exportDir()}/${file}.png`]);
  if (known) {
    return known;
  }
  return file && OLD_RENDER_FILE.test(file)
    ? 'Page'
    : readableTemplate(t.name || file || '');
}

/** Where the user's own templates are: MyStyle, beside EXPORT. */
async function styleDir(): Promise<string> {
  const root: string = await FileUtils.getExportPath();
  return root.replace(/\/[^/]+\/?$/, '/MyStyle');
}

function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|~]+/g, ' ').trim() || 'Page';
}

/** The background of a page, as a PNG a new page can use. */
export async function backgroundOf(src: PageContext): Promise<string> {
  // Rendering a background is the slowest part of saving a page, ~1 s and
  // 3 MB a time. A template that's a PNG already (the user's own, a render)
  // is used as it is, found by its file name; then a render of the
  // same template, by its md5.
  const t = await pageTemplate(src);
  const dir = await exportDir();
  const file = templateFile(t);
  const candidates = [
    t.path,
    file && `${dir}/${file}.png`,
    file && `${await styleDir()}/${file}.png`,
  ];
  for (const c of candidates) {
    if (c && /\.png$/i.test(c) && (await FileUtils.exists(c))) {
      return c;
    }
  }
  const renders = await stored(RENDERS_KEY);
  const before = t.md5 ? renders[t.md5] : undefined;
  if (before && (await FileUtils.exists(before))) {
    return before;
  }

  const name = await nameOfTemplate(t);
  let base = fileSafe(name);
  for (let n = 2; await FileUtils.exists(`${dir}/${base}.png`); n++) {
    base = `${fileSafe(name)} ${n}`;
  }
  const png = `${dir}/${base}.png`;
  check(
    await PluginFileAPI.generateNoteTemplatePng(src.notePath, src.page, png),
    'generateNoteTemplatePng',
  );
  console.log('[tactics] rendered the background', t.name, t.md5, png);
  await store(TEMPLATE_NAMES_KEY, base, name);
  if (t.md5) {
    await store(RENDERS_KEY, t.md5, png);
  }
  return png;
}

/** The renders kept, by the md5 of the template each was made from. */
export async function keptRenders(): Promise<Record<string, string>> {
  return stored(RENDERS_KEY);
}

export async function setKeptRenders(
  renders: Record<string, string>,
): Promise<void> {
  await AsyncStorage.setItem(RENDERS_KEY, JSON.stringify(renders));
}

/** Renders from before they were named after their template. */
export const isOldRender = (fileBase: string) => OLD_RENDER_FILE.test(fileBase);

/** Whether two pages are on the same background: same image, or template. */
export function sameBackground(a: PageTemplate, b: PageTemplate): boolean {
  if (a.md5 && b.md5) {
    return a.md5 === b.md5;
  }
  const key = (t: PageTemplate) => t.path || t.name;
  return !!key(a) && key(a) === key(b);
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
        console.warn('[tactics] copy: layer not copied', layer, e);
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
export async function copyPageTo(
  src: PageContext,
  destPath: string,
  at: number,
  background?: string,
): Promise<void> {
  const bg = background ?? (await backgroundOf(src));
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
// page of one note the plugin keeps, EXPORT/SNTacticsBoard/Layouts.note, copied in
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

/**
 * The Note app refuses a keyword longer than 52 characters (PluginHost's
 * KEYWORD_TOO_LONG). A board's is "~BOARD:" + template + ":" + name, so the
 * template is cut to fit beside the longest name the menu takes.
 */
export const KEYWORD_MAX = 52;
export const NAME_MAX = 24;
const TEMPLATE_MAX = KEYWORD_MAX - KEYWORD_PREFIX.length - 1 - NAME_MAX;

/** Keyword fields can't hold ':' (the separator), and are kept short. */
const field = (text: string, max: number) =>
  text.replace(/:/g, '-').replace(/\s+/g, ' ').trim().slice(0, max).trim() ||
  'Untitled';

/** A board name as keywords keep it: no ':', at most NAME_MAX characters. */
export const boardName = (name: string) => field(name, NAME_MAX);

export function layoutKeyword(template: string, name: string): string {
  return `${KEYWORD_PREFIX}${field(template, TEMPLATE_MAX)}:${boardName(name)}`;
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

// Earlier versions of a board are pages of the layouts note too, tagged
// "~OLD:<name>:<when>", <when> being when that version was saved: seconds
// since 2020 in base 36, six characters. Short, for the 52-character limit;
// the template isn't in it, since the page itself says what it's on. A board
// keeps its last VERSIONS_KEPT. Versions from the first build of this,
// "~BOARD-OLD:<template>:<name>:<yyyymmdd-hhmmss>", are still read.

export const VERSION_PREFIX = '~OLD:';
const OLD_VERSION_PREFIX = '~BOARD-OLD:';
export const VERSIONS_KEPT = 5;
const STAMP_EPOCH = Date.UTC(2020, 0, 1);

/** "n4gzbm" for a time: the form a version keyword carries. */
export function stampOf(ms: number): string {
  return Math.max(0, Math.floor((ms - STAMP_EPOCH) / 1000))
    .toString(36)
    .padStart(6, '0');
}

function msOfStamp(stamp: string): number | null {
  if (/^[0-9a-z]{6}$/.test(stamp)) {
    return STAMP_EPOCH + parseInt(stamp, 36) * 1000;
  }
  const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)$/.exec(stamp);
  return m
    ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
    : null;
}

export function versionKeyword(name: string, savedAt: number): string {
  return `${VERSION_PREFIX}${boardName(name)}:${stampOf(savedAt)}`;
}

/**
 * A version keyword's parts, or null for any other keyword. `template` is
 * only in the first build's keywords; otherwise it's read from the page.
 */
export function parseVersionKeyword(
  keyword: string,
): {template?: string; name: string; savedAt: number} | null {
  if (keyword.startsWith(VERSION_PREFIX)) {
    const parts = keyword.slice(VERSION_PREFIX.length).split(':');
    const savedAt = parts.length === 2 ? msOfStamp(parts[1]) : null;
    return parts[0] && savedAt !== null ? {name: parts[0], savedAt} : null;
  }
  if (keyword.startsWith(OLD_VERSION_PREFIX)) {
    const parts = keyword.slice(OLD_VERSION_PREFIX.length).split(':');
    const savedAt = parts.length === 3 ? msOfStamp(parts[2]) : null;
    return parts[0] && parts[1] && savedAt !== null
      ? {template: parts[0], name: parts[1], savedAt}
      : null;
  }
  return null;
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

/** An earlier version of a board, found in the layouts note. */
export interface VersionEntry extends LibraryEntry {
  savedAt: number;
}

/**
 * Every board and version page in the layouts note, by keyword. Null when
 * there is no layouts note, or it couldn't be read (not the same as "none").
 */
export async function scanLibrary(): Promise<{
  boards: LibraryEntry[];
  versions: VersionEntry[];
} | null> {
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
      answer<Array<{keyword: string; page: number; index?: number}> | null>(
        await PluginFileAPI.getKeyWords(lib, pages),
        'getKeyWords',
      ) ?? [];
    const perPage = new Map<number, number>();
    const boards: LibraryEntry[] = [];
    const versions: VersionEntry[] = [];
    for (const k of all) {
      // The firmware's index for it (deleteKeyWord's), or its place.
      const place = perPage.get(k.page) ?? 0;
      perPage.set(k.page, place + 1);
      const index = k.index ?? place;
      const board = parseLayoutKeyword(k.keyword ?? '');
      if (board) {
        boards.push({keyword: k.keyword, page: k.page, index, ...board});
      }
      const version = parseVersionKeyword(k.keyword ?? '');
      if (version) {
        versions.push({
          keyword: k.keyword,
          page: k.page,
          index,
          name: version.name,
          savedAt: version.savedAt,
          template: version.template ?? '', // read from the page when needed
        });
      }
    }
    return {boards, versions};
  } catch (e) {
    console.warn('[tactics] could not read the layouts note', e);
    return null;
  }
}

/** Every board page in the layouts note; see scanLibrary. */
export async function listLibrary(): Promise<LibraryEntry[] | null> {
  return (await scanLibrary())?.boards ?? null;
}

export async function libraryPage(page: number): Promise<PageContext> {
  const notePath = await libraryPath();
  const pageSize = answer<{width: number; height: number}>(
    await PluginFileAPI.getPageSize(notePath, page),
    'getPageSize',
  );
  return {notePath, page, pageSize};
}

/** The page carrying a keyword, other than `except`. */
/** The layouts-note page with this keyword: a board's, or a version's. */
async function findInLibrary(
  keyword: string,
  except?: number,
): Promise<LibraryEntry | null> {
  const lib = await scanLibrary();
  return (
    [...(lib?.boards ?? []), ...(lib?.versions ?? [])].find(
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
 * tagged with its keyword: a board's, or `tagAs` it (a version's).
 */
export async function saveToLibrary(
  ctx: PageContext,
  name: string,
  tagAs?: (template: string) => string,
): Promise<SavedPage> {
  check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
  const template = await templateNameOf(ctx);
  const keyword = tagAs ? tagAs(template) : layoutKeyword(template, name);
  const background = await backgroundOf(ctx);
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
      : await backgroundOf(src);
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
