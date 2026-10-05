/**
 * Keeps the plugin's page edits from overlapping the Note app's redraws.
 *
 * Every edit of a page (insert, delete, update elements) makes the Note app
 * reload the page's layers, and so does the pen lock lifting after a stroke
 * it cut short. The Note app crashes when two of those reloads run at once
 * (IndexOutOfBoundsException in TransferModeView.compositeLayerBitmap /
 * compositeBgLayer, from NotePresenter.forcedToLoadLayer): seen on a Manta
 * when a pen drag's stray stroke was deleted ~130 ms after the lock lifted.
 *
 * So each edit waits for the note to have been quiet: until a moment after
 * the last edit, or after the pen lock last lifted. The wait runs on the
 * native side's clock (palette.wait), since JS timers stop while the plugin's
 * panel is closed.
 */

/**
 * The Note app's reload after an edit: it starts ~20-60 ms after the edit
 * and takes 200-700 ms on a Manta (longer on a busier page). An edit 500 ms
 * after the last one crashed it; 1.3 s apart never has.
 */
export const AFTER_EDIT_MS = 1000;
/** After the pen lock lifts: the reload it may start, and then some. */
export const AFTER_UNLOCK_MS = 1000;

let quietAt = 0;
let sleep: (ms: number) => Promise<unknown> = () => Promise.resolve();
let lockQuiet: () => Promise<unknown> = () => Promise.resolve();

/** How to wait. Set by the controller; without it nothing waits (tests). */
export function setSleeper(fn: (ms: number) => Promise<unknown>): void {
  sleep = fn;
}

/**
 * How to wait out the pen lock's own reloads: the native palette knows
 * exactly when the lock last turned on or off, where JS hears of it late.
 * Set by the controller; without it nothing waits (tests).
 */
export function setLockQuiet(fn: () => Promise<unknown>): void {
  lockQuiet = fn;
}

/** The note will be busy for `ms` from now: edits wait until after. */
export function noteBusyFor(ms: number): void {
  quietAt = Math.max(quietAt, Date.now() + ms);
}

/** Wait until the note is quiet, before an edit. */
export async function whenNoteQuiet(): Promise<void> {
  const wait = quietAt - Date.now();
  if (wait > 0) {
    await sleep(wait);
  }
}

/**
 * Make one page edit: wait for quiet, make it, and give the note time to
 * redraw before the next.
 */
export async function pageEdit<T>(edit: () => Promise<T>): Promise<T> {
  await whenNoteQuiet();
  // Then the lock's reloads, timed natively: a lock or unlock JS hasn't
  // heard of yet still has the Note app reloading.
  await lockQuiet();
  try {
    return await edit();
  } finally {
    noteBusyFor(AFTER_EDIT_MS);
  }
}

/** For tests. */
export function resetNoteGate(): void {
  quietAt = 0;
  sleep = () => Promise.resolve();
  lockQuiet = () => Promise.resolve();
}
