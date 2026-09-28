/**
 * Soccer Board: the panel opened from the Note toolbar.
 *
 * The drawing happens on the note page itself, with the Supernote pen. The
 * pieces come from the floating palette, a small native window that stays on
 * screen while you write (android/.../palette): drag a piece off it with your
 * finger and it lands on the page as real note shapes.
 *
 * This panel is for setup: switching the palette on (and granting the
 * permission it needs), preparing the pitch background, and adding pitch
 * pages.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import {DIM, INK, NET, PAPER} from './src/components/colors';
import PieceGlyph from './src/components/PieceGlyph';
import PitchSheet from './src/components/PitchSheet';
import {hasPitch, pageSizeForScreen, savePitch} from './src/page/capture';
import {addPitchPage, getContext} from './src/page/pageOps';
import {PieceKind, pieceSizeFor} from './src/page/pieceShapes';
import {palette} from './src/palette/bridge';
import {loadPaletteSettings} from './src/palette/settings';

type PitchState = 'checking' | 'making' | 'ready' | 'failed';

/** Let the pitch sheet reach the screen before it is photographed. */
const nextFrames = () =>
  new Promise<void>(done =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(done, 80)),
    ),
  );

const LEGEND: Array<{kind: PieceKind; label: string}> = [
  {kind: 'attacker', label: 'Team X player'},
  {kind: 'defender', label: 'Team O player'},
  {kind: 'cone', label: 'Cone'},
  {kind: 'ball', label: 'Ball'},
];

const CONTROLS: Array<[string, string]> = [
  [
    '⠿',
    'Drag the grip to move the palette. Let go and it docks to the nearer side.',
  ],
  [
    'Move',
    'Drag pieces already on the page. Drop one on the palette to remove it.',
  ],
  ['Copy', 'Copy this page, drawings and pieces, to a new page after it.'],
  ['Pitch', 'Add a page with a blank pitch after this one.'],
  ['Hide', 'Put the palette away until you show it again from here.'],
];

function close() {
  PluginManager.closePluginView();
}

function toast(message: string) {
  ToastAndroid.show(message, ToastAndroid.LONG);
}

export default function App(): React.JSX.Element {
  const [permission, setPermission] = useState<boolean | null>(null);
  const [showing, setShowing] = useState(false);
  const [pitch, setPitch] = useState<PitchState>('checking');
  const [notice, setNotice] = useState<string | null>(null);

  const screen = useRef(Dimensions.get('screen')).current;
  const pageSize = useRef(
    pageSizeForScreen(screen.width, screen.height),
  ).current;
  const sheetRef = useRef<View>(null);
  const capturing = useRef(false);

  const refreshPalette = useCallback(async () => {
    setPermission(await palette.canDrawOverlays());
    setShowing(await palette.isShowing());
  }, []);

  useEffect(() => {
    refreshPalette();
    hasPitch(pageSize)
      .then(ready => setPitch(ready ? 'ready' : 'making'))
      .catch(e => {
        console.warn('[snsoccer] could not check the pitch', e);
        setPitch('making');
      });
  }, [pageSize, refreshPalette]);

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

  const showPalette = useCallback(async () => {
    setNotice(null);
    const settings = await loadPaletteSettings();
    const info = await palette.getScreenInfo();
    const shown = await palette.show({
      side: settings.side,
      ...(settings.y !== null ? {y: settings.y} : {}),
      pieceSize: pieceSizeFor(info?.width ?? pageSize.width),
    });
    if (!shown) {
      setPermission(false);
      setNotice('Allow the floating palette first.');
      return;
    }
    close();
  }, [pageSize]);

  const hidePalette = useCallback(() => {
    palette.hide();
    setShowing(false);
  }, []);

  const addPitch = useCallback(() => {
    // Note operations wait until the panel has closed; see pageOps.ts.
    close();
    getContext()
      .then(addPitchPage)
      .then(page => toast(`Pitch added as page ${page + 1}.`))
      .catch(e => toast(`Soccer Board: ${(e as Error).message}`));
  }, []);

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

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lead}>Pen draws, finger moves.</Text>
          <Text style={styles.para}>
            Draw runs and passes with your pen as usual. Drag players, cones and
            balls off the floating palette with your finger. They land on the
            page as real note shapes, so copying the page keeps everything.
          </Text>

          <Section title="Floating palette">
            {!palette.available ? (
              <Text style={styles.para}>
                The floating palette isn't in this build of the plugin. Build it
                with npm run build:plugin, which includes the palette's native
                code.
              </Text>
            ) : permission === false ? (
              <>
                <Text style={styles.para}>
                  The palette floats over the note, which needs Android's
                  "Display over other apps" permission for the Supernote plugin
                  host. Allow it on the next screen, then come back here.
                </Text>
                <View style={styles.row}>
                  <Button
                    label="Allow the palette"
                    primary
                    onPress={() => palette.requestOverlayPermission()}
                  />
                  <Button label="I've allowed it" onPress={refreshPalette} />
                </View>
              </>
            ) : (
              <View style={styles.row}>
                <Button
                  label={showing ? 'Back to the note' : 'Show the palette'}
                  primary
                  disabled={permission === null}
                  onPress={showPalette}
                />
                {showing && (
                  <Button label="Hide the palette" onPress={hidePalette} />
                )}
              </View>
            )}
          </Section>

          <Section title="Pitch pages">
            <Text style={styles.para}>
              {pitch === 'ready'
                ? 'Add a page with a blank pitch after this one. The Pitch button on the palette does the same.'
                : pitch === 'failed'
                ? "The pitch background couldn't be prepared. Close and reopen Soccer Board to try again."
                : 'Preparing the pitch background…'}
            </Text>
            <View style={styles.row}>
              <Button
                label="Add a pitch page"
                primary
                disabled={pitch !== 'ready'}
                onPress={addPitch}
              />
            </View>
          </Section>

          <Section title="Pieces">
            <View style={styles.legend}>
              {LEGEND.map(item => (
                <View key={item.kind} style={styles.legendItem}>
                  <PieceGlyph kind={item.kind} size={40} />
                  <Text style={styles.legendText}>{item.label}</Text>
                </View>
              ))}
            </View>
          </Section>

          <Section title="On the palette">
            {CONTROLS.map(([name, text]) => (
              <View key={name} style={styles.control}>
                <Text style={styles.controlName}>{name}</Text>
                <Text style={[styles.para, styles.controlText]}>{text}</Text>
              </View>
            ))}
            <Text style={[styles.para, styles.note]}>
              Use your finger on the palette. A pen touch works too, but the pen
              also writes on the page underneath.
            </Text>
          </Section>

          {notice && <Text style={styles.notice}>{notice}</Text>}
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
  lead: {fontSize: 30, fontWeight: 'bold', color: INK},
  para: {fontSize: 18, lineHeight: 27, color: INK},
  note: {color: DIM, marginTop: 6},

  section: {gap: 12, borderTopWidth: 2, borderTopColor: INK, paddingTop: 16},
  sectionTitle: {fontSize: 20, fontWeight: 'bold', color: INK},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},

  legend: {flexDirection: 'row', flexWrap: 'wrap', gap: 24},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: 10},
  legendText: {fontSize: 18, color: INK},

  control: {flexDirection: 'row', gap: 16, alignItems: 'flex-start'},
  controlName: {
    width: 64,
    fontSize: 18,
    fontWeight: 'bold',
    color: INK,
    lineHeight: 27,
  },
  controlText: {flex: 1},

  notice: {fontSize: 18, color: INK, fontWeight: 'bold'},

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
