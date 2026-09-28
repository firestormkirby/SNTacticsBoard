/**
 * Soccer Board's menu: opened by holding the floating button, or from the
 * Note toolbar.
 *
 * The drawing happens on the note page itself, with the Supernote pen. Pieces
 * come from the floating button (android/.../palette): tap it for the
 * palette, drag a piece onto the page, drag pieces on the page to move them.
 *
 * This menu switches the button on, and holds the two exports:
 *  1. Copy this page to a new page, with everything on it.
 *  2. Save where the pieces are under a name, to load onto any page later.
 *
 * Anything that changes the note runs after the menu closes, because SDK
 * calls can deadlock while it is open (see src/palette/controller.ts).
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {DIM, INK, NET, PAPER} from './src/components/colors';
import PieceGlyph from './src/components/PieceGlyph';
import PitchSheet from './src/components/PitchSheet';
import {
  SavedLayout,
  deleteLayout,
  listLayouts,
  saveLayout,
} from './src/layouts/layoutStore';
import {hasPitch, pageSizeForScreen, savePitch} from './src/page/capture';
import {PieceKind} from './src/page/pieceShapes';
import {palette} from './src/palette/bridge';
import {
  addPitch,
  closePanelThen,
  copyThisPage,
  getCurrentPieces,
  hideButton,
  loadLayoutHere,
  panelOpened,
} from './src/palette/controller';
import {
  loadPaletteSettings,
  updatePaletteSettings,
} from './src/palette/settings';

type PitchState = 'checking' | 'making' | 'ready' | 'failed';

/** Let the pitch sheet reach the screen before it is photographed. */
const nextFrames = () =>
  new Promise<void>(done =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(done, 80)),
    ),
  );

const LEGEND: Array<{kind: PieceKind; label: string}> = [
  {kind: 'attacker', label: 'Team X'},
  {kind: 'defender', label: 'Team O'},
  {kind: 'cone', label: 'Cone'},
  {kind: 'ball', label: 'Ball'},
];

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const dateOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Close the menu with nothing else to do. */
const close = () => closePanelThen(async () => {});

