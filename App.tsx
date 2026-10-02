/**
 * Tactics Board's menu: opened by holding the floating button, or from the
 * Note toolbar.
 *
 * The drawing happens on the note page itself, with the Supernote pen. Pieces
 * come from the floating button (android/.../palette): tap it for the
 * palette, drag a piece onto the page, drag pieces on the page to move them.
 *
 * This menu switches the button on, and saves this page under a name, to
 * add again later as a new page. Copying a page is the palette's.
 *
 * Anything that changes the note runs after the menu closes, because SDK
 * calls can deadlock while it is open (see src/palette/controller.ts).
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
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
import InfoIcon from './src/components/InfoIcon';
import {z, zb} from './src/components/scale';
import {INFO_TOPICS, InfoKey} from './src/components/infoTopics';
import PieceGlyph from './src/components/PieceGlyph';
import {
  SavedLayout,
  SavedVersion,
  deleteLayout,
  hasPage,
  listLayouts,
  listVersions,
} from './src/layouts/layoutStore';
import {formatBytes, storageUsed} from './src/page/cleanup';
import {NAME_MAX, shownTemplate} from './src/page/pageOps';
import {PieceKind} from './src/page/pieceShapes';
import {ensureDeleteAccess, ensureFileAccess} from './src/sdk/filePermissions';
import {palette} from './src/palette/bridge';
import {
  buttonProblem,
  cleanUpNow,
  closePanelThen,
  getPageName,
  isPenLocked,
  lastButtonError,
  loadLayoutAsPage,
  onMenuOpen,
  onPenLock,
  panelOpened,
  restoreVersion,
  saveThisPage,
  setAutoCleanup,
  setPageLabelOn,
  takeMenuFocus,
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
const timeOf = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Layout names match whatever their case, as saving does. */
const key = (name: string) => name.trim().toLowerCase();

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
  /** The ⓘ bubble showing, if one is. */
  const [info, setInfo] = useState<InfoKey | null>(null);
  /** The page showing's name: its board, or Scratchpad. */
  const [pageName, setPageNameShown] = useState(getPageName());
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [pageLabel, setPageLabel] = useState(true);
  /** EXPORT/SNTacticsBoard's size in bytes: null until known, or if unknowable. */
  const [storage, setStorage] = useState<number | null>(null);
  const [autoCleanup, setAutoCleanupShown] = useState(false);
  /** The Saved layouts list, open or folded away under its heading. */
  const [layoutsOpen, setLayoutsOpen] = useState(true);
  /** Delete permission was refused when a clean-up asked for it. */
  const [deleteRefused, setDeleteRefused] = useState(false);
  const nameInput = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  /** Where the Save section is in the scroll, to open the menu at it. */
  const saveYRef = useRef(0);

  // Why the button didn't come up last time, if it didn't.
  const [problem, setProblem] = useState<ButtonProblem | null>(null);

  const refresh = useCallback(async () => {
    setProblem(buttonProblem());
    setPermission(await palette.canDrawOverlays());
    const settings = await loadPaletteSettings();
    setButtonOn(settings.visible);
    setPenLock(settings.penLock);
    setPageLabel(settings.pageLabel);
    setAutoCleanupShown(settings.autoCleanup);
    setLayoutsOpen(settings.layoutsOpen);
    setDeleteRefused(false);
    setPageNameShown(getPageName());
    setLayouts(await listLayouts());
    setVersions(await listVersions());
    setStorage(await storageUsed().catch(() => null));
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
      setInfo(null);
      refresh();
      askForFiles();
      // Opened by the palette's Save on an unnamed page: straight to the name.
      if (takeMenuFocus() === 'save') {
        setTimeout(() => {
          scroll.current?.scrollTo({y: saveYRef.current, animated: false});
          nameInput.current?.focus();
        }, 50);
      }
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

  // Previous versions, under the saved layout of the same name. One list open
  // at a time, by name.
  const [openVersions, setOpenVersions] = useState<string | null>(null);
  const versionsOf = (layoutName: string) =>
    versions.filter(v => key(v.name) === key(layoutName));
  const toggleVersions = (layoutName: string) =>
    setOpenVersions(o => (o === key(layoutName) ? null : key(layoutName)));
  const orphans = [
    ...new Set(
      versions
        .filter(v => !layouts.some(l => key(l.name) === key(v.name)))
        .map(v => v.name),
    ),
  ];

  const togglePageLabel = useCallback(async (on: boolean) => {
    setPageLabel(on);
    await setPageLabelOn(on);
  }, []);

  /** Deleting files is only asked for here, when a clean-up is wanted. */
  const cleanNow = useCallback(async () => {
    if (!(await ensureDeleteAccess())) {
      setDeleteRefused(true);
      return;
    }
    closePanelThen(cleanUpNow);
  }, []);

  const toggleAutoCleanup = useCallback(async (on: boolean) => {
    if (on && !(await ensureDeleteAccess())) {
      setDeleteRefused(true);
      return;
    }
    setDeleteRefused(false);
    setAutoCleanupShown(on);
    await setAutoCleanup(on);
  }, []);

  const toggleLayouts = useCallback(() => {
    setLayoutsOpen(open => {
      updatePaletteSettings({layoutsOpen: !open});
      return !open;
    });
  }, []);

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
      await deleteLayout(id); // its previous versions go with it
      setConfirmDelete(null);
      setLayouts(await listLayouts());
      setVersions(await listVersions());
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
      <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Tactics Board</Text>
          <Button label="✕" onPress={close} square />
        </View>

        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          {/* The first section: no rule above it, the switch in its heading. */}
          <View style={styles.firstSection}>
            <View style={styles.setting}>
              <View style={[styles.titleRow, styles.grow]}>
                <Text style={styles.sectionTitle}>Floating button</Text>
                <InfoIcon onPress={() => setInfo('floatingButton')} />
              </View>
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
            <Setting
              label="(Attempt to) Disable pen strokes while dragging"
              info="penLock"
              onInfo={setInfo}
              value={penLock}
              onValueChange={togglePenLock}
            />
          </View>

          {files === false && (
            <Section title="File access" info="fileAccess" onInfo={setInfo}>
              <Text style={styles.para}>
                Needed to copy and save pages. Choose "Always allow".
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

          <View onLayout={e => (saveYRef.current = e.nativeEvent.layout.y)}>
            <Section
              title="Save this page"
              info="savePage"
              onInfo={setInfo}
              right={
                <Text style={styles.pageName} numberOfLines={1}>
                  This page: <Text style={styles.strong}>{pageName}</Text>
                </Text>
              }>
              <View style={styles.row}>
                <TextInput
                  ref={nameInput}
                  value={name}
                  maxLength={NAME_MAX}
                  onChangeText={setName}
                  placeholder="Name, e.g. Rondo 4v2"
                  placeholderTextColor={DIM}
                  style={styles.input}
                  returnKeyType="done"
                  onSubmitEditing={save}
                />
                <Button
                  label="Save"
                  primary
                  disabled={files !== true || !name.trim()}
                  onPress={save}
                />
              </View>
              <Setting
                label="Label new pages"
                info="pageLabel"
                onInfo={setInfo}
                value={pageLabel}
                onValueChange={togglePageLabel}
              />
            </Section>
          </View>

          <Section
            title="Saved layouts"
            info="savedLayouts"
            onInfo={setInfo}
            right={
              <VersionsToggle
                count={layouts.length + orphans.length}
                open={layoutsOpen}
                onPress={toggleLayouts}
              />
            }>
            {layouts.length === 0 && orphans.length === 0 && (
              <Text style={[styles.para, styles.dim]}>
                No saved layouts yet.
              </Text>
            )}
            {layoutsOpen &&
              layouts.map(l => (
                <View key={l.id} style={styles.layout}>
                  <View style={styles.layoutHead}>
                    <Text
                      style={[styles.layoutName, styles.grow]}
                      numberOfLines={1}>
                      {l.name}
                    </Text>
                    {hasPage(l) && (
                      <Button
                        label="New page"
                        small
                        primary
                        disabled={files !== true}
                        onPress={() =>
                          closePanelThen(() => loadLayoutAsPage(l))
                        }
                      />
                    )}
                    <Button
                      label={confirmDelete === l.id ? 'Delete?' : 'Delete'}
                      small
                      onPress={() => remove(l.id)}
                    />
                    <VersionsToggle
                      count={versionsOf(l.name).length}
                      open={openVersions === key(l.name)}
                      onPress={() => toggleVersions(l.name)}
                    />
                  </View>
                  <Text style={styles.layoutMeta}>
                    {describe(l)} · {dateOf(l.savedAt)}
                  </Text>
                  {openVersions === key(l.name) && (
                    <VersionList
                      versions={versionsOf(l.name)}
                      disabled={files !== true}
                    />
                  )}
                </View>
              ))}
            {/* Versions whose board isn't saved (the Scratchpad, or a
                deleted layout): their own row, versions only. */}
            {layoutsOpen &&
              orphans.map(orphan => (
                <View key={orphan} style={styles.layout}>
                  <View style={styles.layoutHead}>
                    <Text
                      style={[styles.layoutName, styles.grow]}
                      numberOfLines={1}>
                      {orphan}
                    </Text>
                    <VersionsToggle
                      count={versionsOf(orphan).length}
                      open={openVersions === key(orphan)}
                      onPress={() => toggleVersions(orphan)}
                    />
                  </View>
                  <Text style={styles.layoutMeta}>Earlier versions only</Text>
                  {openVersions === key(orphan) && (
                    <VersionList
                      versions={versionsOf(orphan)}
                      disabled={files !== true}
                    />
                  )}
                </View>
              ))}
          </Section>

          <Section
            title="Storage"
            info="storage"
            onInfo={setInfo}
            right={
              storage !== null && (
                <Text style={styles.pageName}>
                  EXPORT/SNTacticsBoard:{' '}
                  <Text style={styles.strong}>{formatBytes(storage)}</Text>
                </Text>
              )
            }>
            <Setting
              label="Clean up automatically"
              value={autoCleanup}
              onValueChange={toggleAutoCleanup}
            />
            <View style={styles.row}>
              <Button
                label="Clean up now"
                small
                disabled={files !== true}
                onPress={cleanNow}
              />
              <Text style={[styles.hint, styles.grow]}>
                {deleteRefused
                  ? 'Permissions were denied. You can manually delete them at EXPORT/SNTacticsBoard'
                  : autoCleanup
                  ? 'Cleans up after each Save, Load, or Reset.'
                  : 'Or manually clean them up at EXPORT/SNTacticsBoard'}
              </Text>
            </View>
          </Section>

          <Section title="Pieces">
            <View style={styles.legend}>
              {LEGEND.map(item => (
                <View key={item.kind} style={styles.legendItem}>
                  <PieceGlyph kind={item.kind} size={z(36)} />
                  <Text style={styles.legendText}>{item.label}</Text>
                </View>
              ))}
            </View>
          </Section>
        </ScrollView>

        {/* Over the card, not instead of it, so the menu keeps its scroll
            position underneath (Modulanner's reason too). */}
        {info && (
          <Pressable style={styles.infoOverlay} onPress={() => setInfo(null)}>
            <Pressable
              style={styles.infoCard}
              onPress={e => e.stopPropagation()}>
              <View style={styles.infoHeader}>
                <Text style={styles.sectionTitle}>
                  {INFO_TOPICS[info].title}
                </Text>
                <Button label="✕" onPress={() => setInfo(null)} square />
              </View>
              <ScrollView contentContainerStyle={styles.infoBody}>
                <Text style={styles.para}>{INFO_TOPICS[info].body}</Text>
              </ScrollView>
              <View style={styles.infoFooter}>
                <Button label="Done" primary onPress={() => setInfo(null)} />
              </View>
            </Pressable>
          </Pressable>
        )}
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
  const template = shownTemplate(l.template ?? '');
  const page = template ? `${template} template` : 'Template';
  const drawing = l.marks === 1 ? 'drawing' : 'drawings';
  if (l.pieces.length === 0) {
    return l.marks ? `${page} with ${drawing}` : page;
  }
  return l.marks
    ? `${page} with ${pieces} and ${drawing}`
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
        Error: native code missing
      </Text>
    );
  }
  if (permission === false) {
    return (
      <>
        <Text style={[styles.para, styles.strong]}>
          Error: Overlay permissions not working
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
  return null;
}

/**
 * A count and ▾ that opens a list, ▴ to close it: a layout's earlier
 * versions, or the Saved layouts list itself.
 */
function VersionsToggle({
  count,
  open,
  onPress,
}: {
  count: number;
  open: boolean;
  onPress: () => void;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <Button label={`${count} ${open ? '▴' : '▾'}`} small onPress={onPress} />
  );
}

/** A layout's earlier versions, newest first, each with Restore. */
function VersionList({
  versions,
  disabled,
}: {
  versions: SavedVersion[];
  disabled: boolean;
}) {
  return (
    <View style={styles.versions}>
      {versions.map(v => (
        <View key={v.keyword} style={styles.version}>
          <Text style={[styles.layoutMeta, styles.grow]}>
            {timeOf(v.savedAt)}
          </Text>
          <Button
            label="Restore"
            small
            disabled={disabled}
            onPress={() => closePanelThen(() => restoreVersion(v.keyword))}
          />
        </View>
      ))}
    </View>
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
  info,
  onInfo,
  right,
  children,
}: {
  title: string;
  info?: InfoKey;
  onInfo?: (topic: InfoKey) => void;
  /** Shown at the right end of the heading. */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {info && onInfo && <InfoIcon onPress={() => onInfo(info)} />}
        {right && <View style={styles.titleRight}>{right}</View>}
      </View>
      {children}
    </View>
  );
}

/** A switch with its label and ⓘ: one line, the explanation behind the icon. */
function Setting({
  label,
  info,
  onInfo,
  value,
  onValueChange,
}: {
  label: string;
  /** Left out when the section's ⓘ covers it. */
  info?: InfoKey;
  onInfo?: (key: InfoKey) => void;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.setting}>
      <View style={[styles.titleRow, styles.settingText]}>
        <Text style={styles.para}>{label}</Text>
        {info && onInfo && <InfoIcon onPress={() => onInfo(info)} />}
      </View>
      <Toggle
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  primary,
  square,
  small,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  square?: boolean;
  /** For rows of a list: shorter, lighter, smaller type. */
  small?: boolean;
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
          small && styles.buttonSmall,
          square && styles.buttonSquare,
          dark && styles.buttonDark,
          disabled && styles.buttonDisabled,
        ];
      }}>
      {({pressed}) => (
        <Text
          style={[
            styles.buttonText,
            small && styles.buttonTextSmall,
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
    borderWidth: zb(3), // a thick border stands in for a shadow on e-ink
    borderColor: INK,
    borderRadius: z(12),
    overflow: 'hidden',
  },

  header: {
    height: z(68),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: z(20),
    borderBottomWidth: zb(3),
    borderBottomColor: INK,
  },
  title: {fontSize: z(24), fontWeight: 'bold', color: INK},

  body: {
    paddingHorizontal: z(22),
    paddingVertical: z(16),
    gap: z(14),
  },
  grow: {flex: 1, minWidth: z(0)},
  para: {fontSize: z(18), lineHeight: z(27), color: INK},
  dim: {color: DIM},
  strong: {fontWeight: 'bold'},

  setting: {flexDirection: 'row', alignItems: 'center', gap: z(20)},
  settingText: {flex: 1},
  track: {
    width: z(68),
    height: z(38),
    borderRadius: z(19),
    borderWidth: zb(3),
    borderColor: INK,
    padding: z(3),
    justifyContent: 'center',
  },
  trackOn: {backgroundColor: INK},
  trackOff: {backgroundColor: PAPER},
  thumb: {width: z(26), height: z(26), borderRadius: z(13)},
  thumbOn: {alignSelf: 'flex-end', backgroundColor: PAPER},
  thumbOff: {alignSelf: 'flex-start', backgroundColor: INK},

  section: {
    gap: z(10),
    borderTopWidth: zb(2),
    borderTopColor: INK,
    paddingTop: z(12),
  },
  firstSection: {gap: z(10)},
  sectionTitle: {fontSize: z(20), fontWeight: 'bold', color: INK},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: z(10)},
  titleRight: {flex: 1, minWidth: z(0), alignItems: 'flex-end'},
  pageName: {fontSize: z(16), color: INK},

  // The ⓘ bubble: a bordered card on a dimmed menu, narrower than the menu
  // so it reads as on top of it.
  infoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    width: '86%',
    maxHeight: '86%',
    backgroundColor: PAPER,
    borderWidth: zb(3),
    borderColor: INK,
    borderRadius: z(12),
    overflow: 'hidden',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: z(12),
    paddingLeft: z(20),
    paddingRight: z(12),
    paddingVertical: z(10),
    borderBottomWidth: zb(2),
    borderBottomColor: INK,
  },
  infoBody: {paddingHorizontal: z(20), paddingVertical: z(16)},
  infoFooter: {padding: z(12), alignItems: 'stretch'},
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: z(12),
    alignItems: 'center',
  },

  input: {
    flex: 1,
    minWidth: z(220),
    height: z(56),
    borderWidth: zb(2),
    borderColor: INK,
    borderRadius: z(8),
    paddingHorizontal: z(14),
    fontSize: z(19),
    color: INK,
    backgroundColor: PAPER,
  },

  layout: {
    gap: z(2),
    paddingVertical: z(8),
    borderBottomWidth: zb(1),
    borderBottomColor: NET,
  },
  // Name, then the buttons, then the versions ▾ at the right end.
  layoutHead: {flexDirection: 'row', alignItems: 'center', gap: z(8)},
  versions: {marginTop: z(6), marginLeft: z(16), gap: z(4)},
  version: {flexDirection: 'row', alignItems: 'center', gap: z(12)},
  layoutName: {fontSize: z(19), fontWeight: 'bold', color: INK},
  layoutMeta: {fontSize: z(15), color: DIM, marginTop: z(2)},
  hint: {fontSize: z(15), lineHeight: z(21), color: DIM},

  legend: {flexDirection: 'row', flexWrap: 'wrap', gap: z(24)},
  legendItem: {flexDirection: 'row', alignItems: 'center', gap: z(10)},
  legendText: {fontSize: z(18), color: INK},

  button: {
    height: z(56),
    paddingHorizontal: z(22),
    borderWidth: zb(3),
    borderColor: INK,
    borderRadius: z(8),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAPER,
  },
  buttonSmall: {
    height: z(38),
    paddingHorizontal: z(12),
    borderWidth: zb(2),
    borderRadius: z(6),
  },
  buttonSquare: {width: z(52), height: z(52), paddingHorizontal: z(0)},
  buttonDark: {backgroundColor: INK},
  buttonDisabled: {borderColor: NET, backgroundColor: PAPER},
  buttonText: {fontSize: z(19), fontWeight: 'bold', color: INK},
  buttonTextSmall: {fontSize: z(15)},
  buttonTextSquare: {fontSize: z(24)},
  buttonTextDark: {color: PAPER},
  buttonTextDisabled: {color: NET},
});
