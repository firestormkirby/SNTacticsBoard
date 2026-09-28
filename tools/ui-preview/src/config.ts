/**
 * The contract between this harness and your plugin.
 *
 * Everything the harness needs to know about a specific plugin lives in one
 * file, `preview.config.tsx` in the repo root, which exports a PreviewConfig.
 * Nothing else in src/ should need editing to preview a different plugin.
 */
import type { ComponentType } from 'react';

/** A file in the fake /storage tree. A plain string is shorthand for contents. */
export interface FakeFile {
  contents?: string;
  size?: number;
  mtime?: number;
}

/**
 * One saved state of a device, and the only mechanism for staging a screen.
 *
 * The point is that a scenario contains no UI instructions. It is the data a
 * real device would have, handed to your plugin's real loading code. If a
 * screen cannot be reached by seeding data, that is usually worth knowing about
 * the plugin, not a reason to add a back door here.
 */
export interface Scenario {
  id: string;
  label: string;
  /** One line in the sidebar saying what this state is for. */
  note?: string;
  /** AsyncStorage contents. Objects are JSON-stringified for you. */
  storage?: Record<string, unknown>;
  /** Extra fake files for this scenario, merged over `files` below. */
  files?: Record<string, FakeFile | string>;
  /** SDK answers for this scenario, merged over `sdk` below. */
  sdk?: SdkConfig;
  /**
   * Image URL drawn behind the panel: a note page, a document, whatever your
   * plugin sits on top of. Import it so the bundler resolves it:
   * `import page from './assets/page.png'`.
   */
  backdrop?: string;
}

export interface DevicePreset {
  id: string;
  label: string;
  /** Screen size in pixels. The preview iframe is set to exactly this. */
  width: number;
  height: number;
  note?: string;
}

/**
 * What the SDK mock should answer.
 *
 * `overrides` is keyed by API object then method, and is merged over the
 * defaults: anything you do not list keeps the generic behaviour (resolve to
 * `{success: true}` and log the call). Add an entry when a real return value
 * drives what renders, a page count or a lasso rect or a keyword list.
 */
export interface SdkConfig {
  /** Answers to the common "where am I" questions. */
  page?: {
    filePath?: string;
    pageNum?: number;
    totalPages?: number;
    /** Whatever your plugin treats as the page's template/background id. */
    template?: string;
    pageSize?: { width: number; height: number };
  };
  overrides?: Record<string, Record<string, (...args: any[]) => any>>;
}

export interface PreviewConfig {
  /** Shown in the sidebar. */
  name: string;
  /** Your plugin's root UI component, imported from its own source. */
  Panel: ComponentType;
  /**
   * Runs once before the panel mounts, after storage and files are seeded.
   *
   * This is where your plugin's own startup goes, the `init*FromStorage()`
   * calls it makes in index.js, in the same order. Keeping it here rather than
   * inside the harness means a scenario is loaded by your shipping code.
   */
  boot?: (scenario: Scenario) => Promise<void> | void;
  scenarios: Scenario[];
  /** Fake /storage tree shared by every scenario. */
  files?: Record<string, FakeFile | string>;
  /** SDK answers shared by every scenario. */
  sdk?: SdkConfig;
  /** Defaults to one Manta and one Nomad preset. */
  devices?: DevicePreset[];
  /**
   * Content hashes by path, for plugins that identify a file by hashing it.
   * The fake filesystem hashes paths deterministically; pin one here when a
   * seeded id has to match what a hash would return.
   */
  hashes?: Record<string, string>;
}
