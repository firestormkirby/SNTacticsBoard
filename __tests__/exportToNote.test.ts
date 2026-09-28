import {ToastAndroid} from 'react-native';
import {
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
} from 'sn-plugin-lib';

import {exportPngToNote, pageSizeFor} from '../src/export/exportToNote';

jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});

beforeEach(() => jest.clearAllMocks());

it('closes the view, then inserts the diagram as the page after this one', async () => {
  const out = await exportPngToNote('/cache/snap.png');

  expect(PluginManager.closePluginView).toHaveBeenCalled();
  expect(FileUtils.copyFile).toHaveBeenCalledWith(
    '/cache/snap.png',
    expect.stringMatching(
      /^\/storage\/emulated\/0\/EXPORT\/SNSoccer\/drill-\d{8}-\d{6}\.png$/,
    ),
  );
  const png = (FileUtils.copyFile as jest.Mock).mock.calls[0][1];
  // Current page is index 2; the new page takes index 3, straight after it.
  expect(PluginFileAPI.insertNotePage).toHaveBeenCalledWith({
    notePath: '/storage/emulated/0/Note/Drills.note',
    page: 3,
    template: png,
  });
  expect(PluginCommAPI.jumpToPage).toHaveBeenCalledWith(3);
  expect(out).toEqual({page: 3, png});
});

it('saves the note before inserting, so recent strokes are kept', async () => {
  await exportPngToNote('/cache/snap.png');
  const saved = (PluginNoteAPI.saveCurrentNote as jest.Mock).mock
    .invocationCallOrder[0];
  const inserted = (PluginFileAPI.insertNotePage as jest.Mock).mock
    .invocationCallOrder[0];
  expect(saved).toBeLessThan(inserted);
});

it('treats a null answer from older firmware as success', async () => {
  (PluginFileAPI.insertNotePage as jest.Mock).mockResolvedValueOnce(null);
  (PluginNoteAPI.saveCurrentNote as jest.Mock).mockResolvedValueOnce(null);
  const out = await exportPngToNote('/cache/snap.png');
  expect(out?.page).toBe(3);
  expect(PluginCommAPI.jumpToPage).toHaveBeenCalledWith(3);
});

it('appends at the end when exporting from the last page', async () => {
  (PluginCommAPI.getCurrentPageNum as jest.Mock).mockResolvedValueOnce({
    success: true,
    result: 11,
  });
  const out = await exportPngToNote('/cache/snap.png');
  expect(
    (PluginFileAPI.insertNotePage as jest.Mock).mock.calls[0][0].page,
  ).toBe(12);
  expect(out?.page).toBe(12);
});

it('reports a refused insert and does not navigate', async () => {
  (PluginFileAPI.insertNotePage as jest.Mock).mockResolvedValueOnce({
    success: false,
    error: {message: 'Background template file does not exist!'},
  });
  expect(await exportPngToNote('/cache/snap.png')).toBeNull();
  expect(PluginCommAPI.jumpToPage).not.toHaveBeenCalled();
  expect(ToastAndroid.show).toHaveBeenCalledWith(
    expect.stringContaining('Background template file does not exist!'),
    expect.anything(),
  );
});

it('refuses to export when no note is open', async () => {
  (PluginCommAPI.getCurrentFilePath as jest.Mock).mockResolvedValueOnce({
    success: true,
    result: '/storage/emulated/0/Document/book.pdf',
  });
  expect(await exportPngToNote('/cache/snap.png')).toBeNull();
  expect(PluginFileAPI.insertNotePage).not.toHaveBeenCalled();
  expect(ToastAndroid.show).toHaveBeenCalledWith(
    expect.stringContaining('open a note first'),
    expect.anything(),
  );
});

it('snaps near-miss capture sizes to the real page size', () => {
  expect(pageSizeFor(1920, 2559.4)).toEqual({width: 1920, height: 2560});
  expect(pageSizeFor(1404, 1871.6)).toEqual({width: 1404, height: 1872});
  expect(pageSizeFor(2559.4, 1920)).toEqual({width: 2560, height: 1920});
  expect(pageSizeFor(1000, 1333.3)).toEqual({width: 1000, height: 1333});
});
