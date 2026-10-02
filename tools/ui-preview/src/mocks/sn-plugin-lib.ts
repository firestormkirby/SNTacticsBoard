/**
 * Browser stand-in for sn-plugin-lib, the Supernote plugin SDK.
 *
 * The SDK is a native TurboModule, so none of it can run here. Every call
 * resolves to the SDK's own success shape, `{ success: true, result: undefined }`
 * which is also what a real device returns for a surprising number of calls,
 * so your "did it work" branches behave the way they do on hardware.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 * It does not emulate the SDK. Nothing is written, nothing is read, and no call
 * has side effects. Most importantly it does not reproduce the SDK's THREADING
 * behaviour: a PluginComm/PluginFile call made while the panel is open
 * deadlocks on a device and resolves instantly here. See the README.
 *
 * ── Adding real answers ───────────────────────────────────────────────────
 * Anything not given an explicit answer is handled by a Proxy: it returns a
 * function for any property, so a call this file has never heard of resolves
 * instead of throwing on undefined, and logs itself with its arguments, which
 * doubles as a trace of what a screen actually asks the SDK for.
 *
 * When a real return value drives what renders (a page count, a lasso rect, a
 * keyword list), add it through `sdk.overrides` in your preview config rather
 * than editing this file.
 */
import type { SdkConfig } from '../config';
import {
  NOTE, addElements, addLayer, copyImage, createNoteFile, elementsOn, goToPage, hasImage,
  insertPage, layersOn, noteExists, pageCount, removeElements, removePage, snapshotTemplate,
  addKeyword, keywordsOn, removeKeyword, templateOf,
} from './note';

const ok = <T,>(result?: T) => Promise.resolve({ success: true, result });

/** Answers to the common "where am I" questions. Set from the preview config. */
export const CURRENT_PAGE = {
  filePath: '/storage/emulated/0/Note/Example.note',
  pageNum: 0,
  totalPages: 1,
  template: '',
  pageSize: { width: 1404, height: 1872 },
};

/** Fired when the plugin asks to open or close its own view. */
export type ViewStateListener = (open: boolean) => void;
const viewListeners = new Set<ViewStateListener>();
export function onViewStateChange(fn: ViewStateListener): () => void {
  viewListeners.add(fn);
  return () => viewListeners.delete(fn);
}
function setView(open: boolean) {
  for (const fn of viewListeners) fn(open);
}

/**
 * plugin_life, as registerPluginLifeListener reports it: 2 when the panel
 * opens (from the toolbar, or showPluginView), 3 when the HOST closes it.
 * The plugin's own closePluginView sends nothing, as on a device.
 */
const lifeListeners = new Set<{ onMsg: (d: { state: number }) => void }>();
export function notifyPluginLife(state: number): void {
  for (const l of lifeListeners) l.onMsg({ state });
}

/** A plain-valued answer that still leaves a line in the call trace. */
function logged<T>(name: string, value: T) {
  return (...args: unknown[]) => {
    console.log(`[preview-sdk] ${name}`, ...args);
    return Promise.resolve(value);
  };
}

function toast(message: string) {
  window.dispatchEvent(new CustomEvent('preview-toast', { detail: message }));
}

