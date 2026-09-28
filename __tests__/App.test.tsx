import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

NativeModules.SoccerPalette = {
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
  NativeModules.SoccerPalette.canDrawOverlays.mockResolvedValue(true);
  const root = await mount();
  const toggle = () => button(root, 'Floating button');
  expect(toggle().props.accessibilityState).toEqual({checked: false});

  await ReactTestRenderer.act(async () => toggle().props.onPress());
  expect(toggle().props.accessibilityState).toEqual({checked: true});
  expect((await loadPaletteSettings()).visible).toBe(true);
  expect(text(root)).toContain('It appears when you close this menu.');

  await ReactTestRenderer.act(async () => toggle().props.onPress());
  expect((await loadPaletteSettings()).visible).toBe(false);
  expect(NativeModules.SoccerPalette.hide).toHaveBeenCalled();
});

it("says so when Android won't let the button show", async () => {
  NativeModules.SoccerPalette.canDrawOverlays.mockResolvedValue(false);
  const root = await mount();
  await ReactTestRenderer.act(async () =>
    button(root, 'Floating button').props.onPress(),
  );
  expect(text(root)).toContain('display over other');
  await ReactTestRenderer.act(async () =>
    button(root, 'Open settings').props.onPress(),
  );
  expect(
    NativeModules.SoccerPalette.requestOverlayPermission,
  ).toHaveBeenCalled();
});

it('offers both exports and lists saved layouts', async () => {
  NativeModules.SoccerPalette.canDrawOverlays.mockResolvedValue(true);
  const size = {width: 1404, height: 1872};
  await saveLayout('Old pieces', [{kind: 'cone', x: 10, y: 10}], size, 1);
  await saveLayout('Rondo 4v2', [{kind: 'ball', x: 9, y: 9}], size, 2, {
    keyword: '~BOARD:Soccer Field:Rondo 4v2',
    template: 'Soccer Field',
    background: 'bg.png',
    marks: 12,
  });
  const root = await mount();
  const t = text(root);
  expect(t).toContain('Copy to a new page');
  expect(t).toContain('Save this page');
  expect(t).toContain('Soccer Field page with 1 piece and drawing');
  expect(t).toContain('1 piece only');
  const count = (label: string) =>
    t.split(`"accessibilityLabel":"${label}"`).length - 1;
  expect(count('New page')).toBe(1);
  expect(count('Pieces here')).toBe(2);

  // Save needs a name, then closes the menu to read the page.
  expect(button(root, 'Save').props.disabled).toBe(true);
  await ReactTestRenderer.act(async () =>
    root.root
      .find(
        n =>
          n.props.accessibilityLabel === 'Layout name' && n.props.onChangeText,
      )
      .props.onChangeText('Warm-up'),
  );
  expect(button(root, 'Save').props.disabled).toBe(false);
  await ReactTestRenderer.act(async () => button(root, 'Save').props.onPress());
  const {PluginManager} = require('sn-plugin-lib');
  expect(PluginManager.closePluginView).toHaveBeenCalled();
});

it('asks for file access, and holds back the exports until it has it', async () => {
  const {PluginManager} = require('sn-plugin-lib');
  PluginManager.hasPermission.mockResolvedValue(0);
  PluginManager.requestPermission.mockResolvedValueOnce(0);
  const root = await mount();
  expect(PluginManager.requestPermission).toHaveBeenCalledWith(
    'plugin.permission.FILE:READ',
    expect.any(String),
  );
  expect(text(root)).toContain('Allow file access');
  expect(button(root, 'Copy to a new page').props.disabled).toBe(true);
  expect(button(root, 'Add a pitch page').props.disabled).toBe(true);

  // Allowed the second time round.
  PluginManager.requestPermission.mockResolvedValue(2);
  await ReactTestRenderer.act(async () =>
    button(root, 'Allow file access').props.onPress(),
  );
  expect(text(root)).not.toContain('Allow file access');
  expect(button(root, 'Copy to a new page').props.disabled).toBe(false);
  PluginManager.hasPermission.mockResolvedValue(1);
});
