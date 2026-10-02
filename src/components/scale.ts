/**
 * The size of the menu's contents, as one factor: every length in it goes
 * through z(), except the card's own size. Only the menu: the floating
 * palette keeps its own sizes.
 */
export const UI_SCALE = 0.75;

/** A length, scaled. */
export const z = (n: number): number => Math.round(n * UI_SCALE);

/**
 * A border, scaled but never under 2: a 1px line all but disappears on
 * e-ink.
 */
export const zb = (n: number): number => Math.max(2, z(n));
