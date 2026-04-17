/**
 * LexicalTablePlugin.web.tsx
 *
 * Adds table / invisible-grid support to the Lexical long-post editor.
 *
 * What this file provides:
 *   - <LexicalTablePlugin>  — registers table commands + keyboard shortcuts
 *   - INSERT_TABLE_COMMAND  — re-exported from @lexical/table so the toolbar
 *                             only needs one import location
 *   - Table CSS injected inline (visible-grid / invisible-grid toggle)
 */

import React from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createTableNodeWithDimensions,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  INSERT_TABLE_COMMAND,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
  registerTablePlugin,
  registerTableSelectionObserver,
} from '@lexical/table';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  KEY_TAB_COMMAND,
  createCommand,
} from 'lexical';
import { $findMatchingParent } from '@lexical/utils';

// ─── Extra commands exposed to the toolbar ────────────────────────────────────

export const INSERT_TABLE_ROW_BELOW_COMMAND = createCommand('INSERT_TABLE_ROW_BELOW');
export const INSERT_TABLE_ROW_ABOVE_COMMAND = createCommand('INSERT_TABLE_ROW_ABOVE');
export const INSERT_TABLE_COL_AFTER_COMMAND  = createCommand('INSERT_TABLE_COL_AFTER');
export const INSERT_TABLE_COL_BEFORE_COMMAND = createCommand('INSERT_TABLE_COL_BEFORE');
export const DELETE_TABLE_ROW_COMMAND        = createCommand('DELETE_TABLE_ROW');
export const DELETE_TABLE_COL_COMMAND        = createCommand('DELETE_TABLE_COL');
export const TOGGLE_TABLE_BORDERS_COMMAND    = createCommand('TOGGLE_TABLE_BORDERS');

export { INSERT_TABLE_COMMAND };

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function LexicalTablePlugin() {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    // Register core table machinery from @lexical/table
    const unregisterPlugin    = registerTablePlugin(editor);
    const unregisterSelection = registerTableSelectionObserver(editor);

    // ── INSERT TABLE ────────────────────────────────────────────────────────
    const unregisterInsert = editor.registerCommand(
      INSERT_TABLE_COMMAND,
      (payload: { rows: number; columns: number; includeHeaders?: boolean }) => {
        editor.update(() => {
          const { rows = 3, columns = 3, includeHeaders = true } = payload as any;
          const tableNode = $createTableNodeWithDimensions(rows, columns, includeHeaders);
          // Mark the table as "invisible" by default so it behaves like an
          // invisible grid until the author explicitly enables borders.
          (tableNode as any).__borderless = true;
          tableNode.getWritable();
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertNodes([tableNode]);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    // ── ROW / COL helpers ───────────────────────────────────────────────────
    const unregRowBelow = editor.registerCommand(INSERT_TABLE_ROW_BELOW_COMMAND, () => {
      editor.update(() => { $insertTableRowAtSelection(false); });
      return true;
    }, COMMAND_PRIORITY_EDITOR);

    const unregRowAbove = editor.registerCommand(INSERT_TABLE_ROW_ABOVE_COMMAND, () => {
      editor.update(() => { $insertTableRowAtSelection(true); });
      return true;
    }, COMMAND_PRIORITY_EDITOR);

    const unregColAfter = editor.registerCommand(INSERT_TABLE_COL_AFTER_COMMAND, () => {
      editor.update(() => { $insertTableColumnAtSelection(false); });
      return true;
    }, COMMAND_PRIORITY_EDITOR);

    const unregColBefore = editor.registerCommand(INSERT_TABLE_COL_BEFORE_COMMAND, () => {
      editor.update(() => { $insertTableColumnAtSelection(true); });
      return true;
    }, COMMAND_PRIORITY_EDITOR);

    const unregDelRow = editor.registerCommand(DELETE_TABLE_ROW_COMMAND, () => {
      editor.update(() => { $deleteTableRowAtSelection(); });
      return true;
    }, COMMAND_PRIORITY_EDITOR);

    const unregDelCol = editor.registerCommand(DELETE_TABLE_COL_COMMAND, () => {
      editor.update(() => { $deleteTableColumnAtSelection(); });
      return true;
    }, COMMAND_PRIORITY_EDITOR);

    // ── TOGGLE BORDERS ──────────────────────────────────────────────────────
    // Adds / removes the "oslx-table-bordered" class on the nearest TableNode
    // so the author can switch between visible and invisible grid modes.
    const unregBorders = editor.registerCommand(TOGGLE_TABLE_BORDERS_COMMAND, () => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const cell = $findMatchingParent(
          selection.anchor.getNode(),
          (n) => $isTableCellNode(n),
        );
        if (!cell) return;
        const table = $findMatchingParent(cell, (n) => $isTableNode(n));
        if (!table) return;
        const t = table as TableNode;
        const existing = (t as any).__borderless !== false;
        (t.getWritable() as any).__borderless = !existing;
      });
      return true;
    }, COMMAND_PRIORITY_EDITOR);

    // ── TAB navigation ──────────────────────────────────────────────────────
    // Tab in the last cell of a row moves to the first cell of the next row;
    // Tab in the last cell of the table appends a new row.
    const unregTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        const cell = $findMatchingParent(
          selection.anchor.getNode(),
          (n) => $isTableCellNode(n),
        );
        if (!cell) return false;
        event.preventDefault();
        if (event.shiftKey) {
          editor.update(() => {
            const prev = (cell as TableCellNode).getPreviousSibling();
            if (prev && $isTableCellNode(prev)) {
              (prev as any).selectEnd?.();
            } else {
              const row = (cell as TableCellNode).getParent();
              if (!$isTableRowNode(row)) return;
              const prevRow = (row as TableRowNode).getPreviousSibling();
              if ($isTableRowNode(prevRow)) {
                const lastCell = (prevRow as TableRowNode).getLastChild();
                if (lastCell) (lastCell as any).selectEnd?.();
              }
            }
          });
        } else {
          editor.update(() => {
            const next = (cell as TableCellNode).getNextSibling();
            if (next && $isTableCellNode(next)) {
              (next as any).selectStart?.();
            } else {
              const row = (cell as TableCellNode).getParent();
              if (!$isTableRowNode(row)) return;
              const nextRow = (row as TableRowNode).getNextSibling();
              if ($isTableRowNode(nextRow)) {
                const firstCell = (nextRow as TableRowNode).getFirstChild();
                if (firstCell) (firstCell as any).selectStart?.();
              } else {
                // Last cell of last row — append a new row
                $insertTableRowAtSelection(false);
              }
            }
          });
        }
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterPlugin?.();
      unregisterSelection?.();
      unregisterInsert();
      unregRowBelow();
      unregRowAbove();
      unregColAfter();
      unregColBefore();
      unregDelRow();
      unregDelCol();
      unregBorders();
      unregTab();
    };
  }, [editor]);

  return null;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
