import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import App from '../App';
import {BOARD_KEY} from '../src/board/storage';

function layoutEvent(width: number, height: number) {
  return {nativeEvent: {layout: {x: 0, y: 0, width, height}}};
}

/** Mount the app and feed it the layout sizes a Nomad would report. */
async function mountOnNomad() {
  let root!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => {
    const views = root.root.findAll(
      n => typeof n.props.onLayout === 'function',
    );
    // Root view first, then the board area below the toolbar.
    views[0].props.onLayout(layoutEvent(994, 1325));
    views[views.length - 1].props.onLayout(layoutEvent(994, 1249));
  });
  return root;
}

const pieceCount = (root: ReactTestRenderer.ReactTestRenderer) =>
  root.root.findAll(
    n =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityRole === 'adjustable',
  ).length;

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

it('shows a portrait-only notice in landscape', async () => {
  let root!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    root = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => {
    const views = root.root.findAll(
      n => typeof n.props.onLayout === 'function',
    );
    views[0].props.onLayout(layoutEvent(1325, 994));
  });
  expect(JSON.stringify(root.toJSON())).toContain('Portrait only');
});
