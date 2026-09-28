/**
 * The movable objects on the board.
 *
 * Teams are told apart by shape, never by colour: the Supernote screen is
 * greyscale, so an X team and an O team read at a glance where a red team and
 * a blue team would both come out mid-grey.
 */

export type PieceKind = 'attacker' | 'defender' | 'cone' | 'ball';

export interface PieceDef {
  /** Stable across releases: saved boards refer to pieces by this id. */
  id: string;
  kind: PieceKind;
  /** 0-based position within its kind, used for the tray slot. */
  index: number;
}

export interface TraySection {
  kind: PieceKind;
  label: string;
  count: number;
}

/** Tray order, top to bottom, and how many of each piece the board has. */
export const TRAY_SECTIONS: readonly TraySection[] = [
  {kind: 'attacker', label: 'Team X', count: 11},
  {kind: 'defender', label: 'Team O', count: 11},
  {kind: 'cone', label: 'Cones', count: 6},
  {kind: 'ball', label: 'Balls', count: 3},
];

const ID_PREFIX: Record<PieceKind, string> = {
  attacker: 'x',
  defender: 'o',
  cone: 'cone',
  ball: 'ball',
};

export const PIECES: readonly PieceDef[] = TRAY_SECTIONS.flatMap(section =>
  Array.from({length: section.count}, (_, index) => ({
    id: `${ID_PREFIX[section.kind]}${index + 1}`,
    kind: section.kind,
    index,
  })),
);

export const PIECES_BY_ID: ReadonlyMap<string, PieceDef> = new Map(
  PIECES.map(p => [p.id, p]),
);
