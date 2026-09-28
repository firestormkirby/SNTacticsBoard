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

it('closes the view, then inserts the diagram as the next page background', async () => {
  const out = await exportPngToNote('/cache/snap.png');

  expect(PluginManager.closePluginView).toHaveBeenCalled();
  expect(FileUtils.copyFile).toHaveBeenCalledWith(
    '/cache/snap.png',
    expect.stringMatching(
      /^\/storage\/emulated\/0\/EXPORT\/SNSoccer\/drill-\d{8}-\d{6}\.png$/,
    ),
  );
  expect(PluginNoteAPI.saveCurrentNote).toHaveBeenCalled();
  const png = (FileUtils.copyFile as jest.Mock).mock.calls[0][1];
  expect(PluginFileAPI.insertNotePage).toHaveBeenCalledWith({
    notePath: '/storage/emulated/0/Note/Drills.note',
    page: 2,
    template: png,
  });
  expect(PluginCommAPI.jumpToPage).toHaveBeenCalledWith(3);
  expect(PluginNoteAPI.insertImage).not.toHaveBeenCalled();
  expect(out).toEqual({kind: 'background', page: 3, png});
});

it('falls back to a blank page plus a picture when the template is refused', async () => {
  (PluginFileAPI.insertNotePage as jest.Mock)
    .mockResolvedValueOnce({success: false, error: {message: 'bad template'}})
    .mockResolvedValueOnce({success: true, result: true});

  const out = await exportPngToNote('/cache/snap.png');

  expect(
    (PluginFileAPI.insertNotePage as jest.Mock).mock.calls[1][0].template,
  ).toBe('style_white');
  expect(PluginCommAPI.jumpToPage).toHaveBeenCalledWith(3);
  expect(PluginNoteAPI.insertImage).toHaveBeenCalledWith(out?.png);
  expect(out?.kind).toBe('picture');
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
