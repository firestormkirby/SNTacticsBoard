/**
 * Everything the plugin does to a note page: place, move and remove pieces,
 * copy a page, and add a pitch page.
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

// ── Pages ───────────────────────────────────────────────────────────────────

/** Index the new page takes: straight after the current one. */
async function nextPageIndex(ctx: PageContext): Promise<number> {
  const total = answer<number>(
    await PluginFileAPI.getNoteTotalPageNum(ctx.notePath),
    'getNoteTotalPageNum',
  );
  return Math.min(ctx.page + 1, total);
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
export async function addPitchPage(ctx: PageContext): Promise<number> {
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
  check(await PluginCommAPI.jumpToPage(page), 'jumpToPage');
  return page;
}

/**
 * Copy this page, background, drawings and pieces, to a new page after it,
 * and go there. Everything on the copy stays editable.
 */
export async function copyPage(ctx: PageContext): Promise<number> {
  const pieces = await readPieces(ctx); // also saves the note
  const bg = `${await exportDir()}/page-${timestamp()}.png`;
  check(
    await PluginFileAPI.generateNoteTemplatePng(ctx.notePath, ctx.page, bg),
    'generateNoteTemplatePng',
  );
  const page = await nextPageIndex(ctx);
  check(
    await PluginFileAPI.insertNotePage({
      notePath: ctx.notePath,
      page,
      template: bg,
    }),
    'insertNotePage',
  );

  const layers = answer<Array<{layerId?: number}>>(
    await PluginFileAPI.getLayers(ctx.notePath, ctx.page),
    'getLayers',
  );
  for (const layer of layers) {
    if (layer.layerId) {
      try {
        check(
          await PluginFileAPI.insertLayer(ctx.notePath, page, layer),
          'insertLayer',
        );
      } catch (e) {
        console.warn('[snsoccer] copy: layer not copied', layer, e);
      }
    }
  }

  const elements = answer<RawElement[]>(
    await PluginFileAPI.getElements(ctx.page, ctx.notePath),
    'getElements',
  );
  if (elements.length > 0) {
    check(
      await PluginFileAPI.insertElements(ctx.notePath, page, elements),
      'insertElements',
    );
  }
  for (const el of elements) {
    el.recycle?.();
  }
  await saveRegistry({...ctx, page}, pieces);
  check(await PluginCommAPI.jumpToPage(page), 'jumpToPage');
  return page;
}
