import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import App from '../App';
import {BOARD_KEY} from '../src/board/storage';

function layoutEvent(width: number, height: number) {
  return {nativeEvent: {layout: {x: 0, y: 0, width, height}}};
}

/** Mount the app and report a board area of the given size, in dp. */
async function mountWithBoard(width: number, height: number) {
  let root!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => {
    const board = root.root.find(n => typeof n.props.onLayout === 'function');
    board.props.onLayout(layoutEvent(width, height));
  });
  return root;
}

/** The board area below the toolbar on an A5X held upright. */
const mountOnNomad = () => mountWithBoard(994, 1249);

/** Distinct draggable pieces on screen. */
const pieceCount = (root: ReactTestRenderer.ReactTestRenderer) =>
  new Set(
    root.root
      .findAll(n => n.props.accessibilityRole === 'adjustable')
      .map(n => n.props.accessibilityLabel),
  ).size;

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('renders the board with every piece in the tray on first run', async () => {
  const root = await mountOnNomad();
  expect(pieceCount(root)).toBeGreaterThan(0);
  const text = JSON.stringify(root.toJSON());
  expect(text).toContain('Clear Board');
  expect(text).toContain('Export to Note');
  expect(text).toContain('Team X');
});

it('restores a saved drill and clears it', async () => {
  await AsyncStorage.setItem(
    BOARD_KEY,
    JSON.stringify({version: 1, placed: [{id: 'x1', x: 0.5, y: 0.5}]}),
  );
  const root = await mountOnNomad();
  const clear = root.root.find(
    n =>
      n.props.accessibilityLabel === 'Clear Board' &&
      typeof n.props.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => {
    clear.props.onPress();
  });
  expect(JSON.parse((await AsyncStorage.getItem(BOARD_KEY))!).placed).toEqual(
    [],
  );
});

it('turns the pitch to run across the screen in landscape', async () => {
  const pitchOrientation = async (w: number, h: number) => {
    const root = await mountWithBoard(w, h);
    const pitch = root.root.find(
      n => typeof n.props.landscape === 'boolean' && 'width' in n.props,
    );
    return {landscape: pitch.props.landscape, pieces: pieceCount(root)};
  };
  expect(await pitchOrientation(1365, 948)).toEqual({
    landscape: true,
    pieces: 31,
  });
  expect(await pitchOrientation(994, 1249)).toEqual({
    landscape: false,
    pieces: 31,
  });
});
