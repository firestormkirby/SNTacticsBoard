/** Where the palette sits and whether it was left showing, in AsyncStorage. */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type {Side} from './bridge';

export interface PaletteSettings {
  side: Side;
  /** Top of the palette in screen pixels; null means centred. */
  y: number | null;
}

const KEY = 'snsoccer:palette:v1';
const DEFAULTS: PaletteSettings = {side: 'right', y: null};

export async function loadPaletteSettings(): Promise<PaletteSettings> {
  try {
    const json = await AsyncStorage.getItem(KEY);
    const saved = json ? (JSON.parse(json) as Partial<PaletteSettings>) : {};
    return {
      side: saved.side === 'left' ? 'left' : 'right',
      y:
        typeof saved.y === 'number' && Number.isFinite(saved.y)
          ? saved.y
          : null,
    };
  } catch {
    return DEFAULTS;
  }
}

export async function savePaletteSettings(s: PaletteSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('[snsoccer] could not save palette settings', e);
  }
}
