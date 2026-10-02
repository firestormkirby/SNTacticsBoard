import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

NativeModules.TacticsPalette = {
  canDrawOverlays: jest.fn(async () => false),
  requestOverlayPermission: jest.fn(),
  getScreenInfo: jest.fn(async () => ({
    width: 1404,
    height: 1872,
    density: 1.41,
    rotation: 0,
  })),
  show: jest.fn(async () => true),
  hide: jest.fn(),
  isShowing: jest.fn(async () => false),
  setPieces: jest.fn(),
  startTicking: jest.fn(),
  stopTicking: jest.fn(),
};

import App from '../App';
import {saveLayout} from '../src/layouts/layoutStore';
import {loadPaletteSettings} from '../src/palette/settings';

const text = (root: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(root.toJSON());
const button = (root: ReactTestRenderer.ReactTestRenderer, label: string) =>
  root.root.find(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  );

async function mount() {
  let root!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  return root;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('switches the button on and off with a toggle', async () => {
  NativeModules.TacticsPalette.canDrawOverlays.mockResolvedValue(true);
  const root = await mount();
  const toggle = () => button(root, 'Floating button');
  expect(toggle().props.accessibilityState).toEqual({checked: false});

  await ReactTestRenderer.act(async () => toggle().props.onPress());
  expect(toggle().props.accessibilityState).toEqual({checked: true});
  expect((await loadPaletteSettings()).visible).toBe(true);
  // Nothing to report when all is well: the button simply comes up.
  expect(text(root)).not.toContain('Open settings');

  await ReactTestRenderer.act(async () => toggle().props.onPress());
  expect((await loadPaletteSettings()).visible).toBe(false);
  expect(NativeModules.TacticsPalette.hide).toHaveBeenCalled();
});

it("says so when Android won't let the button show", async () => {
  NativeModules.TacticsPalette.canDrawOverlays.mockResolvedValue(false);
  const root = await mount();
  await ReactTestRenderer.act(async () =>
    button(root, 'Floating button').props.onPress(),
  );
  expect(text(root)).toContain('Overlay permissions not working');
  await ReactTestRenderer.act(async () =>
    button(root, 'Open settings').props.onPress(),
  );
  expect(
    NativeModules.TacticsPalette.requestOverlayPermission,
  ).toHaveBeenCalled();
});

it('offers Save, not Copy (the palette has it), and lists saved layouts', async () => {
  NativeModules.TacticsPalette.canDrawOverlays.mockResolvedValue(true);
  const size = {width: 1404, height: 1872};
  await saveLayout('Old pieces', [{kind: 'cone', x: 10, y: 10}], size, 1);
  await saveLayout('Rondo 4v2', [{kind: 'ball', x: 9, y: 9}], size, 2, {
    keyword: '~BOARD:Futsal Court:Rondo 4v2',
    template: 'Futsal Court',
    background: 'bg.png',
    marks: 12,
  });
  const root = await mount();
  const t = text(root);
  expect(t).not.toContain('Copy this page');
  expect(t).toContain('Save this page');
  expect(t).toContain('Futsal Court template with 1 piece and drawings');
  expect(t).toContain('1 piece only');
  const count = (label: string) =>
    t.split(`"accessibilityLabel":"${label}"`).length - 1;
  expect(count('New page')).toBe(1);
  expect(count('Pieces here')).toBe(0);

  // Save needs a name, then closes the menu to read the page.
  expect(button(root, 'Save').props.disabled).toBe(true);
  await ReactTestRenderer.act(async () =>
    root.root
      .find(
        n =>
          n.props.placeholder === 'Name, e.g. Rondo 4v2' &&
          n.props.onChangeText,
      )
      .props.onChangeText('Warm-up'),
  );
  expect(button(root, 'Save').props.disabled).toBe(false);
  await ReactTestRenderer.act(async () => button(root, 'Save').props.onPress());
  const {PluginManager} = require('sn-plugin-lib');
  expect(PluginManager.closePluginView).toHaveBeenCalled();
});

it('asks for file access, and holds back file work until it has it', async () => {
  const {PluginManager} = require('sn-plugin-lib');
  PluginManager.hasPermission.mockResolvedValue(0);
  PluginManager.requestPermission.mockResolvedValueOnce(0);
  const root = await mount();
  expect(PluginManager.requestPermission).toHaveBeenCalledWith(
    'plugin.permission.FILE:READ',
    expect.any(String),
  );
  expect(text(root)).toContain('Allow file access');
  expect(button(root, 'Clean up now').props.disabled).toBe(true);

  // Allowed the second time round.
  PluginManager.requestPermission.mockResolvedValue(2);
  await ReactTestRenderer.act(async () =>
    button(root, 'Allow file access').props.onPress(),
  );
  expect(text(root)).not.toContain('Allow file access');
  expect(button(root, 'Clean up now').props.disabled).toBe(false);
  PluginManager.hasPermission.mockResolvedValue(1);
});

it('folds the Saved layouts list away, and remembers', async () => {
  const size = {width: 1404, height: 1872};
  await saveLayout('Corners drill', [{kind: 'ball', x: 9, y: 9}], size, 2);
  const root = await mount();
  expect(text(root)).toContain('Corners drill');

  await ReactTestRenderer.act(async () => button(root, '1 ▴').props.onPress());
  expect(text(root)).not.toContain('Corners drill');
  const {loadPaletteSettings} = require('../src/palette/settings');
  expect((await loadPaletteSettings()).layoutsOpen).toBe(false);

  await ReactTestRenderer.act(async () => button(root, '1 ▾').props.onPress());
  expect(text(root)).toContain('Corners drill');
});