// Injected once; all table styles are scoped under .oslx-table-wrap.

export const TABLE_CSS = `
  /* ── wrapper so the table can scroll horizontally on narrow viewports ── */
  .oslx-table-wrap {
    overflow-x: auto;
    margin: 14px 0;
    border-radius: 8px;
  }

  .oslx-table {
    border-collapse: collapse;
    width: 100%;
    min-width: 320px;
    table-layout: fixed;
    font-size: 0.9rem;
  }

  /* ── subtle guide grid (default) ────────────────────────────────────────
     "Invisible grid" now keeps faint guides so authors can edit comfortably. */
  .oslx-table td,
  .oslx-table th {
    padding: 8px 10px;
    vertical-align: top;
    word-break: break-word;
    outline: none;
    border: 1px dashed rgba(148, 163, 184, 0.55);
    min-width: 60px;
    position: relative;
    background-clip: padding-box;
  }

  .oslx-table tr:hover td,
  .oslx-table tr:hover th {
    border-color: rgba(99, 102, 241, 0.38);
  }

  /* ── visible borders ──────────────────────────────────────────────────── */
  .oslx-table-bordered td,
  .oslx-table-bordered th {
    border: 1px solid #CBD5E1;
  }
  .oslx-table-bordered {
    border: 1px solid #CBD5E1;
    border-radius: 8px;
    overflow: hidden;
  }

  /* ── header cells ─────────────────────────────────────────────────────── */
  .oslx-table th {
    background: #F1F5F9;
    font-weight: 700;
    color: #0F172A;
  }

  /* ── hover / focus highlight (editor only) ────────────────────────────── */
  .oslx-table td:focus,
  .oslx-table th:focus {
    outline: 2px solid #6366F1;
    outline-offset: -2px;
    border-radius: 4px;
  }

  /* ── selected cells (Lexical multi-cell selection) ────────────────────── */
  .oslx-table td.selected,
  .oslx-table th.selected {
    background: #E0E7FF !important;
  }

  /* ── context menu (insert/delete row/col strip) ───────────────────────── */
  .oslx-table-cell-menu {
    position: absolute;
    top: 4px;
    right: 4px;
    display: none;
    z-index: 10;
  }
  .oslx-table td:hover .oslx-table-cell-menu,
  .oslx-table th:hover .oslx-table-cell-menu {
    display: block;
  }
`;

// ─── Helpers the toolbar can call to check cursor context ─────────────────────

export function isInsideTable(editor: any): boolean {
  let inside = false;
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const cell = $findMatchingParent(sel.anchor.getNode(), (n: any) => $isTableCellNode(n));
    inside = !!cell;
  });
  return inside;
}

export function isTableBordered(editor: any): boolean {
  let bordered = false;
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const cell = $findMatchingParent(sel.anchor.getNode(), (n: any) => $isTableCellNode(n));
    if (!cell) return;
    const table = $findMatchingParent(cell, (n: any) => $isTableNode(n));
    if (table) bordered = (table as any).__borderless === false;
  });
  return bordered;
}
