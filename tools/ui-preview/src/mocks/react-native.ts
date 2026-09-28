/**
 * 'react-native' for the browser: react-native-web, plus the handful of APIs
 * the plugin uses that react-native-web does not implement.
 *
 * Aliasing straight to react-native-web very nearly works. View, Text,
 * Pressable, ScrollView, TextInput, Switch, StyleSheet, Dimensions and
 * PixelRatio all come through unchanged. What it lacks is the Android-only
 * surface, because the web has no equivalent. Rather than fork the source to
 * avoid those imports, they are filled in here.
 */
import { Dimensions as WebDimensions } from 'react-native-web';

export * from 'react-native-web';

/**
 * `Dimensions.get('screen')` and `PixelRatio.get()`, corrected for the fact
 * that the "device screen" here is an iframe.
 *
 * react-native-web maps 'screen' to `window.screen`, the physical MONITOR,
 * and PixelRatio to `devicePixelRatio`. On a device those two multiply out to
 * the note page's pixel size, which is exactly what `contextStore.derivePageSize()`
 * relies on. In a browser they describe the desktop the harness happens to be
 * running on, so the page size came out as some fraction of a monitor.
 *
 * That is not a cosmetic error. `screenToPagePoint` fits the page inside the
 * tap container with `containedBounds`, preserving aspect ratio, so a page
 * whose shape does not match the screen gets letterboxed, and every tap in
 * the resulting bars clamps to the page edge. It reads as an invisible margin
 * down the left and right that nothing can be placed past.
 *
 * The iframe IS the device screen, so 'screen' is the viewport and the ratio
 * is 1: one CSS pixel is one page pixel, which also makes the whole preview
 * 1:1 with the coordinates the UI stores.
 */
export const Dimensions = {
  get(dim: 'window' | 'screen') {
    void dim; // window and screen are the same thing inside the iframe
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      fontScale: 1,
    };
  },
  addEventListener: WebDimensions.addEventListener.bind(WebDimensions),
  removeEventListener: (WebDimensions as any).removeEventListener?.bind(WebDimensions),
  set: (WebDimensions as any).set?.bind(WebDimensions),
};

export const PixelRatio = {
  get: () => 1,
  getFontScale: () => 1,
  getPixelSizeForLayoutSize: (size: number) => Math.round(size),
  roundToNearestPixel: (size: number) => Math.round(size),
};

/**
 * Android's native toast. The plugin uses it for the one piece of feedback it
 * can show without opening the panel, notably after placing something, where
 * opening the panel would clear the selection it just made.
 *
 * Forwarded to the harness, which draws a toast-shaped thing at the bottom of
 * the device screen, so those moments can still be photographed.
 */
export const ToastAndroid = {
  SHORT: 0,
  LONG: 1,
  show(message: string, _duration?: number): void {
    window.dispatchEvent(new CustomEvent('preview-toast', { detail: message }));
  },
  showWithGravity(message: string, _d?: number, _g?: number): void {
    ToastAndroid.show(message);
  },
};
