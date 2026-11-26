// What Timesheets adds to its generated pages: the week grid (project × day) where hours are typed straight into
// the cells, and hours per project.
import { button, chart, row, section, signedIn } from '../../../tools/file-apps/canvas.mjs'
import { containers, installRoot, mimeTypes, settingsPath, templates } from './contracts.mjs'
import { postScriptPath } from './app.mjs'

const live = "e.kind === 'file' && e.data && e.data.state !== 'archived'"
const days = "Array.from({ length: 7 }, (_, i) => Date(Date.now() - (6 - i) * 86400000).slice(0, 10))"
// Whose week: the person picked above the grid, else who is signed in (their Employees name, found by work email,
// else their sign-in name), else the settings' default employee.
const person = "(state.employee || (data.me && data.me.name) || (data.settings && data.settings.employee) || '')"
// That person's Employees record (signed-in user's own, else the record with that name); empty when there is none.
const personRef = `(data.me && data.me.path && data.me.name === ${person} ? data.me.path : ((data.signedinstaff || []).filter(e => e.kind === 'file' && e.data && e.data.status !== 'terminated' && String(e.data.name || '') === ${person}).map(e => e.path)[0] || ''))`
const week = `(data.entries || []).filter(e => ${live} && ${days}.includes(e.data.date) && (!${person} || e.data.employee === ${person}))`
const people = `(data.entries || []).filter(e => ${live} && !!e.data.employee).map(e => e.data.employee).filter((name, index, names) => names.indexOf(name) === index).sort()`
// One entry per project and day can be typed into; a day with two entries for a project is changed on the entries.
const cells = `${week}.map(e => ({ path: e.path, project: e.data.project || '', date: e.data.date, hours: Number(e.data.hours || 0), status: e.data.status, shared: ${week}.filter(o => (o.data.project || '') === (e.data.project || '') && o.data.date === e.data.date).length > 1 }))`
// Draft entries of the week with hours, which Validate week validates.
const drafts = `${week}.filter(e => (e.data.status || 'draft') === 'draft' && Number(e.data.hours || 0) > 0)`
const projects = `(data.projects || []).filter(e => ${live} && e.data.status !== 'done').map(e => ({ value: e.path, label: e.data.name || e.data.code }))`
const hours = '{{ event.value.toFixed(2) }}'

export const views = {
  'home.page.yaml': { label: 'Entries' },
  'week.page.yaml': {
    label: 'Week', icon: 'calendar-days',
    writes: [containers.entries.path],
    state: { employee: '' },
    data: { settings: { kind: 'file', path: settingsPath, parse: 'json' }, ...signedIn.data },
    access: [{ path: settingsPath, mode: 'read', reason: 'Show the default employee\'s week when nobody is signed in' }, ...signedIn.access],
    top: [section('Week', [row([{
      type: 'canvas.form.select',
      props: { label: 'Employee', value: `{{ ${person} }}`, options: `{{ ${people}.concat(${person} && !${people}.includes(${person}) ? [${person}] : []).map(name => ({ value: name, label: name })) }}` },
      on: { update: [{ 'set-state': { key: 'employee', value: '{{ event.value }}' } }] },
    }, button(`Validate week ({{ ${drafts}.length }})`, [
      { confirm: { title: 'Validate this week', message: `Validate {{ ${drafts}.length }} draft entries of the last seven days? Each one's hours are checked and it is locked.` } },
      // One validation per draft entry, as the entry form's Validate does; a refused entry stops the rest.
      { 'for-each': { items: `{{ ${drafts}.map(e => e.path) }}`, as: 'entry', steps: [
        { 'run-script': { file: postScriptPath, timeout: 120, parameters: { operation: 'validate-entry', path: '{{ entry }}' } } },
      ] } },
      { 'refresh-source': { source: 'entries' } },
      { toast: { message: 'Week validated', variant: 'success' } },
    ], { disabled: `${drafts}.length === 0` }, undefined, 'check-check')], 'end'), {
      type: 'canvas.matrix',
      props: {
        rows: `{{ ${cells} }}`, rowKey: 'project', columnKey: 'date', value: 'hours', rowHeading: 'Project',
        rowOptions: `{{ ${projects} }}`, columns: `{{ ${days}.map(d => ({ value: d, label: format(d, 'date') })) }}`,
        editable: true, lockedWhen: "row.status === 'validated' || row.shared", rowMax: 0, format: 'number', decimals: 2,
        emptyText: 'Add a project to log time against it.',
      },
      on: {
        change: [
          // A day that already has the entry: change its hours.
          { 'patch-record': { if: 'event.records.length === 1', path: '{{ event.records[0].path }}', values: { hours, updatedAt: '{{ Date() }}' } } },
          // An empty day: the create script makes the entry with the next code, then the day, project and hours are set.
          { 'run-script': {
            if: 'event.records.length === 0', file: `${installRoot}/scripts/create`, timeout: 60, assign: 'created',
            parameters: {
              operation: 'create', creatable: 'entry', parentPath: containers.entries.path, mime: mimeTypes.entry,
              // The template's own `{{ id }}` placeholders belong to the create script, so it travels as a string literal.
              template: { $expr: `'${JSON.stringify(templates.entry).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` }, siblings: "{{ (data.entries || []).map(e => e.name) }}",
            },
          } },
          { 'patch-record': { if: 'event.records.length === 0', path: '{{ state.created.path }}', values: { date: '{{ event.column }}', project: '{{ event.row }}', employee: `{{ ${person} }}`, employeeRef: `{{ ${personRef} }}`, hours, updatedAt: '{{ Date() }}' } } },
          { 'refresh-source': { source: 'entries' } },
        ],
      },
    }], 'Type hours into a day. Validated days are locked; a day with two entries for one project is changed on the entries themselves.')],
    bottom: [section('Hours per project', [chart("{{ (data.weekly || []).map(w => ({ label: w.project, validated: Number(w.validated) || 0, draft: Number(w.draft) || 0 })) }}",
      { kind: 'stacked-hbar', x: 'label', y: ['validated', 'draft'], labels: { validated: 'Validated', draft: 'Draft' }, palette: { validated: 'success', draft: 'warning' }, format: 'number', decimals: 2 })])],
  },
}