const defaults: Record<string, Record<string, (...args: any[]) => any>> = {
  PluginManager: {
    init: () => ok(),
    registerButton: () => ok(),
    registerButtonListener: () => ok(),
    registerMotionListener: () => ok(),
    registerLangListener: () => ok(),
    addPluginLifeListener: () => ok(),
    registerPluginLifeListener: (l: { onMsg: (d: { state: number }) => void }) => {
      lifeListeners.add(l);
      return { remove: () => lifeListeners.delete(l) };
    },
    addEventListener: () => ok(),
    showPluginView: () => { setView(true); notifyPluginLife(2); return ok(); },
    closePluginView: () => { setView(false); return ok(); },
    showToast: (msg: string) => { toast(msg); return ok(); },
    // Plain numbers on devices, not APIResponse: 1 = held; 2 = always allowed.
    hasPermission: () => Promise.resolve(1),
    requestPermission: () => Promise.resolve(2),
  },
  /**
   * Page and element calls read and write the in-memory note (mocks/note.ts),
   * so what a plugin puts on a page appears on the simulated page.
   */
  PluginCommAPI: {
    getCurrentFilePath: () => ok(CURRENT_PAGE.filePath),
    getCurrentPageNum: () => ok(NOTE.current),
    getLassoRect: () => ok(null),
    getLassoElements: () => ok([]),
    getLassoElementTypeCounts: () => ok({}),
    // Enough of an element for code that sets fields on one and inserts it.
    createElement: (type: number) =>
      ok({ type, layerNum: 0, link: {}, textBox: {}, picture: {}, recycle: () => {} }),
    canHandwrite: () => ok(true),
    jumpToPage: (page: number) => ok(goToPage(page)),
    reloadFile: () => ok(true),
    getPageDisplaySize: () => ok(CURRENT_PAGE.pageSize),
    insertPageElements: (els: unknown[], page: number, layer?: number | null) => {
      addElements(page, els, layer);
      return ok(true);
    },
    deletePageElements: (nums: number[], page: number) => {
      removeElements(page, nums);
      return ok(true);
    },
    batchUpdatePageElements: (nums: number[], els: unknown[], page: number, layer?: number | null) => {
      removeElements(page, nums);
      addElements(page, els, layer);
      return ok(true);
    },
  },
  PluginFileAPI: {
    getNoteTotalPageNum: (path?: string) => ok(pageCount(path)),
    getPageSize: () => ok(CURRENT_PAGE.pageSize),
    getKeyWords: (path: string, pages: number[]) => ok(keywordsOn(pages ?? [], path)),
    insertKeyWord: (path: string, page: number, keyword: string) => {
      addKeyword(page, keyword, path);
      return ok(true);
    },
    deleteKeyWord: (path: string, page: number, index: number) =>
      ok(removeKeyword(page, index, path)),
    getNotePageTemplate: (path: string, page: number) => {
      // As the firmware: a PNG template by file name, and no path.
      const t = templateOf(page, path);
      const file = t.split('/').pop()!.replace(/\.png$/i, '');
      return ok({ name: t.includes('/') ? `user_${file}` : t, md5: `md5:${t}` });
    },
    getElements: (page: number, path?: string) => ok(elementsOn(page, path)),
    getElementNumList: () => ok([]),
    getTitles: () => ok([]),
    insertElements: (path: string, page: number, els: unknown[]) => {
      addElements(page, els, undefined, path);
      return ok(true);
    },
    modifyElements: () => ok(),
    deleteElements: (path: string, page: number, nums: number[]) => {
      removeElements(page, nums, path);
      return ok(true);
    },
    insertNotePage: (params: { notePath?: string; page: number; template: string }) => {
      insertPage(params.page, params.template, params.notePath);
      return ok(true);
    },
    removeNotePage: (path: string, page: number) => ok(removePage(page, path)),
    createNote: (params: { notePath: string; template: string }) => {
      createNoteFile(params.notePath, params.template);
      return ok(true);
    },
    getLayers: (path: string, page: number) => ok(layersOn(page, path)),
    insertLayer: (path: string, page: number, layer: { layerId?: number; name?: string }) =>
      ok(addLayer(page, layer, path)),
    generateNoteTemplatePng: (path: string, page: number, png: string) => {
      snapshotTemplate(page, png, CURRENT_PAGE.pageSize, path);
      return ok(true);
    },
    openFile: () => ok(),
  },
  PluginNoteAPI: {
    saveCurrentNote: () => ok(),
    insertText: () => ok(),
    insertImage: () => ok(),
  },
  PluginDocAPI: {},
  /**
   * Filesystem helpers. Unlike the API objects above, FileUtils is the bare
   * native module (RTNFileUtils), so it resolves PLAIN values, not
   * `{success, result}`: `exists()` gives `false`, not an object that happens
   * to be truthy. Answers are deliberately "nothing is there": an empty listing
   * and exists:false, so a plugin renders its empty state rather than a
   * half-populated one built from guesses, except for images the plugin
   * captured or copied this session (mocks/note.ts). Other writes report
   * success and change nothing. Give a scenario real answers through
   * `sdk.overrides` when a screen needs files to show.
   */
  FileUtils: {
    exists: (path: string) => {
      console.log('[preview-sdk] FileUtils.exists', path);
      return Promise.resolve(hasImage(path) || noteExists(path));
    },
    getExternalDirPath: logged('FileUtils.getExternalDirPath', []),
    makeDir: logged('FileUtils.makeDir', true),
    getExportPath: logged('FileUtils.getExportPath', '/storage/emulated/0/EXPORT'),
    renameToFile: logged('FileUtils.renameToFile', true),
    copyFile: (from: string, to: string) => {
      console.log('[preview-sdk] FileUtils.copyFile', from, to);
      copyImage(from, to);
      return Promise.resolve(true);
    },
    listFiles: logged('FileUtils.listFiles', []),
    getFileMD5: logged('FileUtils.getFileMD5', ''),
    deleteFile: logged('FileUtils.deleteFile', true),
    deleteDir: logged('FileUtils.deleteDir', true),
    getFileList: logged('FileUtils.getFileList', []),
    getImageList: logged('FileUtils.getImageList', []),
    openFilePath: logged('FileUtils.openFilePath', true),
    getStorageAvailableSpace: logged('FileUtils.getStorageAvailableSpace', 16 * 1024 ** 3),
  },
  /**
   * The native file picker. Returns nothing chosen, which is the "user backed
   * out" path. A browser cannot show the device's picker, and inventing a
   * selection would send the plugin down a branch the user never took.
   */
  RattaFileSelector: {
    selectFile: () => ok(null),
  },
  NativePluginManager: {
    getPluginDirPath: () => Promise.resolve('/data/plugin/preview'),
    getOrientation: () => Promise.resolve(0),
    showPluginView: () => { setView(true); return ok(); },
  },
};