export default function App(): React.JSX.Element {
  const [permission, setPermission] = useState<boolean | null>(null);
  const [buttonOn, setButtonOn] = useState(false);
  const [pitch, setPitch] = useState<PitchState>('checking');
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const screen = useRef(Dimensions.get('screen')).current;
  const pageSize = useRef(
    pageSizeForScreen(screen.width, screen.height),
  ).current;
  const sheetRef = useRef<View>(null);
  const capturing = useRef(false);
  // What was on the page when the menu opened: the menu can't read the note.
  const here = useRef(getCurrentPieces()).current;
  const pieceCount = here?.pieces.length ?? 0;

  const refresh = useCallback(async () => {
    setPermission(await palette.canDrawOverlays());
    setButtonOn((await loadPaletteSettings()).visible);
    setLayouts(await listLayouts());
  }, []);

  useEffect(() => {
    // Opened from the toolbar rather than the button: take the button down.
    panelOpened();
    refresh();
    hasPitch(pageSize)
      .then(ready => setPitch(ready ? 'ready' : 'making'))
      .catch(e => {
        console.warn('[snsoccer] could not check the pitch', e);
        setPitch('making');
      });
  }, [pageSize, refresh]);

  const onSheetLayout = useCallback(async () => {
    if (capturing.current || !sheetRef.current) {
      return;
    }
    capturing.current = true;
    try {
      await nextFrames();
      await savePitch(sheetRef.current, pageSize);
      setPitch('ready');
    } catch (e) {
      console.error('[snsoccer] could not make the pitch', e);
      setPitch('failed');
    }
  }, [pageSize]);

  const showButton = useCallback(async () => {
    await updatePaletteSettings({visible: true});
    close(); // the button comes up as the menu closes
  }, []);

  const hide = useCallback(async () => {
    await hideButton();
    setButtonOn(false);
  }, []);

  const save = useCallback(async () => {
    if (!here || here.pieces.length === 0) {
      return;
    }
    try {
      const saved = await saveLayout(name, here.pieces, here.ctx.pageSize);
      setName('');
      setNotice(
        `Saved "${saved.name}" with ${plural(saved.pieces.length, 'piece')}.`,
      );
      setLayouts(await listLayouts());
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, [here, name]);

  const remove = useCallback(
    async (id: string) => {
      if (confirmDelete !== id) {
        setConfirmDelete(id);
        return;
      }
      await deleteLayout(id);
      setConfirmDelete(null);
      setLayouts(await listLayouts());
    },
    [confirmDelete],
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
      {pitch === 'making' && (
        <PitchSheet
          ref={sheetRef}
          width={screen.width}
          height={screen.height}
          onLayout={onSheetLayout}
        />
      )}

      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Soccer Board</Text>
          <Button label="✕" onPress={close} square accessibilityLabel="Close" />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          <Section title="Floating button">
            {!palette.available ? (
              <Text style={styles.para}>
                The floating button isn't in this build of the plugin. Build it
                with npm run build:plugin, which includes its native code.
              </Text>
            ) : permission === false ? (
              <>
                <Text style={styles.para}>
                  The button floats over the note, which needs Android's
                  "Display over other apps" permission for the Supernote plugin
                  host. Allow it on the next screen, then come back here.
                </Text>
                <View style={styles.row}>
                  <Button
                    label="Allow the button"
                    primary
                    onPress={() => palette.requestOverlayPermission()}
                  />
                  <Button label="I've allowed it" onPress={refresh} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.para}>
                  Tap the button to open the pieces and drag one onto the page.
                  Drag a piece on the page to move it, or onto the button to
                  remove it. Hold the button to come back here.
                </Text>
                <View style={styles.row}>
                  {buttonOn ? (
                    <>
                      <Button
                        label="Back to the note"
                        primary
                        onPress={close}
                      />
                      <Button label="Hide the button" onPress={hide} />
                    </>
                  ) : (
                    <Button
                      label="Show the button"
                      primary
                      disabled={permission === null}
                      onPress={showButton}
                    />
                  )}
                </View>
              </>
            )}
          </Section>

          <Section title="Copy this page">
            <Text style={styles.para}>
              A new page after this one with the background, your drawing and
              the pieces, all still editable. Handy for the next phase of a
              drill.
            </Text>
            <View style={styles.row}>
              <Button
                label="Copy to a new page"
                primary
                onPress={() => closePanelThen(copyThisPage)}
              />
            </View>
          </Section>

          <Section title="Save the layout">
            <Text style={styles.para}>
              {pieceCount > 0
                ? `Saves where the ${plural(
                    pieceCount,
                    'piece',
                  )} on this page are, under a name, to load onto any page later. The drawing isn't saved.`
                : 'Put some pieces on the page, then save where they are under a name to load onto any page later.'}
            </Text>
            <View style={styles.row}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Name, e.g. Rondo 4v2"
                placeholderTextColor={DIM}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={save}
                accessibilityLabel="Layout name"
              />
              <Button
                label="Save"
                primary
                disabled={pieceCount === 0 || !name.trim()}
                onPress={save}
              />
            </View>
            {notice && <Text style={styles.notice}>{notice}</Text>}
          </Section>

          <Section title="Saved layouts">
            {layouts.length === 0 ? (
              <Text style={[styles.para, styles.dim]}>
                No saved layouts yet.
              </Text>
            ) : (
              <>
                <Text style={[styles.para, styles.dim]}>
                  Loading replaces the pieces on the page you're on. Your
                  drawing stays.
                </Text>
                {layouts.map(l => (
                  <View key={l.id} style={styles.layout}>
                    <View style={styles.layoutText}>
                      <Text style={styles.layoutName} numberOfLines={1}>
                        {l.name}
                      </Text>
                      <Text style={styles.layoutMeta}>
                        {plural(l.pieces.length, 'piece')} · {dateOf(l.savedAt)}
                      </Text>
                    </View>
                    <Button
                      label="Load"
                      primary
                      onPress={() =>
                        closePanelThen(() => loadLayoutHere(l.name, l.pieces))
                      }
                    />
                    <Button
                      label={confirmDelete === l.id ? 'Delete?' : 'Delete'}
                      onPress={() => remove(l.id)}
                    />
                  </View>
                ))}
              </>
            )}
          </Section>

          <Section title="Pitch pages">
            <Text style={styles.para}>
              {pitch === 'ready'
                ? 'Add a page with a blank pitch after this one.'
                : pitch === 'failed'
                ? "The pitch background couldn't be prepared. Close and reopen Soccer Board to try again."
                : 'Preparing the pitch background…'}
            </Text>
            <View style={styles.row}>
              <Button
                label="Add a pitch page"
                primary
                disabled={pitch !== 'ready'}
                onPress={() => closePanelThen(addPitch)}
              />
            </View>
          </Section>

          <Section title="Pieces">
            <View style={styles.legend}>
              {LEGEND.map(item => (
                <View key={item.kind} style={styles.legendItem}>
                  <PieceGlyph kind={item.kind} size={36} />
                  <Text style={styles.legendText}>{item.label}</Text>
                </View>
              ))}
            </View>
          </Section>
        </ScrollView>
      </View>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  primary,
  square,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  square?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={6}
      style={({pressed}) => {
        // Pressed inverts, which e-ink shows instantly and clearly.
        const dark = primary ? !pressed : pressed;
        return [
          styles.button,
          square && styles.buttonSquare,
          dark && styles.buttonDark,
          disabled && styles.buttonDisabled,
        ];
      }}>
      {({pressed}) => (
        <Text
          style={[
            styles.buttonText,
            square && styles.buttonTextSquare,
            (primary ? !pressed : pressed) &&
              !disabled &&
              styles.buttonTextDark,
            disabled && styles.buttonTextDisabled,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: PAPER},
  screen: {...StyleSheet.absoluteFillObject, backgroundColor: PAPER},

  header: {
    height: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 3,
    borderBottomColor: INK,
  },
  title: {fontSize: 26, fontWeight: 'bold', color: INK},

  body: {
    padding: 28,
    gap: 26,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  para: {fontSize: 18, lineHeight: 27, color: INK},
  dim: {color: DIM},
  notice: {fontSize: 18, color: INK, fontWeight: 'bold'},

  section: {gap: 12, borderTopWidth: 2, borderTopColor: INK, paddingTop: 16},
  sectionTitle: {fontSize: 20, fontWeight: 'bold', color: INK},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center'},

  input: {
    flex: 1,
    minWidth: 220,
    height: 56,
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 19,
    color: INK,
    backgroundColor: PAPER,
  },

  layout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: NET,
  },
  layoutText: {flex: 1, minWidth: 0},
  layoutName: {fontSize: 19, fontWeight: 'bold', color: INK},
  layoutMeta: {fontSize: 15, color: DIM, marginTop: 2},

  legend: {flexDirection: 'row', flexWrap: 'wrap', gap: 24},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: 10},
  legendText: {fontSize: 18, color: INK},

  button: {
    height: 56,
    paddingHorizontal: 22,
    borderWidth: 3,
    borderColor: INK,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAPER,
  },
  buttonSquare: {width: 52, height: 52, paddingHorizontal: 0},
  buttonDark: {backgroundColor: INK},
  buttonDisabled: {borderColor: NET, backgroundColor: PAPER},
  buttonText: {fontSize: 19, fontWeight: 'bold', color: INK},
  buttonTextSquare: {fontSize: 24},
  buttonTextDark: {color: PAPER},
  buttonTextDisabled: {color: NET},
});
