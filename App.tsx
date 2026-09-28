/**
 * Soccer Board: a coach's whiteboard for Supernote.
 *
 * Drag X and O players, cones and balls from the tray onto a portrait pitch.
 * The board saves itself after every move. "Export to Note" adds the drill to
 * the open note as a new page with the diagram as its background, ready to
 * draw runs and passes over with the pen.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Dimensions,
  LayoutChangeEvent,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import {
  BoardState,
  EMPTY_BOARD,
  dropPiece,
  pieceCentre,
  tapPiece,
} from './src/board/boardState';
import {
  BoardLayout,
  Point,
  TOOLBAR_HEIGHT,
  computeLayout,
} from './src/board/geometry';
import {PIECES} from './src/board/pieces';
import {loadBoard, saveBoard} from './src/board/storage';
import DraggablePiece from './src/components/DraggablePiece';
import ExportSheet from './src/components/ExportSheet';
import FieldMarkings from './src/components/FieldMarkings';
import {DIM, INK, NET, PAPER} from './src/components/palette';
import {capturePage, exportPngToNote} from './src/export/exportToNote';

interface Size {
  w: number;
  h: number;
}

const sizeOf = (e: LayoutChangeEvent): Size => ({
  w: e.nativeEvent.layout.width,
  h: e.nativeEvent.layout.height,
});

const sameSize = (a: Size | null, b: Size) => !!a && a.w === b.w && a.h === b.h;

/** Let the export sheet reach the screen before it is photographed. */
const nextFrames = () =>
  new Promise<void>(done =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(done, 80)),
    ),
  );