let extra: Record<string, Record<string, (...args: any[]) => any>> = {};

/** Applied by the harness from your preview config, before boot. */
export function configureSdk(config: SdkConfig | undefined): void {
  if (!config) return;
  if (config.page) Object.assign(CURRENT_PAGE, config.page);
  extra = {};
  for (const [api, methods] of Object.entries(config.overrides ?? {})) {
    extra[api] = { ...methods };
  }
}

function apiFor(name: string) {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      const override = extra[name]?.[prop];
      if (override) return override;
      const base = defaults[name]?.[prop];
      if (base) return base;
      return (...args: unknown[]) => {
        console.log(`[preview-sdk] ${name}.${String(prop)}`, ...args);
        return ok();
      };
    },
  });
}

/**
 * Typed `any`, deliberately. A Proxy answers every property, so there is no
 * honest interface to write here, and pretending to one would mean this file
 * silently going stale against the SDK it is standing in for. Your plugin is
 * type-checked against the real sn-plugin-lib in its own repo; this only has to
 * let a browser build through.
 */
export const PluginManager: any = apiFor('PluginManager');
export const PluginCommAPI: any = apiFor('PluginCommAPI');
export const PluginFileAPI: any = apiFor('PluginFileAPI');
export const PluginNoteAPI: any = apiFor('PluginNoteAPI');
export const PluginDocAPI: any = apiFor('PluginDocAPI');
export const FileUtils: any = apiFor('FileUtils');
export const RattaFileSelector: any = apiFor('RattaFileSelector');
export const NativePluginManager: any = apiFor('NativePluginManager');

export const EventType = { BUTTON_CLICK: 1, PEN_UP: 2 };
export const ElementType = {
  TYPE_STROKE: 100, TYPE_PICTURE: 200, TYPE_TITLE: 300,
  TYPE_GEOMETRY: 400, TYPE_TEXT: 500, TYPE_LINK: 600,
};
export const PointUtils = {
  androidPoint2Emr: (p: unknown) => p,
  emrPoint2Android: (p: unknown) => p,
};

export default {
  PluginManager, PluginCommAPI, PluginFileAPI, PluginNoteAPI,
  PluginDocAPI, NativePluginManager, FileUtils, RattaFileSelector,
};
