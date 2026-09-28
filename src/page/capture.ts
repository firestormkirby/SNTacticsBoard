/**
 * Making the pitch background image.
 *
 * The pitch is drawn by React (PitchSheet) and photographed with
 * react-native-view-shot, which needs the view on screen, so this runs while
 * the plugin panel is open. The PNG goes to EXPORT/SNSoccer, where the Note
 * app can read it as a page template; view-shot's own file sits in the plugin
 * host's private cache, which the Note app cannot open.
 *
 * FileUtils is a plain file module, not a note operation, so it is safe to
 * call with the panel open.
 */
import {PixelRatio} from 'react-native';
import type {View} from 'react-native';
import {captureRef} from 'react-native-view-shot';
import {FileUtils} from 'sn-plugin-lib';

import {pitchPngPath} from './pageOps';

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

/** The note page size for a screen of this many dp. */
export function pageSizeForScreen(widthDp: number, heightDp: number) {
  const ratio = PixelRatio.get();
  return pageSizeFor(widthDp * ratio, heightDp * ratio);
}

/** Whether the pitch background for this page size already exists. */
export async function hasPitch(size: {
  width: number;
  height: number;
}): Promise<boolean> {
  return !!(await FileUtils.exists(await pitchPngPath(size)));
}

/**
 * Photograph a mounted, page-shaped view at the page's full resolution and
 * save it as the pitch background for that page size.
 */
export async function savePitch(
  view: View,
  size: {width: number; height: number},
): Promise<string> {
  const uri = await captureRef(view, {
    format: 'png',
    result: 'tmpfile',
    width: size.width,
    height: size.height,
  });
  const dest = await pitchPngPath(size);
  await FileUtils.copyFile(uri.replace(/^file:\/\//, ''), dest);
  return dest;
}
