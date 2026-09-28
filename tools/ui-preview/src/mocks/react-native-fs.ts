/**
 * In-memory stand-in for react-native-fs, backed by a fake /storage tree.
 *
 * A flat map of path -> contents. Directories are implied by the paths, which
 * is enough for readDir/readdir/exists/stat and keeps a scenario's filesystem
 * readable as a plain object (see fixtures/files.ts).
 *
 * Why bother with a tree at all rather than returning empty lists: the template
 * pickers, the pack list and the calendar setup-file scanner all render off
 * real directory reads, and those screens are most of what a user guide needs
 * pictures of. An empty filesystem would produce screenshots of empty states.
 */

export interface FakeFile {
  /** File contents. Binary assets (PNG templates) can use any placeholder. */
  contents?: string;
  size?: number;
  mtime?: number;
}

let files: Record<string, FakeFile> = {};
let hashes: Record<string, string> = {};

export function seedFiles(next: Record<string, FakeFile | string>): void {
  files = {};
  for (const [path, v] of Object.entries(next)) {
    files[normalise(path)] = typeof v === 'string' ? { contents: v } : v;
  }
}

/** Pin path -> content hash, so a template can read as one already known. */
export function seedHashes(next: Record<string, string>): void {
  hashes = { ...next };
}

function normalise(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function parentOf(p: string): string {
  const n = normalise(p);
  return n.slice(0, n.lastIndexOf('/'));
}

function baseOf(p: string): string {
  const n = normalise(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

/** Immediate children of a directory, files and subdirectories alike. */
function childrenOf(dir: string): Array<{ name: string; path: string; isDir: boolean }> {
  const base = normalise(dir);
  const seen = new Map<string, { name: string; path: string; isDir: boolean }>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(base + '/')) continue;
    const rest = path.slice(base.length + 1);
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (!seen.has(name)) {
      seen.set(name, { name, path: base + '/' + name, isDir: slash !== -1 });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function dirExists(p: string): boolean {
  const base = normalise(p);
  return Object.keys(files).some(f => f.startsWith(base + '/'));
}

function statObject(path: string, isDir: boolean) {
  const f = files[normalise(path)];
  return {
    name: baseOf(path),
    path: normalise(path),
    size: f?.size ?? f?.contents?.length ?? 1024,
    mtime: new Date(f?.mtime ?? Date.now()),
    ctime: new Date(f?.mtime ?? Date.now()),
    isFile: () => !isDir,
    isDirectory: () => isDir,
  };
}

const RNFS = {
  DocumentDirectoryPath: '/storage/emulated/0/Android/data/plugin/files',
  ExternalStorageDirectoryPath: '/storage/emulated/0',

  async exists(path: string): Promise<boolean> {
    const n = normalise(path);
    return n in files || dirExists(n);
  },

  async readDir(path: string) {
    if (!dirExists(path)) throw new Error(`ENOENT: no such directory ${path}`);
    return childrenOf(path).map(c => statObject(c.path, c.isDir));
  },

  /** RNFS's lowercase variant returns names only. Both spellings are used. */
  async readdir(path: string): Promise<string[]> {
    if (!dirExists(path)) throw new Error(`ENOENT: no such directory ${path}`);
    return childrenOf(path).map(c => c.name);
  },

  async stat(path: string) {
    const n = normalise(path);
    if (!(n in files) && !dirExists(n)) throw new Error(`ENOENT: ${path}`);
    return statObject(n, !(n in files));
  },

  async readFile(path: string): Promise<string> {
    const f = files[normalise(path)];
    if (!f) throw new Error(`ENOENT: no such file ${path}`);
    return f.contents ?? '';
  },

  async writeFile(path: string, contents: string): Promise<void> {
    files[normalise(path)] = { contents, mtime: Date.now() };
  },

  async mkdir(path: string): Promise<void> {
    // Directories are implied by their contents; a marker keeps an empty one
    // visible to exists().
    files[normalise(path) + '/.keep'] = { contents: '' };
  },

  async unlink(path: string): Promise<void> {
    const n = normalise(path);
    if (n in files) { delete files[n]; return; }
    for (const f of Object.keys(files)) if (f.startsWith(n + '/')) delete files[f];
  },

  async copyFile(from: string, to: string): Promise<void> {
    files[normalise(to)] = { ...(files[normalise(from)] ?? { contents: '' }), mtime: Date.now() };
  },

  async moveFile(from: string, to: string): Promise<void> {
    await RNFS.copyFile(from, to);
    delete files[normalise(from)];
  },

  async hash(path: string): Promise<string> {
    // Template IDs are content hashes. A stable fake keyed on the path is
    // enough, since the UI only compares them for equality, but a scenario
    // that wants a template to look ALREADY KNOWN has to pin the hash to the
    // id it seeded, or the Hitboxes tab greets every screenshot with
    // "Template changes detected. Import prior configuration?".
    const n = normalise(path);
    if (n in hashes) return hashes[n];
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0').repeat(4);
  },

  downloadFile() {
    return { promise: Promise.resolve({ statusCode: 404, bytesWritten: 0, jobId: 0 }) };
  },
};

export default RNFS;
