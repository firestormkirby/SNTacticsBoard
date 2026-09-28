import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  deleteLayout,
  layoutOnPage,
  listLayouts,
  saveLayout,
} from '../src/layouts/layoutStore';

beforeEach(() => AsyncStorage.clear());

const page = {width: 1404, height: 1872};

it('saves positions as page fractions and puts them back on any page', async () => {
  const saved = await saveLayout(
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
  await saveLayout('a', [{kind: 'ball', x: 1, y: 1}], page, 3);
  let list = await listLayouts();
  expect(list.map(l => l.name)).toEqual(['a', 'B']);
  expect(list[0].pieces).toHaveLength(1);

  await deleteLayout(list[1].id);
  list = await listLayouts();
  expect(list.map(l => l.name)).toEqual(['a']);
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
