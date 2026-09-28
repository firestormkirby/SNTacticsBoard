/**
 * "Export to Note": capture the drill and add it to the open .note file as a
 * new page whose background is the diagram, then take the user to that page so
 * they can draw runs and passes over it with the pen.
 *
 * The order of work follows what Modulanner established on devices:
 *
 * 1. The capture needs the plugin view on screen, so it happens first.
 * 2. PluginComm/PluginFile calls can deadlock while the plugin view is open,
 *    so every note operation runs after closePluginView(). That call is
 *    fire-and-forget; the SDK calls that follow take long enough that the
 *    host has finished closing by the time they land.
 * 3. Once the view is closed the host suspends the JS timer queue, so nothing
 *    after closing may wait on setTimeout: it would not fire until the panel
 *    reopened. Only awaited SDK calls move the flow on.
 * 4. saveCurrentNote() comes first, or strokes still in the display buffer
 *    are lost when insertNotePage saves the file.
 * 5. insertNotePage's `page` is the index the new page takes, so the page
 *    after the current one is `current + 1`. A PNG path is accepted as the
 *    template. Older firmware answers null on success, so only an explicit
 *    `success: false` counts as failure.
 *
 * ToastAndroid reports the outcome, since there is no plugin UI left to show
 * it in.
 */
import {PixelRatio, ToastAndroid} from 'react-native';
import type {View} from 'react-native';
import {captureRef} from 'react-native-view-shot';
import {
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
} from 'sn-plugin-lib';

/** Where exported diagrams are kept: EXPORT/SNSoccer on the device. */
const EXPORT_SUBDIR = 'SNSoccer';

interface Response<T> {
  success?: boolean;
  result?: T;
  error?: {message?: string};
}

/**
 * Throw on an explicit SDK failure. A null or wrapper-less answer is success:
 * older firmware returns nothing at all from calls that worked.
 */
function check(res: unknown, what: string): void {
  const r = res as Response<unknown> | null | undefined;
  if (r && r.success === false) {
    throw new Error(`${what}: ${r.error?.message ?? 'failed'}`);
  }
}

/** A query whose answer is needed: failure or a missing result throws. */
function answer<T>(res: unknown, what: string): T {
  check(res, what);
  const result = (res as Response<T> | null | undefined)?.result;
  if (result === undefined || result === null) {
    throw new Error(`${what}: no answer`);
  }
  return result;
}

/** Note page sizes, in pixels, for the devices that run plugins. */
const PAGE_SIZES = [
  {width: 1404, height: 1872}, // A5X, A6X, Nomad
  {width: 1920, height: 2560}, // Manta
  {width: 1872, height: 1404}, // the same, in landscape
  {width: 2560, height: 1920},
];

/**
 * dp x pixel ratio lands within a pixel or two of the page size, not always on
 * it (1365.33 dp can be reported as 1365). Snap to a known page size when the
 * result is that close, so the template is exactly page-sized.
 */
export function pageSizeFor(widthPx: number, heightPx: number) {
  const known = PAGE_SIZES.find(
    s => Math.abs(s.width - widthPx) <= 4 && Math.abs(s.height - heightPx) <= 4,
  );
  return known ?? {width: Math.round(widthPx), height: Math.round(heightPx)};
}

/**
 * Capture a mounted view as a PNG at the device's full page resolution.
 * Returns a filesystem path (no file:// prefix).
 *
 * `widthDp`/`heightDp` are the view's size. The view is drawn at exactly the
 * screen's size, so dp times the pixel ratio is the note page in pixels.
 */
export async function capturePage(
  view: View,
  widthDp: number,
  heightDp: number,
): Promise<string> {
  const ratio = PixelRatio.get();
  const page = pageSizeFor(widthDp * ratio, heightDp * ratio);
  const uri = await captureRef(view, {
    format: 'png',
    result: 'tmpfile',
    width: page.width,
    height: page.height,
  });
  return uri.replace(/^file:\/\//, '');
}

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Move the capture somewhere the note app can read. view-shot writes into the
 * plugin host's private cache, which another app cannot open.
 */
async function publishPng(tmpPath: string): Promise<string> {
  const root: string = await FileUtils.getExportPath();
  const dir = `${root}/${EXPORT_SUBDIR}`;
  await FileUtils.makeDir(dir);
  const dest = `${dir}/drill-${timestamp()}.png`;
  await FileUtils.copyFile(tmpPath, dest);
  return dest;
}

function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.LONG);
}

export interface ExportOutcome {
  /** 0-based index of the new page. */
  page: number;
  png: string;
}

/**
 * Close the plugin and add the captured PNG to the open note as a new page
 * straight after the one being viewed. Reports the result with a toast.
 */
export async function exportPngToNote(
  tmpPath: string,
): Promise<ExportOutcome | null> {
  PluginManager.closePluginView();

  try {
    const notePath = answer<string>(
      await PluginCommAPI.getCurrentFilePath(),
      'getCurrentFilePath',
    );
    if (!/\.note$/i.test(notePath)) {
      toast('Soccer Board: open a note first, then export.');
      return null;
    }
    const current = answer<number>(
      await PluginCommAPI.getCurrentPageNum(),
      'getCurrentPageNum',
    );
    const total = answer<number>(
      await PluginFileAPI.getNoteTotalPageNum(notePath),
      'getNoteTotalPageNum',
    );
    const png = await publishPng(tmpPath);
    const page = Math.min(current + 1, total);

    check(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');
    check(
      await PluginFileAPI.insertNotePage({notePath, page, template: png}),
      'insertNotePage',
    );
    check(await PluginCommAPI.jumpToPage(page), 'jumpToPage');

    toast(`Drill added as page ${page + 1}. Draw your runs and passes on it.`);
    return {page, png};
  } catch (e) {
    console.error('[snsoccer] export failed', e);
    toast(`Soccer Board: export failed. ${(e as Error).message}`);
    return null;
  }
}
