/**
 * Saved layouts: the positions of the pieces on a page, under a name, to put
 * back on any page later.
 *
 * Positions are stored as fractions of the page, so a layout saved on a Manta
 * comes out in the same places on a Nomad. Only the pieces are saved, never
 * the drawing. Kept in AsyncStorage, so they survive closing the plugin and
 * rebooting, but not uninstalling it.
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
}

const KEY = 'snsoccer:layouts:v1';

function valid(v: unknown): v is SavedLayout {
  const l = v as Partial<SavedLayout> | null;
  return (
    !!l &&
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.savedAt === 'number' &&
    Array.isArray(l.pieces)
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
 * Save pieces under a name. Saving under a name that already exists replaces
 * that layout, so "Rondo" can be updated rather than piling up copies.
 */
export async function saveLayout(
  name: string,
  pieces: Array<{kind: PieceKind; x: number; y: number}>,
  pageSize: {width: number; height: number},
  now = Date.now(),
): Promise<SavedLayout> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Give the layout a name.');
  }
  const layout: SavedLayout = {
    id: now.toString(36),
    name: trimmed,
    savedAt: now,
    pieces: pieces.map(p => ({
      kind: p.kind,
      x: Math.min(1, Math.max(0, p.x / pageSize.width)),
      y: Math.min(1, Math.max(0, p.y / pageSize.height)),
    })),
  };
  const others = (await listLayouts()).filter(
    l => l.name.toLowerCase() !== trimmed.toLowerCase(),
  );
  await write([layout, ...others]);
  return layout;
}

export async function deleteLayout(id: string): Promise<void> {
  await write((await listLayouts()).filter(l => l.id !== id));
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
