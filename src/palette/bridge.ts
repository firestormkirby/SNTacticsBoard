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
  | {type: 'tick'};

export const PALETTE_EVENT = 'SoccerPalette';

/** Looked up per call, so a module registered late is still found. */
const mod = () => NativeModules.SoccerPalette as NativePalette | undefined;

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
};

export function onPaletteEvent(fn: (e: PaletteEvent) => void): () => void {
  const sub = DeviceEventEmitter.addListener(PALETTE_EVENT, fn);
  return () => sub.remove();
}
