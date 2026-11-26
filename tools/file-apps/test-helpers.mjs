// Helpers for the generated-page tests of the file-based apps.

/**
 * The stages of a page, whether it still holds a tab per stage or the Board / List pair built from them. Each
 * entry is `{ slot, children: [table] }`, where the table's rows are that stage's rows, so tests read the same
 * way for both shapes.
 */
export function stagePanels(tabs) {
  const board = tabs.children.find(panel => panel.slot === 'board')?.children[0]
  const list = tabs.children.find(panel => panel.slot === 'list')?.children[0]
  if (board?.type !== 'canvas.board' || !list) return tabs.children
  const base = board.props.rows.slice(3, -3)
  return board.props.columns.map(column => ({
    slot: column.value,
    children: [{ ...list, props: { ...list.props, rows: `{{ ${base}.filter(r => r.${board.props.groupBy} === '${column.value}') }}` } }],
  }))
}
