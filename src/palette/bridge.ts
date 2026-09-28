/**
 * The JS side of the native floating palette (android/.../palette).
 *
 * Every function is safe to call when the native module is missing, as in
 * Jest or a build without app.npk: they do nothing and report "unavailable",
 * so the panel can explain what is wrong instead of crashing.
 */
import {DeviceEventEmitter, NativeModules} from 'react-native';

import type {PieceKind} from '../page/pieceShapes';

interface NativePalette {
  canDrawOverlays(): Promise<boolean>;
  requestOverlayPermission(): void;
  getScreenInfo(): Promise<ScreenInfo>;
  show(options: {
    side?: Side;
    y?: number;
    pieceSize?: number;
  }): Promise<boolean>;
  hide(): void;
  isShowing(): Promise<boolean>;
  setMoveMode(
    enabled: boolean,
    pieces: Array<{id: string; kind: PieceKind; x: number; y: number}>,
    pieceSize: number,
  ): void;
}

export type Side = 'left' | 'right';

export interface ScreenInfo {
  width: number;
  height: number;
  density: number;
  /** Android Surface rotation: 0, 1 (90°), 2 (180°) or 3 (270°). */
  rotation: number;
}

/** Where a touch landed, in screen pixels, with what's needed to map it. */
export interface ScreenPoint {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
  rotation: number;
}

/** Android MotionEvent tool types. */
export const TOOL_FINGER = 1;
export const TOOL_STYLUS = 2;

export type PaletteEvent =
  | ({type: 'drop'; kind: PieceKind; toolType: number} & ScreenPoint)
  | ({type: 'move'; id: string; toolType: number} & ScreenPoint)
  | {type: 'remove'; id: string}
  | {type: 'tapPiece'; kind: PieceKind}
  | {type: 'action'; action: 'move' | 'moveDone' | 'copy' | 'pitch' | 'hide'}
  | {type: 'position'; side: Side; y: number};

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
  show: async (options: {side?: Side; y?: number; pieceSize?: number}) =>
    mod()?.show(options) ?? false,

  hide: (): void => mod()?.hide(),

  isShowing: async (): Promise<boolean> => mod()?.isShowing() ?? false,

  setMoveMode: (
    enabled: boolean,
    pieces: Array<{id: string; kind: PieceKind; x: number; y: number}> = [],
    pieceSize = 0,
  ): void => mod()?.setMoveMode(enabled, pieces, pieceSize),
};

export function onPaletteEvent(fn: (e: PaletteEvent) => void): () => void {
  const sub = DeviceEventEmitter.addListener(PALETTE_EVENT, fn);
  return () => sub.remove();
}
