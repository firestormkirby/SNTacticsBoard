/**
 * An in-memory note that answers the SDK calls the page operations make, so
 * their logic can be tested without a device. It models what the operations
 * rely on (pages, layers, elements with numInPage, userData) and nothing more.
 */
type Element = Record<string, any>;

interface Page {
  template: string;
  layers: Array<{layerId: number; name: string}>;
  elements: Element[];
  nextNum: number;
}

const ok = (result?: unknown) => Promise.resolve({success: true, result});

export function createFakeNote(
  opts: {dropsUserData?: boolean; noJump?: boolean} = {},
) {
  const notePath = '/storage/emulated/0/Note/Drills.note';
  const state = {
    notePath,
    current: 0,
    pageSize: {width: 1404, height: 1872},
    /** Every note file, by path. `pages` is the open one's. */
    notes: new Map<string, Page[]>(),
    pages: [] as Page[],
    files: new Set<string>(),
    calls: [] as string[],
  };
  state.notes.set(notePath, state.pages);
  state.files.add(notePath);
  const pagesOf = (path: string) => {
    const pages = state.notes.get(path);
    if (!pages) {
      throw new Error(`no such note: ${path}`);
    }
    return pages;
  };
  const newPage = (template: string): Page => ({
    template,
    layers: [{layerId: 0, name: 'Main Layer'}],
    elements: [],
    nextNum: 1,
  });
  state.pages.push(newPage('style_white'));

  const store = (page: Page, el: Element) => {
    const copy: Element = {...el, numInPage: page.nextNum++};
    if (opts.dropsUserData) {
      copy.userData = '';
    }
    page.elements.push(copy);
  };
  const remove = (page: Page, nums: number[]) => {
    page.elements = page.elements.filter(e => !nums.includes(e.numInPage));
  };
  const track = (name: string) => state.calls.push(name);

  const sdk = {
    PluginCommAPI: {
      getCurrentFilePath: () => ok(state.notePath),
      getCurrentPageNum: () => ok(state.current),
      createElement: (type: number) => ok({type, recycle: () => {}}),
      insertPageElements: (els: Element[], page: number) => {
        track('insertPageElements');
        els.forEach(e => store(state.pages[page], e));
        return ok(true);
      },
      batchUpdatePageElements: (
        nums: number[],
        els: Element[],
        page: number,
      ) => {
        track('batchUpdatePageElements');
        remove(state.pages[page], nums);
        els.forEach(e => store(state.pages[page], e));
        return ok(true);
      },
      deletePageElements: (nums: number[], page: number) => {
        track('deletePageElements');
        remove(state.pages[page], nums);
        return ok(true);
      },
      ...(opts.noJump
        ? {}
        : {
            jumpToPage: (page: number) => {
              state.current = page;
              return ok(true);
            },
          }),
    },
    PluginFileAPI: {
      getPageSize: () => ok(state.pageSize),
      getNoteTotalPageNum: (path: string) => ok(pagesOf(path).length),
      getElements: (page: number, path: string) =>
        ok(pagesOf(path)[page].elements.map(e => ({...e, recycle: () => {}}))),
      insertElements: (path: string, page: number, els: Element[]) => {
        track('insertElements');
        els.forEach(e => store(pagesOf(path)[page], e));
        return ok(true);
      },
      getLayers: (path: string, page: number) => ok(pagesOf(path)[page].layers),
      insertLayer: (path: string, page: number, layer: any) => {
        pagesOf(path)[page].layers.push({
          layerId: layer.layerId,
          name: layer.name,
        });
        return ok(true);
      },
      insertNotePage: ({
        notePath: path,
        page,
        template,
      }: {
        notePath: string;
        page: number;
        template: string;
      }) => {
        track('insertNotePage');
        pagesOf(path).splice(page, 0, newPage(template));
        return ok(true);
      },
      removeNotePage: (path: string, page: number) => {
        track('removeNotePage');
        pagesOf(path).splice(page, 1);
        return ok(true);
      },
      createNote: ({
        notePath: path,
        template,
      }: {
        notePath: string;
        template: string;
      }) => {
        track('createNote');
        state.notes.set(path, [newPage(template)]);
        state.files.add(path);
        return ok(true);
      },
      generateNoteTemplatePng: (path: string, page: number, png: string) => {
        state.files.add(png);
        return ok(pagesOf(path)[page].template);
      },
    },
    PluginNoteAPI: {
      saveCurrentNote: () => ok(true),
    },
    PluginManager: {
      closePluginView: () => Promise.resolve(true),
      showPluginView: () => Promise.resolve(true),
    },
    FileUtils: {
      getExportPath: () => Promise.resolve('/storage/emulated/0/EXPORT'),
      makeDir: () => Promise.resolve(true),
      exists: (p: string) => Promise.resolve(state.files.has(p)),
      copyFile: (_from: string, to: string) => {
        state.files.add(to);
        return Promise.resolve(true);
      },
    },
  };
  return {state, sdk};
}
