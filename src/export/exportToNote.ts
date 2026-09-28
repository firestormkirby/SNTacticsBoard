/**
 * "Export to Note": capture the drill and add it to the open .note file as a
 * new page whose background is the diagram, then take the user to that page so
 * they can draw runs and passes over it with the pen.
 *
 * Two constraints shape the order of work:
 *
 * 1. The capture needs the plugin view on screen, so it happens first.
 * 2. PluginComm/PluginFile calls can deadlock while the plugin view is open,
 *    so every note operation runs after closePluginView(). The JS runtime keeps
 *    going once the view is closed; ToastAndroid reports the outcome, since
 *    there is no plugin UI left to show it in.
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
/** Built-in blank background, used only by the fallback path. */
const BLANK_TEMPLATE = 'style_white';

interface Response<T> {
  success?: boolean;
  result?: T;
  error?: {message?: string};
}

/** The SDK resolves `{success, result, error}`; turn a failure into a throw. */
function unwrap<T>(res: unknown, what: string): T {
  const r = res as Response<T> | null | undefined;
  if (!r || r.success === false) {
    throw new Error(`${what}: ${r?.error?.message ?? 'no response'}`);
  }
  return r.result as T;
}

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

/**
 * Some host calls (reloadFile in particular) can hang when the note app is busy.
 * Nothing after them depends on their result, so give up waiting after a while.
 */
async function settle(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(done => {
    timer = setTimeout(done, ms);
  });
  await Promise.race([p.catch(() => undefined), timeout]);
  clearTimeout(timer);
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

export type ExportOutcome =
  | {kind: 'background'; page: number; png: string}
  | {kind: 'picture'; page: number; png: string};

/**
 * Close the plugin and add the captured PNG to the open note as a new page
 * straight after the one being viewed. Reports the result with a toast.
 */
export async function exportPngToNote(
  tmpPath: string,
): Promise<ExportOutcome | null> {
  await PluginManager.closePluginView();
  // Give the host a moment to finish tearing the view down.
  await sleep(400);

  try {
    const notePath = unwrap<string>(
      await PluginCommAPI.getCurrentFilePath(),
      'getCurrentFilePath',
    );
    if (!notePath || !/\.note$/i.test(notePath)) {
      toast('Soccer Board: open a note first, then export.');
      return null;
    }
    const page = unwrap<number>(
      await PluginCommAPI.getCurrentPageNum(),
      'getCurrentPageNum',
    );
    const png = await publishPng(tmpPath);
    const newPage = page + 1;

    // Flush the note app's in-memory edits before changing the file under it.
    unwrap(await PluginNoteAPI.saveCurrentNote(), 'saveCurrentNote');

    // Preferred: a page whose background (template) is the diagram. Pen
    // strokes then sit on top of it and it can't be moved by accident.
    const asBackground = (await PluginFileAPI.insertNotePage({
      notePath,
      page,
      template: png,
    })) as Response<boolean> | null;

    let outcome: ExportOutcome;
    if (asBackground?.success && asBackground.result !== false) {
      await settle(PluginCommAPI.reloadFile(), 4000);
      await PluginCommAPI.jumpToPage(newPage);
      outcome = {kind: 'background', page: newPage, png};
    } else {
      // Fallback, if this firmware only takes built-in template names: a blank
      // page with the diagram inserted as a picture.
      console.warn(
        '[snsoccer] template insert refused, inserting picture instead',
        asBackground?.error?.message,
      );
      unwrap(
        await PluginFileAPI.insertNotePage({
          notePath,
          page,
          template: BLANK_TEMPLATE,
        }),
        'insertNotePage',
      );
      await settle(PluginCommAPI.reloadFile(), 4000);
      unwrap(await PluginCommAPI.jumpToPage(newPage), 'jumpToPage');
      await sleep(300);
      unwrap(await PluginNoteAPI.insertImage(png), 'insertImage');
      outcome = {kind: 'picture', page: newPage, png};
    }

    toast(
      `Drill added as page ${newPage + 1}. Draw your runs and passes on it.`,
    );
    return outcome;
  } catch (e) {
    console.error('[snsoccer] export failed', e);
    toast(`Soccer Board: export failed. ${(e as Error).message}`);
    return null;
  }
}
