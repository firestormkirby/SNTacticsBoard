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

export function createFakeNote(opts: {dropsUserData?: boolean} = {}) {
  const state = {
    notePath: '/storage/emulated/0/Note/Drills.note',
    current: 0,
    pageSize: {width: 1404, height: 1872},
    pages: [] as Page[],
    files: new Set<string>(),
    calls: [] as string[],
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
      jumpToPage: (page: number) => {
        state.current = page;
        return ok(true);
      },
    },
    PluginFileAPI: {
      getPageSize: () => ok(state.pageSize),
      getNoteTotalPageNum: () => ok(state.pages.length),
      getElements: (page: number) =>
        ok(state.pages[page].elements.map(e => ({...e, recycle: () => {}}))),
      insertElements: (_path: string, page: number, els: Element[]) => {
        track('insertElements');
        els.forEach(e => store(state.pages[page], e));
        return ok(true);
      },
      getLayers: (_path: string, page: number) => ok(state.pages[page].layers),
      insertLayer: (_path: string, page: number, layer: any) => {
        state.pages[page].layers.push({
          layerId: layer.layerId,
          name: layer.name,
        });
        return ok(true);
      },
      insertNotePage: ({page, template}: {page: number; template: string}) => {
        track('insertNotePage');
        state.pages.splice(page, 0, newPage(template));
        return ok(true);
      },
      generateNoteTemplatePng: (_path: string, page: number, png: string) => {
        state.files.add(png);
        return ok(state.pages[page].template);
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
