/** The floating button's place and state, in AsyncStorage. */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PaletteSettings {
  /** Whether the button is switched on. */
  visible: boolean;
  /** Button's top-left in screen pixels; null means the default spot. */
  x: number | null;
  y: number | null;
  /** Whether the palette was left open. */
  open: boolean;
  /** Whether a pen drag on the button, palette or a piece locks the pen. */
  penLock: boolean;
}

const KEY = 'snsoccer:palette:v2';
const DEFAULTS: PaletteSettings = {
  visible: false,
  x: null,
  y: null,
  open: false,
  penLock: true,
};

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export async function loadPaletteSettings(): Promise<PaletteSettings> {
  try {
    const json = await AsyncStorage.getItem(KEY);
    const s = json ? (JSON.parse(json) as Partial<PaletteSettings>) : {};
    return {
      visible: s.visible === true,
      x: num(s.x),
      y: num(s.y),
      open: s.open === true,
      penLock: s.penLock !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

export async function updatePaletteSettings(
  patch: Partial<PaletteSettings>,
): Promise<PaletteSettings> {
  const next = {...(await loadPaletteSettings()), ...patch};
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('[snsoccer] could not save palette settings', e);
  }
  return next;
}
