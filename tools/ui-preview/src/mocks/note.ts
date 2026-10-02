/**
 * An in-memory note: pages, layers and elements, for plugins that edit the
 * page rather than just reading from it.
 *
 * The SDK mock answers page and element calls from here (insertPageElements,
 * getElements, insertNotePage, jumpToPage, ...), and NotePage.tsx draws the
 * current page, so what a plugin writes shows up in the preview the way it
 * would in the note.
 *
 * Other notes: a plugin may write to note files other than the open one (a
 * library of saved pages, say). Those are kept here too, by path, and every
 * page call takes an optional path; without one it means the open note.
 *
 * Images: a view captured with react-native-view-shot, or a page rendered by
 * generateNoteTemplatePng, is kept here as a DOM snapshot under its file path.
 * Copying the file copies the entry, and a page whose template is that path
 * draws it as its background. Nothing is ever written to disk.
 */

export interface MockPoint {
  x: number;
  y: number;
}

export interface MockElement {
  type: number;
  layerNum: number;
  numInPage: number;
  userData?: string;
  geometry?: {
    type?: string;
    points?: MockPoint[];
    ellipseCenterPoint?: MockPoint | null;
    ellipseMajorAxisRadius?: number;
    ellipseMinorAxisRadius?: number;
  } | null;
  /** A pen stroke drawn in the preview, in page pixels. Preview-only. */
  previewStroke?: MockPoint[];
  [key: string]: unknown;
}

export interface MockLayer {
  layerId: number;
  name: string;
  isVisible: boolean;
  isCurrentLayer: boolean;
}

export interface MockPage {
  template: string;
  layers: MockLayer[];
  elements: MockElement[];
  nextNum: number;
  /** Page keywords; they belong to the page, so they move with it. */
  keywords: string[];
}

export interface MockImage {
  node: HTMLElement;
  width: number;
  height: number;
}

export const NOTE = {
  pages: [] as MockPage[],
  current: 0,
  /** The open note's path; other paths are other notes. */
  path: '',
};

/** Note files other than the open one, by path. */
const otherNotes = new Map<string, MockPage[]>();

const images = new Map<string, MockImage>();
const listeners = new Set<() => void>();

