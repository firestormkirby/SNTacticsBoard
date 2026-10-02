/**
 * Saved layouts: a page saved under a name, to use again later.
 *
 * The page itself, background, drawing and pieces, lives in the layouts note
 * (pageOps.ts), tagged with `keyword`; loading it adds a copy as a new page.
 * The list here names those pages, so the menu can show them without reading
 * the note (it can't while open), and keeps the pieces' positions as
 * fractions of the page, so "just the pieces" can go onto any page, on any
 * device. The controller brings it in line with the note's keywords each
 * time the menu closes.
 *
 * Layouts saved before whole pages were have neither: pieces only. Layouts
 * saved before keywords have a `libPage` until they're tagged.
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
  /** The keyword on its page in the layouts note, "~BOARD:<template>:<name>". */
  keyword?: string;
  /** The name of the template its page is on, e.g. "Futsal Court". */
  template?: string;
  /** Before keywords: its page's position in the layouts note. */
  libPage?: number;
  /** The PNG of its background. */
  background?: string;
  /** How many drawn elements it has besides the pieces. */
  marks?: number;
}

/** A saved page, as the layouts note has it. */
export interface LayoutPage {
  keyword: string;
  template: string;
  background?: string;
  marks: number;
}

/** Whether a layout has a whole page to add, not just pieces. */
export const hasPage = (l: SavedLayout) =>
  l.keyword !== undefined || l.libPage !== undefined;

const KEY = 'tacticsboard:layouts:v1';
/** Keywords of layouts deleted in the menu, to remove once we can. */
const REMOVALS_KEY = 'tacticsboard:layouts:removals:v2';

function valid(v: unknown): v is SavedLayout {
  const l = v as Partial<SavedLayout> | null;
  return (
    !!l &&
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.savedAt === 'number' &&
    Array.isArray(l.pieces) &&
    (l.keyword === undefined || typeof l.keyword === 'string') &&
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

/**
 * Take a layout off the list, and its previous versions with it. Their
 * pages are queued for removal from the layouts note.
 */
export async function deleteLayout(id: string): Promise<void> {
  const all = await listLayouts();
  const gone = all.find(l => l.id === id);
  await write(all.filter(l => l.id !== id));
  if (!gone) {
    return;
  }
  if (gone.keyword) {
    await queueRemoval(gone.keyword);
  }
  // Versions go by name, whatever its case, as saving matches them.
  const name = gone.name.trim().toLowerCase();
  const versions = await listVersions();
  const mine = versions.filter(v => v.name.trim().toLowerCase() === name);
  await replaceVersions(versions.filter(v => !mine.includes(v)));
  for (const v of mine) {
    await queueRemoval(v.keyword);
  }
}

async function readRemovals(): Promise<string[]> {
  try {
    const json = await AsyncStorage.getItem(REMOVALS_KEY);
    const list = json ? (JSON.parse(json) as unknown[]) : [];
    return list.filter((k): k is string => typeof k === 'string');
  } catch {
    return [];
  }
}

export async function queueRemoval(keyword: string): Promise<void> {
  const list = await readRemovals();
  if (!list.includes(keyword)) {
    await AsyncStorage.setItem(
      REMOVALS_KEY,
      JSON.stringify([...list, keyword]),
    );
  }
}

/** Keywords of layouts-note pages waiting to be removed. */
export async function pendingRemovals(): Promise<string[]> {
  return readRemovals();
}

export async function removalDone(keyword: string): Promise<void> {
  await AsyncStorage.setItem(
    REMOVALS_KEY,
    JSON.stringify((await readRemovals()).filter(k => k !== keyword)),
  );
}

/** Replace the list wholesale, as after reading the layouts note. */
export async function replaceLayouts(list: SavedLayout[]): Promise<void> {
  await write([...list].sort((a, b) => b.savedAt - a.savedAt));
}

// ── Earlier versions ────────────────────────────────────────────────────────
//
// The menu's copy of the versions in the layouts note (pageOps.ts), brought
// in line with the note, like the list above, whenever the menu closes.

export interface SavedVersion {
  /** "~BOARD-OLD:<template>:<name>:<when>" on its layouts-note page. */
  keyword: string;
  name: string;
  template: string;
  /** When this version was saved, epoch ms. */
  savedAt: number;
}

const VERSIONS_KEY = 'tacticsboard:versions:v1';

/** Earlier versions, newest first. */
export async function listVersions(): Promise<SavedVersion[]> {
  try {
    const json = await AsyncStorage.getItem(VERSIONS_KEY);
    const list = json ? (JSON.parse(json) as unknown[]) : [];
    return list
      .filter((v): v is SavedVersion => {
        const q = v as Partial<SavedVersion> | null;
        return (
          !!q &&
          typeof q.keyword === 'string' &&
          typeof q.name === 'string' &&
          typeof q.savedAt === 'number'
        );
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function replaceVersions(list: SavedVersion[]): Promise<void> {
  await AsyncStorage.setItem(
    VERSIONS_KEY,
    JSON.stringify([...list].sort((a, b) => b.savedAt - a.savedAt)),
  );
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