export default function App(): React.JSX.Element {
  const [rootSize, setRootSize] = useState<Size | null>(null);
  const [boardSize, setBoardSize] = useState<Size | null>(null);
  const [board, setBoard] = useState<BoardState | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const layout = useMemo(
    () => (boardSize ? computeLayout(boardSize.w, boardSize.h) : null),
    [boardSize],
  );

  // Drag callbacks outlive renders, so they read the latest values from refs.
  const boardRef = useRef<BoardState>(EMPTY_BOARD);
  const layoutRef = useRef<BoardLayout | null>(null);
  layoutRef.current = layout;

  const sheetRef = useRef<View>(null);
  const captureStarted = useRef(false);

  useEffect(() => {
    let alive = true;
    loadBoard().then(saved => {
      if (alive) {
        boardRef.current = saved;
        setBoard(saved);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const commit = useCallback((next: BoardState) => {
    boardRef.current = next;
    setBoard(next);
    saveBoard(next);
  }, []);

  const handleDrop = useCallback(
    (id: string, centre: Point, tapped: boolean): Point => {
      const current = layoutRef.current;
      if (!current) {
        return centre;
      }
      const {state, settleAt} = tapped
        ? tapPiece(boardRef.current, current, id)
        : dropPiece(boardRef.current, current, id, centre);
      if (state !== boardRef.current) {
        commit(state);
      }
      return settleAt;
    },
    [commit],
  );

  const clearBoard = useCallback(() => {
    setNotice(null);
    commit(EMPTY_BOARD);
  }, [commit]);

  const startExport = useCallback(() => {
    if (exporting) {
      return;
    }
    setNotice(null);
    captureStarted.current = false;
    setExporting(true);
  }, [exporting]);

  // The page is drawn at the screen's full size: the note page has the same
  // shape, so the capture maps onto it pixel for pixel.
  const sheetSize = useMemo(() => {
    const screen = Dimensions.get('screen');
    return {w: screen.width, h: screen.height};
  }, []);

  const onSheetLayout = useCallback(async () => {
    if (captureStarted.current || !sheetRef.current) {
      return;
    }
    captureStarted.current = true;
    try {
      await nextFrames();
      const png = await capturePage(sheetRef.current, sheetSize.w, sheetSize.h);
      setExporting(false);
      await exportPngToNote(png);
    } catch (e) {
      console.error('[snsoccer] capture failed', e);
      setExporting(false);
      setNotice('Could not capture the board. Please try again.');
    }
  }, [sheetSize]);

  const onRootLayout = (e: LayoutChangeEvent) => {
    const next = sizeOf(e);
    if (!sameSize(rootSize, next)) {
      setRootSize(next);
    }
  };
  const onBoardLayout = (e: LayoutChangeEvent) => {
    const next = sizeOf(e);
    if (!sameSize(boardSize, next)) {
      setBoardSize(next);
    }
  };

  const landscape = !!rootSize && rootSize.w > rootSize.h;

  return (
    <View style={styles.root} onLayout={onRootLayout}>
      <StatusBar barStyle="dark-content" backgroundColor={PAPER} />

      {/* Drawn underneath the board, so capturing it never flashes the screen. */}
      {exporting && board && layout && (
        <ExportSheet
          ref={sheetRef}
          width={sheetSize.w}
          height={sheetSize.h}
          board={board}
          glyphShare={layout.glyph / layout.field.w}
          onLayout={onSheetLayout}
        />
      )}

      <View style={styles.screen}>
        <Toolbar
          notice={exporting ? 'Exporting…' : notice}
          busy={exporting}
          disabled={landscape || !board}
          onClear={clearBoard}
          onExport={startExport}
          onClose={() => PluginManager.closePluginView()}
        />

        <View style={styles.board} onLayout={onBoardLayout}>
          {landscape ? (
            <PortraitOnly />
          ) : (
            layout &&
            board && <Board layout={layout} board={board} onDrop={handleDrop} />
          )}
        </View>
      </View>
    </View>
  );
}

// ── Board ───────────────────────────────────────────────────────────────────

function Board({
  layout,
  board,
  onDrop,
}: {
  layout: BoardLayout;
  board: BoardState;
  onDrop: (id: string, centre: Point, tapped: boolean) => Point;
}) {
  const {field, tray} = layout;
  // Tray pieces first, then placed pieces in stacking order, so the most
  // recently moved piece is drawn on top.
  const placedIds = new Set(board.placed.map(p => p.id));
  const order = [
    ...PIECES.filter(p => !placedIds.has(p.id)),
    ...board.placed.map(p => PIECES.find(d => d.id === p.id)!),
  ];
  const showHint = tray.y + tray.h - layout.trayFreeTop > 70;

  return (
    <>
      <View style={[styles.abs, {left: field.x, top: field.y}]}>
        <FieldMarkings width={field.w} height={field.h} />
      </View>

      <View
        style={[
          styles.abs,
          styles.tray,
          {left: tray.x, top: tray.y, width: tray.w, height: tray.h},
        ]}
      />
      {layout.trayHeaders.map(h => (
        <Text
          key={h.label}
          style={[
            styles.abs,
            styles.trayHeader,
            {left: tray.x + 10, top: h.y + 4},
          ]}>
          {h.label}
        </Text>
      ))}
      {showHint && (
        <Text
          style={[
            styles.abs,
            styles.hint,
            {
              left: tray.x + 10,
              width: tray.w - 20,
              top: layout.trayFreeTop + 8,
            },
          ]}>
          Drag pieces onto the pitch. Tap one, or drag it back here, to take it
          off.
        </Text>
      )}

      {order.map(p => (
        <DraggablePiece
          key={p.id}
          id={p.id}
          kind={p.kind}
          centre={pieceCentre(board, layout, p.id)}
          hit={layout.hit}
          glyph={layout.glyph}
          onDrop={onDrop}
        />
      ))}
    </>
  );
}

function PortraitOnly() {
  return (
    <View style={styles.portraitOnly}>
      <Text style={styles.portraitTitle}>Portrait only</Text>
      <Text style={styles.portraitBody}>
        The board works like a clipboard, with a goal at the top and the bottom.
        Turn your Supernote upright to keep planning. Your drill is saved.
      </Text>
    </View>
  );
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

function Toolbar({
  notice,
  busy,
  disabled,
  onClear,
  onExport,
  onClose,
}: {
  notice: string | null;
  busy: boolean;
  disabled: boolean;
  onClear: () => void;
  onExport: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.toolbar}>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>Soccer Board</Text>
        {notice ? (
          <Text style={styles.notice} numberOfLines={1}>
            {notice}
          </Text>
        ) : null}
      </View>
      <ToolButton
        label="Clear Board"
        onPress={onClear}
        disabled={disabled || busy}
      />
      <ToolButton
        label="Export to Note"
        onPress={onExport}
        disabled={disabled || busy}
        primary
      />
      <ToolButton
        label="✕"
        onPress={onClose}
        accessibilityLabel="Close"
        square
      />
    </View>
  );
}

function ToolButton({
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
  abs: {position: 'absolute'},

  toolbar: {
    height: TOOLBAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
    borderBottomWidth: 3,
    borderBottomColor: INK,
    backgroundColor: PAPER,
  },
  titleBlock: {flex: 1, minWidth: 0},
  title: {fontSize: 26, fontWeight: 'bold', color: INK},
  notice: {fontSize: 16, color: DIM, marginTop: 2},

  button: {
    height: 52,
    paddingHorizontal: 18,
    borderWidth: 3,
    borderColor: INK,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAPER,
  },
  buttonSquare: {width: 52, paddingHorizontal: 0},
  buttonDark: {backgroundColor: INK},
  buttonDisabled: {borderColor: NET, backgroundColor: PAPER},
  buttonText: {fontSize: 19, fontWeight: 'bold', color: INK},
  buttonTextSquare: {fontSize: 24},
  buttonTextDark: {color: PAPER},
  buttonTextDisabled: {color: NET},

  board: {flex: 1},
  tray: {
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 8,
    backgroundColor: PAPER,
  },
  trayHeader: {fontSize: 16, fontWeight: 'bold', color: INK},
  hint: {fontSize: 15, lineHeight: 21, color: DIM},

  portraitOnly: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  portraitTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: INK,
    marginBottom: 12,
  },
  portraitBody: {
    fontSize: 19,
    lineHeight: 27,
    color: INK,
    textAlign: 'center',
    maxWidth: 560,
  },
});
