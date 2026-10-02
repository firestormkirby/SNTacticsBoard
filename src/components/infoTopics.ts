/**
 * The copy behind the menu's ⓘ icons, as in Modulanner's panel.
 *
 * Kept out of App.tsx so the prose can be proofread in one place. The rule
 * for what stays in the menu and what moves here: the menu says what a
 * control does and its state right now; the bubble says what it's for, how
 * it behaves, and when you'd want it.
 */

export interface InfoTopic {
  title: string;
  /** Paragraphs separated by a blank line; shown as they are. */
  body: string;
}

export type InfoKey =
  | 'floatingButton'
  | 'penLock'
  | 'fileAccess'
  | 'savePage'
  | 'pageLabel'
  | 'savedLayouts'
  | 'storage';

/**
 * A Record, not a partial map, so a new key without its copy is a compile
 * error rather than a bubble that opens blank on the device.
 */
export const INFO_TOPICS: Record<InfoKey, InfoTopic> = {
  floatingButton: {
    title: 'Floating button',
    body:
      'Adds a small floating movable button to the screen. Move it where you ' +
      'want, and long press the button to open this menu. (works with both ' +
      'finger and pen)\n\n' +
      'Tapping the button opens the piece and quick save floating menu. ' +
      'Drag pieces to the page, drag pieces on the page to move them, or ' +
      'drag them to the trash to remove them.\n' +
      'Pieces get placed on their own layer so you can quickly erase your ' +
      'own drawings without affecting the pieces.\n\n' +
      'A non-saved page will be labelled as "Scratchpad"\n' +
      'Save: saves a named page to be used later\n' +
      'Load: lists your named pages. A new page is created with the named ' +
      'page\n' +
      'Copy: copies the entire current page to a new page, but does not ' +
      'save it.\n' +
      'Reset: tap twice to reset the page back to the last saved version\n' +
      'Trash: drag pieces onto it to remove them, or tap it twice to clear ' +
      'the page back to a blank Scratchpad\n\n' +
      'Load and Reset will store up to 5 previous versions in case of ' +
      'accidental overwrite',
  },

  penLock: {
    title: '(Attempt to) Disable pen strokes while dragging',
    body:
      'This setting will try to restrict the pen from writing while ' +
      'dragging a piece. If a line is drawn it will be deleted after. The ' +
      'extra delete takes a moment and can cause artifacting, refresh the ' +
      'screen to fix.\n\n' +
      'When off, strokes will always appear. New pieces dragged from the ' +
      'menu have their strokes deleted, but pieces already on the page will ' +
      'move with a stroke left behind them.',
  },

  fileAccess: {
    title: 'File access',
    body:
      'Page copies and saved layouts are kept in the EXPORT folder, so ' +
      'Tactics Board needs permission to read and write files.\n\n' +
      'Choose "Always allow": "This time only" lapses when the menu closes, ' +
      'which is when copying and saving happen.\n\n' +
      'Placing and moving pieces works without the permissions.',
  },

  savePage: {
    title: 'Save this page',
    body:
      'Saves the whole page (template, drawings, and pieces) under a name. ' +
      '(e.g., a drill you will run again, or a base to start from.)\n\n' +
      'Saving under a name you have used replaces that board; the one it ' +
      'replaces is kept as a previous version (the ▾ beside it under Saved ' +
      'layouts).\n\n' +
      'The menu closes while it saves, and a message says when it is done. ' +
      'Saved pages live in EXPORT/SNTacticsBoard/Layouts.note, which you ' +
      'can open in the Note app.',
  },

  pageLabel: {
    title: 'Label new pages',
    body:
      'Places a textbox label with the name of the page on the Pieces ' +
      'layer across the top of the page.\n\n' +
      'This will label the current page and all future pages while it is ' +
      'on. To label an older page, open and then close this menu on that ' +
      'page.',
  },

  savedLayouts: {
    title: 'Saved layouts',
    body:
      'New page adds a copy of the saved page.\n\n' +
      'Saved pages populate Layouts.note. Deleting a page from that file ' +
      'removes it from here.\n\n' +
      'Previous versions: the ▾ at the right of a layout lists up to 5 ' +
      'earlier versions of the saved page. These are created when pages are ' +
      'reset, or saved/loaded over.',
  },

  storage: {
    title: 'Storage',
    body:
      'Tactics Board keeps its files in EXPORT/SNTacticsBoard/. The ' +
      'Layouts.note contains saved pages, and there are helper PNGs it ' +
      'makes pages from.\n\n' +
      'If you want the plugin to automatically cleanup old PNGs and layout ' +
      'pages, turn this on and enable the permission to delete files. The ' +
      'plugin is designed to only target ~OLD Layouts.note pages and the ' +
      'helper PNGs. Use at your own risk, especially if trying to save/load ' +
      'things quickly.\n\n' +
      'You can also tidy up yourself, in Files under ' +
      'EXPORT/SNTacticsBoard/.\n' +
      'All PNGs can be deleted. And pages tagged with the keywords ~OLD in ' +
      'Layouts.note can be safely deleted.',
  },
};
