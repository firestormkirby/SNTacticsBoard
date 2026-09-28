/**
 * Saves the board to AsyncStorage, so a drill survives closing the plugin,
 * switching notes and rebooting the device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {BoardState, deserializeBoard, serializeBoard} from './boardState';

export const BOARD_KEY = 'snsoccer:board:v1';

export async function loadBoard(): Promise<BoardState> {
  try {
    return deserializeBoard(await AsyncStorage.getItem(BOARD_KEY));
  } catch (e) {
    console.warn('[snsoccer] could not load board', e);
    return deserializeBoard(null);
  }
}

/**
 * Writes are chained so two quick drops can never land out of order and leave
 * the older position on disk.
 */
let pending: Promise<void> = Promise.resolve();

export function saveBoard(state: BoardState): Promise<void> {
  const json = serializeBoard(state);
  pending = pending
    .then(() => AsyncStorage.setItem(BOARD_KEY, json))
    .catch(e => console.warn('[snsoccer] could not save board', e));
  return pending;
}
