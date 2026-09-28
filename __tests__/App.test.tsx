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

it('asks for the overlay permission before the button can show', async () => {
  const root = await mount();
  expect(text(root)).toContain('Allow the button');
  await ReactTestRenderer.act(async () =>
    button(root, 'Allow the button').props.onPress(),
  );
  expect(
    NativeModules.SoccerPalette.requestOverlayPermission,
  ).toHaveBeenCalled();
});

it('offers both exports and lists saved layouts', async () => {
  NativeModules.SoccerPalette.canDrawOverlays.mockResolvedValue(true);
  await saveLayout('Rondo 4v2', [{kind: 'cone', x: 10, y: 10}], {
    width: 1404,
    height: 1872,
  });
  const root = await mount();
  const t = text(root);
  expect(t).toContain('Show the button');
  expect(t).toContain('Copy to a new page');
  expect(t).toContain('Save the layout');
  expect(t).toContain('Rondo 4v2');
  expect(t).toContain('1 piece');
  // Nothing on the page yet, so there is nothing to save.
  expect(button(root, 'Save').props.disabled).toBe(true);
});

it('shows the button by closing the menu', async () => {
  NativeModules.SoccerPalette.canDrawOverlays.mockResolvedValue(true);
  const root = await mount();
  await ReactTestRenderer.act(async () =>
    button(root, 'Show the button').props.onPress(),
  );
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
