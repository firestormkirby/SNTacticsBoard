/**
 * Browser stand-in for react-native-view-shot.
 *
 * On a device, captureRef() draws a native view into a PNG and hands back a
 * file path. Nothing here can write a real image to a device path, so the mock
 * does the next most useful thing: it shows you what was captured.
 *
 * The captured DOM node is cloned and handed to the device screen, which draws
 * it in a "Last capture" card over the panel (see CaptureCard in device.tsx).
 * That matters for plugins that capture a view the user never sees, such as an
 * export sheet rendered underneath the UI: without this the preview would give
 * no sight of the one thing the capture is for.
 *
 * The clone is a snapshot of the DOM, not a raster image. react-native-web
 * styles through class names in the same document, so it renders identically.
 *
 * Returns a plausible tmpfile URI in the host's cache directory, which is what
 * device code usually strips and copies elsewhere.
 */
import { createElement, forwardRef, useImperativeHandle, useRef } from 'react';
import type { ReactNode } from 'react';
import { registerImage } from './note';

export interface CaptureOptions {
  width?: number;
  height?: number;
  format?: 'png' | 'jpg' | 'webm' | 'raw';
  quality?: number;
  result?: 'tmpfile' | 'base64' | 'data-uri' | 'zip-base64';
  fileName?: string;
}

/** What device.tsx receives, as the detail of a 'preview-capture' event. */
export interface CaptureEventDetail {
  node: HTMLElement;
  /** Size of the view on screen, CSS pixels. */
  width: number;
  height: number;
  /** Size of the image the plugin asked for. */
  outWidth: number;
  outHeight: number;
  uri: string;
}

let count = 0;

function elementOf(target: unknown): HTMLElement {
  const t = target as { current?: unknown } | null;
  const el = t && 'current' in t ? t.current : target;
  if (!(el instanceof HTMLElement)) {
    throw new Error('captureRef: the ref is not attached to a mounted view');
  }
  return el;
}

export async function captureRef(target: unknown, options: CaptureOptions = {}): Promise<string> {
  const el = elementOf(target);
  const rect = el.getBoundingClientRect();
  const width = el.offsetWidth || rect.width;
  const height = el.offsetHeight || rect.height;
  const format = options.format === 'jpg' ? 'jpg' : 'png';
  const name = options.fileName ?? `ReactNative-snapshot-image${++count}`;
  const path = `/data/user/0/com.ratta.supernote.pluginhost/cache/${name}.${format}`;

  const result = options.result ?? 'tmpfile';
  const uri =
    result === 'tmpfile' ? `file://${path}`
    : result === 'data-uri' ? `data:image/${format};base64,`
    : '';

  const detail: CaptureEventDetail = {
    node: el.cloneNode(true) as HTMLElement,
    width,
    height,
    outWidth: Math.round(options.width ?? width),
    outHeight: Math.round(options.height ?? height),
    uri: result === 'tmpfile' ? path : `(${result})`,
  };
  // Keep the snapshot under its path, so copying the file and using it as a
  // page template shows the captured view (mocks/note.ts).
  registerImage(path, { node: el.cloneNode(true) as HTMLElement, width, height });
  console.log('[preview] captureRef', { ...options, result, returned: uri });
  window.dispatchEvent(new CustomEvent('preview-capture', { detail }));
  return uri;
}

export function captureScreen(options: CaptureOptions = {}): Promise<string> {
  return captureRef(document.getElementById('root'), options);
}

export function releaseCapture(_uri: string): void {}

/** The <ViewShot> wrapper component, with its imperative capture(). */
const ViewShot = forwardRef<{ capture: () => Promise<string> }, {
  options?: CaptureOptions;
  children?: ReactNode;
}>(function ViewShot({ options, children }, ref) {
  const inner = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ capture: () => captureRef(inner, options) }));
  return createElement('div', { ref: inner }, children);
});

export default ViewShot;
