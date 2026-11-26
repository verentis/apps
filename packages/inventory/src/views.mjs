// What Inventory adds to its generated pages: stock against reorder points, and a reorder drafted in Purchase.
import { appOperationsSource, attemptKey, button, chart, offers, row, section, text } from '../../../tools/file-apps/canvas.mjs'

// Products at or below their reorder point (`data.totals` units are integer ten-thousandths).
const low = "(data.totals || []).filter(t => t.hasReorder && t.units <= t.reorder)"
// Each reorders up to twice its reorder point; the buyer adjusts the draft in Purchase.
const lines = `${low}.map(t => ({ description: [t.product || t.code, t.sku ? '(' + t.sku + ')' : ''].filter(part => part).join(' '), quantity: String(Math.max(1, Math.ceil((2 * t.reorder - t.units) / 10000))) }))`
const canOrder = offers('purchase', 'create-draft-order')
const canUpdate = offers('products', 'update-product')
const amount = '/^((0|[1-9][0-9]{0,14})(\\.[0-9]{1,4})?)?$/'

export const views = {
  'stock.page.yaml': {
    label: 'Stock', icon: 'boxes', count: `{{ ${low}.length }}`, tone: 'warning',
    data: { ...appOperationsSource },
    state: { reorderproduct: '', reorderpoint: '' },
    top: [row([
      button(`Draft purchase order ({{ ${low}.length }})`, [
        { confirm: { title: 'Draft a purchase order', message: `Ask Purchase to draft an order for the {{ ${low}.length }} products at or below their reorder point? Each is ordered up to twice its reorder point; choose the vendor and prices on the draft.` } },
        // Purchase drafts it through its own API; the same day's reorder returns the same draft.
        { 'call-app': { app: 'purchase', operation: 'create-draft-order', 'idempotency-key': attemptKey("'reorder-' + Date().slice(0, 10)"), assign: 'order',
          input: { $expr: `({ source: { path: '/products#reorder-' + Date().slice(0, 10), code: 'Reorder ' + Date().slice(0, 10) }, lines: ${lines}, notes: 'Drafted from Inventory products at or below their reorder point.' })` } } },
        { 'open-file': { path: '{{ state.order.path }}' } },
        { toast: { message: "{{ state.order.created ? 'Drafted purchase order ' + state.order.code : 'Opened today\\'s reorder ' + state.order.code }}", variant: 'success' } },
      ], { visible: `${canOrder} && ${low}.length > 0` }, undefined, 'shopping-cart'),
      { ...text('Install Purchase to draft purchase orders for products below their reorder point.', 'muted'), rules: { visible: `!(${canOrder}) && ${low}.length > 0` } },
    ], 'end')],
    bottom: [section('Reorder point', [
      text('Products keeps each product\'s reorder point; Inventory changes it through Products.', 'muted'),
      row([
        { type: 'canvas.form.select', props: { label: 'Product', value: '{{ state.reorderproduct }}',
          options: "{{ (data.totals || []).map(t => ({ label: t.code + ' · ' + t.product, value: t.path })) }}" } },
        { type: 'canvas.form.input', props: { label: 'Reorder point', placeholder: '0', value: '{{ state.reorderpoint }}' } },
        button('Set reorder point', [
          { 'call-app': { app: 'products', operation: 'update-product', assign: 'updated',
            'idempotency-key': attemptKey("'reorder-point-' + state.reorderproduct"),
            input: { $expr: "({ path: state.reorderproduct, values: { reorderPoint: state.reorderpoint.trim() } })" } } },
          { 'refresh-source': { source: 'products' } },
          { toast: { message: "{{ state.updated.changed.length ? 'Set the reorder point of ' + state.updated.code : state.updated.code + ' already has that reorder point' }}", variant: 'success' } },
        ], { disabled: `!state.reorderproduct || !${amount}.test(state.reorderpoint.trim()) || !(${canUpdate})` }, undefined, 'save'),
      ], 'end'),
    ]), section('Below reorder point', [chart(`{{ ${low}.map(t => ({ path: t.path, label: t.product || t.code, onhand: (t.units || 0) / 10000, short: Math.max(0, (t.reorder - (t.units || 0)) / 10000) })) }}`,
      { kind: 'stacked-hbar', x: 'label', y: ['onhand', 'short'], labels: { onhand: 'On hand', short: 'Short of reorder point' }, palette: { onhand: 'chart-1', short: 'danger' }, format: 'number', emptyText: 'Every product is above its reorder point' })])],
  },
}