const normalise = (path: string) => path.replace(/^file:\/\//, '');

export function onNoteChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(): void {
  for (const fn of listeners) fn();
}

function blankPage(template: string): MockPage {
  return {
    template,
    layers: [{ layerId: 0, name: 'Main Layer', isVisible: true, isCurrentLayer: true }],
    elements: [],
    nextNum: 1,
    keywords: [],
  };
}

/** Start a fresh note. Called by the harness before your plugin boots. */
export function resetNote(
  totalPages: number, current: number, template = 'style_white', path = '',
): void {
  NOTE.path = path;
  otherNotes.clear();
  NOTE.pages = Array.from({ length: Math.max(1, totalPages) }, () => blankPage(template));
  NOTE.current = Math.min(Math.max(0, current), NOTE.pages.length - 1);
  changed();
}

// ── Images ────────────────────────────────────────────────────────────────

export function registerImage(path: string, image: MockImage): void {
  images.set(normalise(path), image);
  changed();
}

export function imageFor(path: string): MockImage | undefined {
  return images.get(normalise(path));
}

export function hasImage(path: string): boolean {
  return images.has(normalise(path));
}

export function copyImage(from: string, to: string): void {
  const img = images.get(normalise(from));
  if (img) images.set(normalise(to), img);
}

// ── Pages and elements ───────────────────────────────────────────────────

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A note's pages: the open note's without a path, else that file's. */
function pagesOf(path?: string): MockPage[] {
  if (!path || path === NOTE.path) return NOTE.pages;
  const pages = otherNotes.get(path);
  if (!pages) throw new Error(`no note at ${path}`);
  return pages;
}

function pageAt(page: number, path?: string): MockPage {
  const p = pagesOf(path)[page];
  if (!p) throw new Error(`no page ${page}${path ? ` in ${path}` : ''}`);
  return p;
}

export function noteExists(path: string): boolean {
  return path === NOTE.path || otherNotes.has(path);
}

export function pageCount(path?: string): number {
  return pagesOf(path).length;
}

/** A new note file with one page. */
export function createNoteFile(path: string, template: string): void {
  otherNotes.set(path, [blankPage(template)]);
}

export function removePage(page: number, path?: string): boolean {
  const pages = pagesOf(path);
  if (pages.length <= 1 || !pages[page]) return false;
  pages.splice(page, 1);
  if (pages === NOTE.pages && NOTE.current >= pages.length) NOTE.current = pages.length - 1;
  changed();
  return true;
}

/** Store elements on a page, giving each a fresh numInPage. */
export function addElements(
  page: number, elements: unknown[], layer?: number | null, path?: string,
): void {
  const p = pageAt(page, path);
  for (const raw of elements) {
    const el = clone(raw as MockElement);
    delete (el as Record<string, unknown>).recycle;
    el.numInPage = p.nextNum++;
    if (layer != null) el.layerNum = layer;
    el.layerNum ??= 0;
    p.elements.push(el);
  }
  changed();
}

export function removeElements(page: number, nums: number[], path?: string): void {
  const p = pageAt(page, path);
  p.elements = p.elements.filter(e => !nums.includes(e.numInPage));
  changed();
}

export function elementsOn(page: number, path?: string): MockElement[] {
  return pageAt(page, path).elements.map(e => ({ ...clone(e), recycle: () => {} }));
}

export function insertPage(page: number, template: string, path?: string): void {
  const pages = pagesOf(path);
  const at = Math.min(Math.max(0, page), pages.length);
  pages.splice(at, 0, blankPage(template));
  if (pages === NOTE.pages && at <= NOTE.current) NOTE.current++;
  changed();
}

export function templateOf(page: number, path?: string): string {
  return pageAt(page, path).template;
}

/** Every keyword on the listed pages, as getKeyWords reports them. */
/** Indexed from 1, as on a Manta: deleteKeyWord takes that, not the place. */
export function keywordsOn(
  pages: number[],
  path?: string,
): Array<{ keyword: string; page: number; index: number }> {
  const all = pagesOf(path);
  return pages.flatMap(page =>
    (all[page]?.keywords ?? []).map((keyword, i) => ({ keyword, page, index: i + 1 })),
  );
}

export function addKeyword(page: number, keyword: string, path?: string): void {
  pageAt(page, path).keywords.push(keyword);
}

export function removeKeyword(page: number, index: number, path?: string): boolean {
  const p = pageAt(page, path);
  if (!p.keywords[index - 1]) return false;
  p.keywords.splice(index - 1, 1);
  return true;
}

export function layersOn(page: number, path?: string): MockLayer[] {
  return clone(pageAt(page, path).layers);
}

export function addLayer(page: number, layer: Partial<MockLayer>, path?: string): boolean {
  const p = pageAt(page, path);
  const id = layer.layerId ?? p.layers.length;
  if (p.layers.some(l => l.layerId === id)) return false;
  p.layers.push({
    layerId: id,
    name: layer.name ?? `Layer ${id}`,
    isVisible: layer.isVisible ?? true,
    isCurrentLayer: false,
  });
  changed();
  return true;
}

export function goToPage(page: number): boolean {
  if (page < 0 || page >= NOTE.pages.length) return false;
  NOTE.current = page;
  changed();
  return true;
}

/**
 * Render a page's template to "a PNG": the snapshot is the template's own
 * image, or an empty white sheet for a built-in template.
 */
export function snapshotTemplate(
  page: number, path: string, size: { width: number; height: number }, notePath?: string,
): void {
  const existing = imageFor(pageAt(page, notePath).template);
  if (existing) {
    images.set(normalise(path), existing);
  } else {
    const blank = document.createElement('div');
    blank.style.cssText = `width:${size.width}px;height:${size.height}px;background:#fff`;
    images.set(normalise(path), { node: blank, width: size.width, height: size.height });
  }
}
