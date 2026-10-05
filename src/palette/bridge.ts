/**
 * The JS side of the native floating button (android/.../palette).
 *
 * Every function is safe to call when the native module is missing, as in
 * Jest or a build without app.npk: they do nothing and report "unavailable",
 * so the panel can explain what is wrong instead of crashing.
 */
import {DeviceEventEmitter, NativeModules} from 'react-native';

import type {PieceKind} from '../page/pieceShapes';

export interface ScreenInfo {
  width: number;
  height: number;
  density: number;
  /** Android Surface rotation: 0, 1 (90°), 2 (180°) or 3 (270°). */
  rotation: number;
}

/** A piece's centre on screen, in pixels. */
export interface HandleSpec {
  id: string;
  kind: PieceKind;
  x: number;
  y: number;
}

export interface ShowOptions {
  /** Button position, top-left, in screen pixels. */
  x?: number;
  y?: number;
  /** Whether the palette starts open. */
  open?: boolean;
  /** Piece size on screen, in pixels. */
  pieceSize?: number;
  /** Whether a pen drag on the windows locks the pen (default on). */
  penLock?: boolean;
}

interface NativePalette {
  canDrawOverlays(): Promise<boolean>;
  requestOverlayPermission(): void;
  getScreenInfo(): Promise<ScreenInfo>;
  show(options: ShowOptions): Promise<boolean>;
  hide(): void;
  isShowing(): Promise<boolean>;
  setPieces(pieces: HandleSpec[], size: number): void;
  startTicking(intervalMs: number): void;
  stopTicking(): void;
  notify(message: string): void;
  setBusy?(busy: boolean): void;
  setPageName?(name: string): void;
  wait?(ms: number): Promise<null>;
  setBoards?(boards: BoardSpec[]): void;
  folderSize?(path: string): Promise<number>;
  whenQuiet?(): Promise<null>;
  setWorking?(on: boolean): void;
}

/** A saved board, for the palette's Load list. */
export interface BoardSpec {
  keyword: string;
  name: string;
}

/** Where a touch landed, in screen pixels, with what's needed to map it. */
export interface ScreenPoint {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
  rotation: number;
  /** Android MotionEvent tool type: 1 finger, 2 pen. */
  toolType: number;
}

export type PaletteEvent =
  | ({type: 'drop'; kind: PieceKind} & ScreenPoint)
  | ({type: 'move'; id: string} & ScreenPoint)
  | {type: 'remove'; id: string}
  | {type: 'tapPiece'; kind: PieceKind}
  | {type: 'longPress'}
  | {type: 'position'; x: number; y: number}
  | {type: 'open'; open: boolean}
  | {type: 'tick'}
  /** The palette's Save, Load (a board picked from its list), Copy, Reset. */
  | {type: 'save'}
  | {type: 'load'; keyword: string}
  | {type: 'copy'}
  /** The palette's Trash, tapped twice: clear the page. */
  | {type: 'clear'}
  | {type: 'reset'}
  /** The pen is locked (on) or unlocked (off): for a pen drag, or a hover. */
  | {type: 'penLock'; on: boolean}
  /**
   * A pen drag on one of the windows began (active) or ended. As it begins:
   * where from, and whether pen locking is on.
   */
  | {
      type: 'penDrag';
      active: boolean;
      from?: 'button' | 'palette' | 'piece';
      locks?: boolean;
    };

export const PALETTE_EVENT = 'TacticsPalette';

/** Looked up per call, so a module registered late is still found. */
const mod = () => NativeModules.TacticsPalette as NativePalette | undefined;

export const palette = {
  get available(): boolean {
    return !!mod();
  },
  canDrawOverlays: async (): Promise<boolean> =>
    mod()?.canDrawOverlays() ?? false,
  requestOverlayPermission: (): void => mod()?.requestOverlayPermission(),
  getScreenInfo: async (): Promise<ScreenInfo | null> =>
    mod()?.getScreenInfo() ?? null,
  /** Resolves false without the overlay permission or the native module. */
  show: async (options: ShowOptions): Promise<boolean> =>
    mod()?.show(options) ?? false,
  hide: (): void => mod()?.hide(),
  isShowing: async (): Promise<boolean> => mod()?.isShowing() ?? false,
  setPieces: (pieces: HandleSpec[], size: number): void =>
    mod()?.setPieces(pieces, size),
  startTicking: (intervalMs: number): void => mod()?.startTicking(intervalMs),
  stopTicking: (): void => mod()?.stopTicking(),
  /**
   * Work the user is waiting on is going on (true) or done (false): the
   * button, palette and handles show it, and pieces can't be grabbed.
   */
  setWorking: (on: boolean): void => mod()?.setWorking?.(on),
  /** Note work is running: the pen isn't locked by a hover meanwhile. */
  setBusy: (busy: boolean): void => mod()?.setBusy?.(busy),
  /** The name tag on the palette: the page's board, or "Scratchpad". */
  setPageName: (name: string): void => mod()?.setPageName?.(name),
  /**
   * Resolve after `ms`, timed natively: JS timers stop while the panel is
   * closed. Without the native module, at once.
   */
  wait: (ms: number): Promise<unknown> =>
    mod()?.wait?.(ms) ?? Promise.resolve(),
  /**
   * Resolve once the Note app isn't reloading for a pen lock change, which
   * only the native side times exactly. Without the native module, at once.
   */
  whenQuiet: (): Promise<unknown> => mod()?.whenQuiet?.() ?? Promise.resolve(),
  /** A folder's size in bytes, or null when it can't be told. */
  folderSize: async (path: string): Promise<number | null> => {
    const bytes = await mod()?.folderSize?.(path);
    return typeof bytes === 'number' && bytes >= 0 ? bytes : null;
  },
  /** The boards the palette's Load list offers. */
  setBoards: (boards: BoardSpec[]): void => mod()?.setBoards?.(boards),
  /** A message the user sees even with the panel closed. */
  notify: (message: string): boolean => {
    const m = mod();
    if (!m?.notify) {
      return false;
    }
    m.notify(message);
    return true;
  },
};

export function onPaletteEvent(fn: (e: PaletteEvent) => void): () => void {
  const sub = DeviceEventEmitter.addListener(PALETTE_EVENT, fn);
  return () => sub.remove();
}
