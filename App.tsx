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
 *  2. Save this page under a name, to add again later as a new page, or to
 *     put just its pieces onto another page.
 *
 * Anything that changes the note runs after the menu closes, because SDK
 * calls can deadlock while it is open (see src/palette/controller.ts).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
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
import {
  SavedLayout,
  deleteLayout,
  hasPage,
  listLayouts,
} from './src/layouts/layoutStore';
import {PieceKind} from './src/page/pieceShapes';
import {ensureFileAccess} from './src/sdk/filePermissions';
import {palette} from './src/palette/bridge';
import {
  buttonProblem,
  closePanelThen,
  copyThisPage,
  isPenLocked,
  lastButtonError,
  loadLayoutAsPage,
  loadLayoutHere,
  onMenuOpen,
  onPenLock,
  panelOpened,
  saveThisPage,
  ButtonProblem,
  setButtonOn as switchButton,
} from './src/palette/controller';
import {
  loadPaletteSettings,
  updatePaletteSettings,
} from './src/palette/settings';

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
  /** Shared-storage access: null while asking. */
  const [files, setFiles] = useState<boolean | null>(null);
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Why the button didn't come up last time, if it didn't.
  const [problem, setProblem] = useState<ButtonProblem | null>(null);

  const refresh = useCallback(async () => {
    setProblem(buttonProblem());
    setPermission(await palette.canDrawOverlays());
    const settings = await loadPaletteSettings();
    setButtonOn(settings.visible);
    setPenLock(settings.penLock);
    setLayouts(await listLayouts());
  }, []);

  /**
   * Page copies and saved layouts are kept in EXPORT, which the plugin can't
   * touch until it is allowed. Asked here, with the menu open, because the
   * host can't show its dialog otherwise.
   */
  const askForFiles = useCallback(async () => {
    setFiles(await ensureFileAccess());
  }, []);

  useEffect(() => {
    // Every opening, not just this first one: the tree stays mounted.
    const off = onMenuOpen(() => {
      refresh();
      askForFiles();
    });
    // Opened from the toolbar rather than the button: take the button down.
    // Unless the pen lock opened the view mid-drag: that's not the menu.
    if (!isPenLocked()) {
      panelOpened();
    }
    return off;
  }, [askForFiles, refresh]);

  // While the pen is locked for a drag, the host has our view open; keep it
  // empty and see-through, so the note and the drag carry on as they were.
  const [penLocked, setPenLocked] = useState(isPenLocked());
  useEffect(() => onPenLock(setPenLocked), []);

  const [penLock, setPenLock] = useState(true);
  const togglePenLock = useCallback(async (on: boolean) => {
    setPenLock(on);
    await updatePaletteSettings({penLock: on});
  }, []);

  const toggleButton = useCallback(async (on: boolean) => {
    setButtonOn(on);
    await switchButton(on);
  }, []);

  const save = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setName('');
    // Reading the page needs the menu closed; a message confirms the save.
    closePanelThen(() => saveThisPage(trimmed));
  }, [name]);

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

  if (penLocked) {
    return <View style={styles.blank} pointerEvents="none" />;
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={PAPER} />
      {/* Tapping the page around the menu closes it, as in Modulanner. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityLabel="Close the menu"
      />
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Soccer Board</Text>
          <Button label="✕" onPress={close} square accessibilityLabel="Close" />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          <Section title="Floating button">
            <View style={styles.setting}>
              <Text style={[styles.para, styles.settingText]}>
                A small button over your page. Tap it for the pieces and drag
                one onto the page; drag a piece on the page to move it, or onto
                the button to remove it. Drag the button to move it, and hold it
                to come back here.
              </Text>
              <Toggle
                value={buttonOn}
                onValueChange={toggleButton}
                accessibilityLabel="Floating button"
              />
            </View>
            {buttonOn && (
              <ButtonStatus
                permission={permission}
                problem={problem}
                onCheckAgain={refresh}
              />
            )}
            <View style={styles.setting}>
              <Text style={[styles.para, styles.settingText]}>
                Stop the pen writing while it drags the button or a piece. The
                screen may flash as the pen is locked and unlocked; any line
                that still gets drawn is erased after the drop.
              </Text>
              <Toggle
                value={penLock}
                onValueChange={togglePenLock}
                accessibilityLabel="Lock the pen while dragging"
              />
            </View>
          </Section>

          {files === false && (
            <Section title="File access">
              <Text style={styles.para}>
                Soccer Board saves page copies and saved layouts in the EXPORT
                folder, so it needs permission to read and write files. Choose
                "Always allow" so it doesn't ask each time.
              </Text>
              <View style={styles.row}>
                <Button
                  label="Allow file access"
                  primary
                  onPress={askForFiles}
                />
              </View>
            </Section>
          )}

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
                disabled={files !== true}
                onPress={() => closePanelThen(copyThisPage)}
              />
            </View>
          </Section>

          <Section title="Save this page">
            <Text style={styles.para}>
              Saves the whole page, background, drawing and pieces, under a
              name: a drill you'll run again, or a base to start from. The menu
              closes while it saves.
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
                disabled={files !== true || !name.trim()}
                onPress={save}
              />
            </View>
          </Section>

          <Section title="Saved layouts">
            {layouts.length === 0 ? (
              <Text style={[styles.para, styles.dim]}>
                No saved layouts yet.
              </Text>
            ) : (
              <>
                <Text style={[styles.para, styles.dim]}>
                  New page adds a copy after the page you're on. Pieces here
                  swaps the pieces on this page for the saved ones and keeps
                  your drawing.
                </Text>
                {layouts.map(l => (
                  <View key={l.id} style={styles.layout}>
                    <View style={styles.layoutText}>
                      <Text style={styles.layoutName} numberOfLines={1}>
                        {l.name}
                      </Text>
                      <Text style={styles.layoutMeta}>
                        {describe(l)} · {dateOf(l.savedAt)}
                      </Text>
                    </View>
                    <View style={styles.row}>
                      {hasPage(l) && (
                        <Button
                          label="New page"
                          primary
                          disabled={files !== true}
                          onPress={() =>
                            closePanelThen(() => loadLayoutAsPage(l))
                          }
                        />
                      )}
                      {l.pieces.length > 0 && (
                        <Button
                          label="Pieces here"
                          primary={!hasPage(l)}
                          onPress={() =>
                            closePanelThen(() =>
                              loadLayoutHere(l.name, l.pieces),
                            )
                          }
                        />
                      )}
                      <Button
                        label={confirmDelete === l.id ? 'Delete?' : 'Delete'}
                        onPress={() => remove(l.id)}
                      />
                    </View>
                  </View>
                ))}
              </>
            )}
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

/** What a saved layout holds, in a few words. */
function describe(l: SavedLayout): string {
  const pieces = plural(l.pieces.length, 'piece');
  if (!hasPage(l)) {
    return `${pieces} only`;
  }
  const page = l.template ? `${l.template} page` : 'Page';
  if (l.pieces.length === 0) {
    return l.marks ? `${page} with drawing` : page;
  }
  return l.marks
    ? `${page} with ${pieces} and drawing`
    : `${page} with ${pieces}`;
}

/** Whether the button can come up, and what to do if not. */
function ButtonStatus({
  permission,
  problem,
  onCheckAgain,
}: {
  permission: boolean | null;
  problem: ButtonProblem | null;
  onCheckAgain: () => void;
}) {
  if (!palette.available) {
    return (
      <Text style={[styles.para, styles.strong]}>
        This build of the plugin is missing the button's native code. Rebuild it
        with npm run build:plugin and look for a Gradle error in the build
        output: without one, the .snplg holds an app.npk.
      </Text>
    );
  }
  if (permission === false) {
    return (
      <>
        <Text style={[styles.para, styles.strong]}>
          Android isn't letting the Supernote plugin host display over other
          apps. Allow it on the next screen, then come back and check again.
        </Text>
        <View style={styles.row}>
          <Button
            label="Open settings"
            primary
            onPress={() => palette.requestOverlayPermission()}
          />
          <Button label="Check again" onPress={onCheckAgain} />
        </View>
      </>
    );
  }
  if (problem === 'failed') {
    return (
      <Text style={[styles.para, styles.strong]}>
        The button couldn't be shown last time: {lastButtonError()}
      </Text>
    );
  }
  return (
    <Text style={[styles.para, styles.dim]}>
      It appears when you close this menu.
    </Text>
  );
}

/** An on/off switch, drawn for e-ink: black when on. */
function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{checked: value}}
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
      <View style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]} />
    </Pressable>
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
  // A popout rather than a full screen: the root is see-through, so the note
  // shows around the card (Modulanner's panel does the same).
  blank: {flex: 1, backgroundColor: 'transparent'},
  root: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '67%',
    height: '67%',
    minWidth: 560,
    backgroundColor: PAPER,
    borderWidth: 3, // a thick border stands in for a shadow on e-ink
    borderColor: INK,
    borderRadius: 12,
    overflow: 'hidden',
  },

  header: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 3,
    borderBottomColor: INK,
  },
  title: {fontSize: 24, fontWeight: 'bold', color: INK},

  body: {
    padding: 24,
    gap: 22,
  },
  para: {fontSize: 18, lineHeight: 27, color: INK},
  dim: {color: DIM},
  strong: {fontWeight: 'bold'},

  setting: {flexDirection: 'row', alignItems: 'center', gap: 20},
  settingText: {flex: 1},
  track: {
    width: 68,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    borderColor: INK,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: {backgroundColor: INK},
  trackOff: {backgroundColor: PAPER},
  thumb: {width: 26, height: 26, borderRadius: 13},
  thumbOn: {alignSelf: 'flex-end', backgroundColor: PAPER},
  thumbOff: {alignSelf: 'flex-start', backgroundColor: INK},

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
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: NET,
  },
  layoutText: {minWidth: 0},
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
