/**
 * Keeping EXPORT/SNTacticsBoard small.
 *
 * What the plugin keeps there:
 *  - Layouts.note: saved boards and their earlier versions, a page each.
 *  - Background PNGs: the Note app can only put a page on a background from
 *    an image file, and keeps its own copy of the image in the note. So a
 *    PNG is only needed to make more pages on that background, and any of
 *    them can be rendered again from a page that has it (backgroundOf).
 *
 * What the clean-up removes:
 *  - Background PNGs that are the same image as another (earlier builds
 *    rendered one per save), keeping one;
 *  - Background PNGs no page of Layouts.note is on;
 *  - Pages of Layouts.note with no keyword, left by a save or load that
 *    didn't finish: nothing lists them, and nothing can load them.
 * Never Layouts.note itself, or a page with any keyword on it.
 *
 * Deleting files needs plugin.permission.FILE:DELETE, which is only asked
 * for when the user turns a clean-up on (filePermissions.ts).
 */
import {FileUtils, PluginCommAPI, PluginFileAPI} from 'sn-plugin-lib';

import {listLayouts} from '../layouts/layoutStore';
import {palette} from '../palette/bridge';
import {answer, check} from '../sdk/response';
import {
  exportDir,
  isOldRender,
  keptRenders,
  libraryPath,
  pageTemplate,
  setKeptRenders,
} from './pageOps';

export interface CleanupResult {
  /** Background images deleted. */
  files: number;
  /** Leftover pages taken out of Layouts.note. */
  pages: number;
  /** Bytes freed, or null when the folder's size can't be told. */
  freed: number | null;
}

/** EXPORT/SNTacticsBoard's size in bytes, or null when it can't be told. */
export async function storageUsed(): Promise<number | null> {
  return palette.folderSize(await exportDir());
}

/** "27 MB", "640 KB". */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) {
    return `${Math.round(mb)} MB`;
  }
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** What a clean-up did, in a sentence. */
export function describeCleanup(r: CleanupResult): string {
  if (r.files === 0 && r.pages === 0) {
    return 'Nothing to clean up.';
  }
  const parts = [
    r.files > 0 && `${r.files} image${r.files === 1 ? '' : 's'}`,
    r.pages > 0 && `${r.pages} leftover page${r.pages === 1 ? '' : 's'}`,
  ].filter(Boolean);
  const freed = r.freed ? `, freeing ${formatBytes(r.freed)}` : '';
  return `Cleaned up ${parts.join(' and ')}${freed}.`;
}

export async function cleanUp(): Promise<CleanupResult> {
  const dir = await exportDir();
  const before = await palette.folderSize(dir);
  const pages = await removeLeftoverPages();
  const files = await removeExtraBackgrounds(dir);
  const after = await palette.folderSize(dir);
  return {
    files,
    pages,
    freed:
      before !== null && after !== null ? Math.max(0, before - after) : null,
  };
}

/** The layouts note's pages: how many, and which have a keyword. */
async function libraryPages(
  lib: string,
): Promise<{total: number; tagged: Set<number>}> {
  const total = answer<number>(
    await PluginFileAPI.getNoteTotalPageNum(lib),
    'getNoteTotalPageNum',
  );
  const all =
    answer<Array<{page: number}> | null>(
      await PluginFileAPI.getKeyWords(
        lib,
        Array.from({length: total}, (_, i) => i),
      ),
      'getKeyWords',
    ) ?? [];
  return {total, tagged: new Set(all.map(k => k.page))};
}

/** Take out the layouts note's pages with no keyword. */
async function removeLeftoverPages(): Promise<number> {
  const lib = await libraryPath();
  if (!(await FileUtils.exists(lib))) {
    return 0;
  }
  // Not from under the user: open in the Note app, it's theirs for now.
  const open = (await PluginCommAPI.getCurrentFilePath()) as {
    result?: string;
  } | null;
  if (open?.result === lib) {
    console.log('[tactics] cleanup: Layouts.note is open; its pages wait');
    return 0;
  }
  const {total, tagged} = await libraryPages(lib);
  // A layout saved before keywords knows its page by number until tagged.
  const listed = new Set(
    (await listLayouts())
      .map(l => l.libPage)
      .filter((p): p is number => p !== undefined),
  );
  const leftover = Array.from({length: total}, (_, i) => i)
    .filter(p => !tagged.has(p) && !listed.has(p))
    .sort((a, b) => b - a); // highest first, so the rest keep their numbers
  let left = total;
  let removed = 0;
  for (const page of leftover) {
    if (left <= 1) {
      break; // a note keeps a page
    }
    check(await PluginFileAPI.removeNotePage(lib, page), 'removeNotePage');
    left--;
    removed++;
  }
  return removed;
}

/** The md5 of each background the layouts note's pages are on. */
async function backgroundsInUse(): Promise<Set<string>> {
  const lib = await libraryPath();
  const inUse = new Set<string>();
  if (!(await FileUtils.exists(lib))) {
    return inUse;
  }
  const total = answer<number>(
    await PluginFileAPI.getNoteTotalPageNum(lib),
    'getNoteTotalPageNum',
  );
  for (let page = 0; page < total; page++) {
    const t = await pageTemplate({
      notePath: lib,
      page,
      pageSize: {width: 0, height: 0}, // not needed for its template
    });
    if (t.md5) {
      inUse.add(t.md5);
    }
  }
  return inUse;
}

const baseOf = (path: string) =>
  path
    .split('/')
    .pop()!
    .replace(/\.png$/i, '');

/**
 * Delete background PNGs that repeat another or that no saved page is on.
 * Whatever pointed at a deleted file now points at the one kept.
 */
async function removeExtraBackgrounds(dir: string): Promise<number> {
  const listed = (await FileUtils.listFiles(dir)) ?? [];
  const pngs = listed
    .map(f => (f.startsWith('/') ? f : `${dir}/${f}`))
    .filter(f => /\.png$/i.test(f));
  if (pngs.length === 0) {
    return 0;
  }
  const inUse = await backgroundsInUse();
  const renders = await keptRenders();
  const byMd5 = new Map<string, string[]>();
  for (const png of pngs) {
    const md5 = ((await FileUtils.getFileMD5(png)) ?? '').toLowerCase();
    if (!md5) {
      continue; // can't tell what it is: leave it
    }
    byMd5.set(md5, [...(byMd5.get(md5) ?? []), png]);
  }

  let deleted = 0;
  const gone = new Map<string, string | null>(); // deleted -> kept instead
  for (const [md5, files] of byMd5) {
    // One to keep, if a saved page is on it: the one remembered, or one
    // named after its template, or the first.
    const keep = !inUse.has(md5)
      ? null
      : files.find(f => renders[md5] === f) ??
        files.find(f => !isOldRender(baseOf(f))) ??
        files[0];
    for (const f of files) {
      if (f === keep) {
        continue;
      }
      if (await FileUtils.deleteFile(f)) {
        deleted++;
        gone.set(f, keep);
      } else {
        console.warn('[tactics] cleanup: could not delete', f);
      }
    }
    if (keep) {
      renders[md5] = keep;
    }
  }
  for (const [md5, png] of Object.entries(renders)) {
    if (gone.has(png)) {
      const kept = gone.get(png);
      if (kept) {
        renders[md5] = kept;
      } else {
        delete renders[md5];
      }
    }
  }
  await setKeptRenders(renders);
  return deleted;
}
