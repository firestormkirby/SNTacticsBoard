import {PluginManager} from 'sn-plugin-lib';

import {
  FILE_READ,
  FILE_WRITE,
  ensureFileAccess,
} from '../src/sdk/filePermissions';

const has = PluginManager.hasPermission as jest.Mock;
const request = PluginManager.requestPermission as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  has.mockResolvedValue(1);
  request.mockResolvedValue(2);
});

it("doesn't ask when both are already held", async () => {
  expect(await ensureFileAccess()).toBe(true);
  expect(has).toHaveBeenCalledWith(FILE_READ);
  expect(has).toHaveBeenCalledWith(FILE_WRITE);
  expect(request).not.toHaveBeenCalled();
});

it('asks for each one missing, and "this time only" will do', async () => {
  has.mockResolvedValue(0);
  request.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
  expect(await ensureFileAccess()).toBe(true);
  expect(request.mock.calls.map(c => c[0])).toEqual([FILE_READ, FILE_WRITE]);
});

it('reports a refusal, and asks again next time', async () => {
  has.mockResolvedValue(0);
  request.mockResolvedValue(0);
  expect(await ensureFileAccess()).toBe(false);
  expect(request).toHaveBeenCalledTimes(1); // no point asking to write
  expect(await ensureFileAccess()).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
});

it('raises one dialog for two callers at once', async () => {
  has.mockResolvedValue(0);
  const both = await Promise.all([ensureFileAccess(), ensureFileAccess()]);
  expect(both).toEqual([true, true]);
  expect(request).toHaveBeenCalledTimes(2); // READ and WRITE, once each
});

it('counts firmware without the permission system as allowed', async () => {
  has.mockResolvedValue(undefined);
  expect(await ensureFileAccess()).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it('fails closed when the request itself errors (e.g. not declared)', async () => {
  has.mockResolvedValue(0);
  request.mockRejectedValue(new Error('1500'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await ensureFileAccess()).toBe(false);
});
