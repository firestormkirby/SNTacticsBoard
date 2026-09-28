import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {NativeModules} from 'react-native';

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
  setMoveMode: jest.fn(),
};

import App from '../App';

const text = (root: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(root.toJSON());

it('asks for the overlay permission before showing the palette', async () => {
  let root!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  expect(text(root)).toContain('Pen draws, finger moves.');
  expect(text(root)).toContain('Allow the palette');

  const allow = root.root.find(
    n =>
      n.props.accessibilityLabel === 'Allow the palette' &&
      typeof n.props.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => allow.props.onPress());
  expect(
    NativeModules.SoccerPalette.requestOverlayPermission,
  ).toHaveBeenCalled();
});

it('shows the palette and returns to the note once allowed', async () => {
  NativeModules.SoccerPalette.canDrawOverlays.mockResolvedValue(true);
  let root!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  const show = root.root.find(
    n =>
      n.props.accessibilityLabel === 'Show the palette' &&
      typeof n.props.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => show.props.onPress());
  expect(NativeModules.SoccerPalette.show).toHaveBeenCalledWith(
    expect.objectContaining({side: 'right', pieceSize: 63}),
  );
  const {PluginManager} = require('sn-plugin-lib');
  expect(PluginManager.closePluginView).toHaveBeenCalled();
});
