import {
  AFTER_EDIT_MS,
  AFTER_UNLOCK_MS,
  noteBusyFor,
  pageEdit,
  resetNoteGate,
  setSleeper,
} from '../src/sdk/noteGate';

describe('the note gate', () => {
  let now = 1_000_000;
  const waits: number[] = [];

  beforeEach(() => {
    resetNoteGate();
    waits.length = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    setSleeper(async ms => {
      waits.push(ms);
      now += ms;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('lets the first edit through at once', async () => {
    await pageEdit(async () => 'done');
    expect(waits).toEqual([]);
  });

  it('spaces edits so the note can redraw between them', async () => {
    await pageEdit(async () => 1);
    now += 100;
    await pageEdit(async () => 2);
    expect(waits).toEqual([AFTER_EDIT_MS - 100]);
  });

  it('waits out the reload after the pen lock lifts', async () => {
    noteBusyFor(AFTER_UNLOCK_MS);
    now += 130; // the stray-stroke delete that crashed the Note app
    const order: string[] = [];
    await pageEdit(async () => {
      order.push('edit');
    });
    expect(waits).toEqual([AFTER_UNLOCK_MS - 130]);
    expect(order).toEqual(['edit']);
  });

  it('still spaces the next edit when one fails', async () => {
    await expect(
      pageEdit(async () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    await pageEdit(async () => 1);
    expect(waits).toEqual([AFTER_EDIT_MS]);
  });
});
