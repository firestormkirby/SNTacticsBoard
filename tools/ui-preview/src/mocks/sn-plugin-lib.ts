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
    addEventListener: () => ok(),
    showPluginView: () => { setView(true); return ok(); },
    closePluginView: () => { setView(false); return ok(); },
    showToast: (msg: string) => { toast(msg); return ok(); },
    hasPermission: () => ok(true),
    requestPermission: () => ok(true),
  },
  PluginCommAPI: {
    getCurrentFilePath: () => ok(CURRENT_PAGE.filePath),
    getCurrentPageNum: () => ok(CURRENT_PAGE.pageNum),
    getLassoRect: () => ok(null),
    getLassoElements: () => ok([]),
    getLassoElementTypeCounts: () => ok({}),
    // Enough of an element for code that sets fields on one and inserts it.
    createElement: () => ok({ link: {}, textBox: {}, picture: {}, recycle: () => {} }),
    canHandwrite: () => ok(true),
    jumpToPage: () => ok(),
  },
  PluginFileAPI: {
    getNoteTotalPageNum: () => ok(CURRENT_PAGE.totalPages),
    getPageSize: () => ok(CURRENT_PAGE.pageSize),
    getKeyWords: () => ok([]),
    getElements: () => ok([]),
    getElementNumList: () => ok([]),
    getTitles: () => ok([]),
    insertElements: () => ok(),
    modifyElements: () => ok(),
    deleteElements: () => ok(),
    insertNotePage: () => ok(),
    openFile: () => ok(),
  },
  PluginNoteAPI: {
    getNotePageTemplate: () => ok(CURRENT_PAGE.template),
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
   * half-populated one built from guesses. Writes report success and change
   * nothing. Give a scenario real answers through `sdk.overrides` when a
   * screen needs files to show.
   */
  FileUtils: {
    exists: logged('FileUtils.exists', false),
    getExternalDirPath: logged('FileUtils.getExternalDirPath', []),
    makeDir: logged('FileUtils.makeDir', true),
    getExportPath: logged('FileUtils.getExportPath', '/storage/emulated/0/EXPORT'),
    renameToFile: logged('FileUtils.renameToFile', true),
    copyFile: logged('FileUtils.copyFile', true),
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
