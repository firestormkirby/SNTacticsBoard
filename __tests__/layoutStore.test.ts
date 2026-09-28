import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  deleteLayout,
  layoutOnPage,
  libraryPageGone,
  listLayouts,
  pendingRemovals,
  queueRemoval,
  saveLayout,
} from '../src/layouts/layoutStore';

beforeEach(() => AsyncStorage.clear());

const page = {width: 1404, height: 1872};

it('saves positions as page fractions and puts them back on any page', async () => {
  const {layout: saved} = await saveLayout(
    '  Rondo 4v2 ',
    [
      {kind: 'cone', x: 702, y: 936},
      {kind: 'attacker', x: 0, y: 1872},
    ],
    page,
    1000,
  );
  expect(saved.name).toBe('Rondo 4v2');
  expect(saved.pieces).toEqual([
    {kind: 'cone', x: 0.5, y: 0.5},
    {kind: 'attacker', x: 0, y: 1},
  ]);
  expect(layoutOnPage(saved, {width: 1920, height: 2560})).toEqual([
    {kind: 'cone', x: 960, y: 1280},
    {kind: 'attacker', x: 0, y: 2560},
  ]);
});

it('lists newest first, replaces by name, and deletes', async () => {
  await saveLayout('A', [], page, 1);
  await saveLayout('B', [], page, 2);
  const {replaced} = await saveLayout(
    'a',
    [{kind: 'ball', x: 1, y: 1}],
    page,
    3,
  );
  expect(replaced?.name).toBe('A');
  let list = await listLayouts();
  expect(list.map(l => l.name)).toEqual(['a', 'B']);
  expect(list[0].pieces).toHaveLength(1);

  await deleteLayout(list[1].id);
  list = await listLayouts();
  expect(list.map(l => l.name)).toEqual(['a']);
});

it('queues the page of a deleted layout, and renumbers when it goes', async () => {
  const at = (libPage: number) => ({libPage, background: 'bg.png', marks: 0});
  await saveLayout('A', [], page, 1, at(0));
  await saveLayout('B', [], page, 2, at(1));
  await saveLayout('C', [], page, 3, at(2));
  const b = (await listLayouts()).find(l => l.name === 'B')!;
  await deleteLayout(b.id);
  expect(await pendingRemovals()).toEqual([1]);

  await libraryPageGone(1, true);
  expect(await pendingRemovals()).toEqual([]);
  expect((await listLayouts()).map(l => [l.name, l.libPage])).toEqual([
    ['C', 1],
    ['A', 0],
  ]);

  // A page that couldn't go (a note's last page) is simply forgotten.
  await queueRemoval(0);
  await libraryPageGone(0, false);
  expect(await pendingRemovals()).toEqual([]);
  expect((await listLayouts()).map(l => l.libPage)).toEqual([1, 0]);
});

it('refuses an empty name', async () => {
  await expect(saveLayout('   ', [], page)).rejects.toThrow(/name/);
});

it('survives damaged storage', async () => {
  await AsyncStorage.setItem('snsoccer:layouts:v1', '{nope');
  expect(await listLayouts()).toEqual([]);
  await AsyncStorage.setItem(
    'snsoccer:layouts:v1',
    JSON.stringify([
      {
        id: 'x',
        name: 'ok',
        savedAt: 1,
        pieces: [
          {kind: 'cone', x: 0.1, y: 0.2},
          {kind: 'dragon', x: 0, y: 0},
        ],
      },
      {name: 'broken'},
    ]),
  );
  const list = await listLayouts();
  expect(list).toHaveLength(1);
  expect(list[0].pieces).toEqual([{kind: 'cone', x: 0.1, y: 0.2}]);
});
