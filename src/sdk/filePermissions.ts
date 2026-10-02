/**
 * File access under the Supernote plugin permission system (firmware from
 * 2026-08-24 on).
 *
 * Tactics Board writes to shared storage: saving and copying a page render
 * that page's background to EXPORT/SNTacticsBoard/, and saved layouts go
 * there too. Both need plugin.permission.FILE:READ and FILE:WRITE, which
 * cover the shared folders (Document, EXPORT, INBOX, MyStyle, Note,
 * SCREENSHOT) as a whole.
 *
 * Found on devices by Modulanner:
 *  - They must be listed in PluginConfig.json's `uses-permissions`, or
 *    requestPermission throws (error 1500).
 *  - hasPermission and requestPermission answer plain numbers, not an
 *    APIResponse.
 *  - Ask with the panel open: from the background the host may not be able
 *    to show its dialog.
 *  - "Allow this time only" lapses when the plugin closes, so every panel
 *    open checks again; only "Always allow" sticks.
 *  - Firmware without the permission system throws or answers oddly. That
 *    counts as allowed: there is nothing to ask for.
 */
import {PluginManager} from 'sn-plugin-lib';

export const FILE_READ = 'plugin.permission.FILE:READ';
export const FILE_WRITE = 'plugin.permission.FILE:WRITE';
/** Only asked for when the user turns on a clean-up in the menu. */
export const FILE_DELETE = 'plugin.permission.FILE:DELETE';

const WHY =
  'Tactics Board saves page backgrounds and page copies in EXPORT. ' +
  'Choose "Always allow" so it doesn\'t ask again each time.';

const WHY_DELETE =
  'Tactics Board deletes the extra background images and leftover pages it ' +
  'made in EXPORT/SNTacticsBoard. Choose "Always allow" to clean up ' +
  'automatically.';

async function ensureOne(permission: string, why = WHY): Promise<boolean> {
  try {
    const held = await PluginManager.hasPermission(permission);
    if (typeof held !== 'number') {
      return true; // no permission system on this firmware
    }
    if (held === 1) {
      return true;
    }
    // 0 = refused, 1 = this time only, 2 = always.
    const answer = await PluginManager.requestPermission(permission, why);
    return answer === 1 || answer === 2;
  } catch (e) {
    if (typeof PluginManager.hasPermission !== 'function') {
      return true;
    }
    console.warn('[tactics] file permission', permission, e);
    return false;
  }
}

let pending: Promise<boolean> | null = null;

/**
 * Make sure the plugin can read and write shared storage, asking if need be.
 * One request at a time, so two callers can't raise the dialog twice. A
 * refusal isn't remembered: calling again asks again, for an "Allow" button.
 */
export function ensureFileAccess(): Promise<boolean> {
  if (!pending) {
    pending = (async () => {
      const read = await ensureOne(FILE_READ);
      const write = read && (await ensureOne(FILE_WRITE));
      return read && write;
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}

/**
 * Make sure the plugin can delete files, asking if need be: for the menu's
 * clean-up, with the menu open (the host's dialog needs it).
 */
export function ensureDeleteAccess(): Promise<boolean> {
  return ensureOne(FILE_DELETE, WHY_DELETE);
}

/**
 * Whether the plugin may delete files now, without asking: for the
 * automatic clean-up, which runs with the menu closed, where the host can't
 * show its dialog.
 */
export async function hasDeleteAccess(): Promise<boolean> {
  try {
    const held = await PluginManager.hasPermission(FILE_DELETE);
    return typeof held !== 'number' || held === 1;
  } catch {
    return typeof PluginManager.hasPermission !== 'function';
  }
}
