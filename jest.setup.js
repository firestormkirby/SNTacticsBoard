/* global jest */
// Native modules have no implementation under Jest; stand them in.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(
    async () => 'file:///cache/ReactNative-snapshot-image1.png',
  ),
}));

jest.mock('sn-plugin-lib', () => {
  const ok = result => Promise.resolve({success: true, result});
  return {
    PluginManager: {
      init: jest.fn(),
      registerButton: jest.fn(() => Promise.resolve(true)),
      closePluginView: jest.fn(() => Promise.resolve(true)),
      showPluginView: jest.fn(() => Promise.resolve(true)),
    },
    PluginCommAPI: {
      getCurrentFilePath: jest.fn(() =>
        ok('/storage/emulated/0/Note/Drills.note'),
      ),
      getCurrentPageNum: jest.fn(() => ok(2)),
      reloadFile: jest.fn(() => ok(true)),
      jumpToPage: jest.fn(() => ok(true)),
    },
    PluginFileAPI: {
      getNoteTotalPageNum: jest.fn(() => ok(12)),
      insertNotePage: jest.fn(() => ok(true)),
    },
    PluginNoteAPI: {
      saveCurrentNote: jest.fn(() => ok(true)),
      insertImage: jest.fn(() => ok(true)),
    },
    FileUtils: {
      getExportPath: jest.fn(() =>
        Promise.resolve('/storage/emulated/0/EXPORT'),
      ),
      makeDir: jest.fn(() => Promise.resolve(true)),
      copyFile: jest.fn(() => Promise.resolve(true)),
    },
  };
});
