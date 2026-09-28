/**
 * Saved layouts: a page saved under a name, to use again later.
 *
 * The page itself, background, drawing and pieces, lives in the layouts note
 * (pageOps.ts), at `libPage`; loading it adds a copy as a new page. The list
 * here names those pages, and also keeps the pieces' positions as fractions
 * of the page, so "just the pieces" can go onto any page, on any device.
 *
 * Layouts saved before whole pages were have no `libPage`: pieces only.
 * Kept in AsyncStorage, so the list survives closing the plugin and
 * rebooting, but not uninstalling it (the layouts note does).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {PIECE_KINDS, PieceKind} from '../page/pieceShapes';

export interface LayoutPiece {
  kind: PieceKind;
  /** Centre as a fraction of the page, 0..1. */
  x: number;
  y: number;
}

export interface SavedLayout {
  id: string;
  name: string;
  /** Epoch ms. */
  savedAt: number;
  pieces: LayoutPiece[];
  /** Its page in the layouts note; absent for pieces-only layouts. */
  libPage?: number;
  /** The PNG of its background. */
  background?: string;
  /** How many drawn elements it has besides the pieces. */
  marks?: number;
}

/** Where a saved page is. */
export interface LayoutPage {
  libPage: number;
  background: string;
  marks: number;
}

const KEY = 'snsoccer:layouts:v1';
/** Layouts-note pages whose layout was deleted, to remove once we can. */
const REMOVALS_KEY = 'snsoccer:layouts:removals:v1';

function valid(v: unknown): v is SavedLayout {
  const l = v as Partial<SavedLayout> | null;
  return (
    !!l &&
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.savedAt === 'number' &&
    Array.isArray(l.pieces) &&
    (l.libPage === undefined || (Number.isInteger(l.libPage) && l.libPage >= 0))
  );
}

function cleanPieces(list: unknown[]): LayoutPiece[] {
  return list.filter((p): p is LayoutPiece => {
    const q = p as Partial<LayoutPiece> | null;
    return (
      !!q &&
      PIECE_KINDS.includes(q.kind as PieceKind) &&
      typeof q.x === 'number' &&
      typeof q.y === 'number' &&
      q.x >= 0 &&
      q.x <= 1 &&
      q.y >= 0 &&
      q.y <= 1
    );
  });
}

/** Saved layouts, newest first. */
export async function listLayouts(): Promise<SavedLayout[]> {
  try {
    const json = await AsyncStorage.getItem(KEY);
    const list = json ? (JSON.parse(json) as unknown[]) : [];
    return list
      .filter(valid)
      .map(l => ({...l, pieces: cleanPieces(l.pieces)}))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

async function write(list: SavedLayout[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

/**
 * Save a layout under a name. Saving under a name that already exists
 * replaces that layout, so "Rondo" can be updated rather than piling up
 * copies; the one replaced is returned, so its page can be removed.
 */
export async function saveLayout(
  name: string,
  pieces: Array<{kind: PieceKind; x: number; y: number}>,
  pageSize: {width: number; height: number},
  now = Date.now(),
  page?: LayoutPage,
): Promise<{layout: SavedLayout; replaced: SavedLayout | null}> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Give the layout a name.');
  }
  const layout: SavedLayout = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    name: trimmed,
    savedAt: now,
    pieces: pieces.map(p => ({
      kind: p.kind,
      x: Math.min(1, Math.max(0, p.x / pageSize.width)),
      y: Math.min(1, Math.max(0, p.y / pageSize.height)),
    })),
    ...(page ?? {}),
  };
  const all = await listLayouts();
  const same = (l: SavedLayout) =>
    l.name.toLowerCase() === trimmed.toLowerCase();
  await write([layout, ...all.filter(l => !same(l))]);
  return {layout, replaced: all.find(same) ?? null};
}

/** Take a layout off the list. Its page is queued for removal. */
export async function deleteLayout(id: string): Promise<void> {
  const all = await listLayouts();
  const gone = all.find(l => l.id === id);
  await write(all.filter(l => l.id !== id));
  if (gone?.libPage !== undefined) {
    await queueRemoval(gone.libPage);
  }
}

async function readRemovals(): Promise<number[]> {
  try {
    const json = await AsyncStorage.getItem(REMOVALS_KEY);
    const list = json ? (JSON.parse(json) as unknown[]) : [];
    return list.filter(
      (n): n is number => Number.isInteger(n) && (n as number) >= 0,
    );
  } catch {
    return [];
  }
}

export async function queueRemoval(libPage: number): Promise<void> {
  const list = await readRemovals();
  if (!list.includes(libPage)) {
    await AsyncStorage.setItem(
      REMOVALS_KEY,
      JSON.stringify([...list, libPage]),
    );
  }
}

/** Layouts-note pages waiting to be removed, highest first. */
export async function pendingRemovals(): Promise<number[]> {
  return (await readRemovals()).sort((a, b) => b - a);
}

/**
 * A page of the layouts note is gone (or was never going to be): stop
 * waiting to remove it, and if it went, move every later page up one.
 */
export async function libraryPageGone(
  libPage: number,
  removed: boolean,
): Promise<void> {
  const shift = (n: number) => (removed && n > libPage ? n - 1 : n);
  await AsyncStorage.setItem(
    REMOVALS_KEY,
    JSON.stringify(
      (await readRemovals()).filter(n => n !== libPage).map(shift),
    ),
  );
  if (removed) {
    await write(
      (
        await listLayouts()
      ).map(l =>
        l.libPage === undefined ? l : {...l, libPage: shift(l.libPage)},
      ),
    );
  }
}

/** A layout's pieces in page pixels, for a page of this size. */
export function layoutOnPage(
  layout: SavedLayout,
  pageSize: {width: number; height: number},
): Array<{kind: PieceKind; x: number; y: number}> {
  return layout.pieces.map(p => ({
    kind: p.kind,
    x: p.x * pageSize.width,
    y: p.y * pageSize.height,
  }));
}
