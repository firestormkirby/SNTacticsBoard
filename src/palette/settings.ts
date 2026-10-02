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
  /** Whether a named page has its name written on it. */
  pageLabel: boolean;
  /** Whether EXPORT/SNTacticsBoard is cleaned up after each Save, Load, Reset. */
  autoCleanup: boolean;
  /** Whether the menu's Saved layouts list is open. */
  layoutsOpen: boolean;
}

const KEY = 'tacticsboard:palette:v2';
const DEFAULTS: PaletteSettings = {
  visible: false,
  x: null,
  y: null,
  open: false,
  penLock: true,
  pageLabel: true,
  autoCleanup: false,
  layoutsOpen: true,
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
      pageLabel: s.pageLabel !== false,
      autoCleanup: s.autoCleanup === true,
      layoutsOpen: s.layoutsOpen !== false,
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
    console.warn('[tactics] could not save palette settings', e);
  }
  return next;
}
