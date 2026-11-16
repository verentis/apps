import { randomUUID } from 'node:crypto'
import config from './config.mjs'

const allowed = new Set(['operation', 'creatable', 'mime', 'parentPath', 'branch', 'name', 'now', 'template', 'siblings', 'attempt'])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function fill(template, values) {
  return template.replace(/\{\{\s*(id|now|name)\s*\}\}/g, (_, key) => JSON.stringify(String(values[key] ?? '')).slice(1, -1))
}

/** The next code after the highest existing `<prefix><digits>` sibling, e.g. `CUST-0042`. */
export function nextCode(prefix, digits, siblings) {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`)
  let highest = 0
  for (const name of siblings) {
    const match = typeof name === 'string' && name.match(pattern)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `${prefix}${String(highest + 1).padStart(digits, '0')}`
}

function setting(settings, key, fallback) {
  const value = settings?.get?.(key)
  return value === undefined || value === null || value === '' ? fallback : value
}

function digitsSetting(settings) {
  const value = Number.parseInt(String(setting(settings, config.codeDigits.key, config.codeDigits.default)), 10)
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 12) : config.codeDigits.default
}

const pad = value => String(value).padStart(2, '0')

/** A sortable UTC stamp, `20260102-093005`, used to name communications and notes. */
export function stamp(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) throw new Error('A valid creation time is required')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
}

/**
 * Proposes `{ name, content }` for a new CRM node beneath `parentPath`:
 * - records (customer, contact, deal, case) are named by the next code from the app settings;
 * - communications and notes go into the record's `activities/` or `notes/` folder, named by UTC time, and
 *   reference the record they are about.
 */
export function propose(input, settings, uuid = randomUUID) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Object.keys(input).some(key => !allowed.has(key))) throw new Error('Invalid create parameters')
  if (input.operation !== 'create') throw new Error('Unsupported operation')
  const kind = input.creatable
  if (typeof kind !== 'string' || !Object.hasOwn(config.kinds, kind)) throw new Error(`Unknown CRM record type: ${kind}`)
  if (typeof input.parentPath !== 'string' || !input.parentPath.startsWith('/')) throw new Error('A parent path is required')
  if (typeof input.template !== 'string' || !input.template) throw new Error('The record template is missing')
  const now = typeof input.now === 'string' && !Number.isNaN(Date.parse(input.now)) ? new Date(input.now).toISOString() : new Date().toISOString()
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const siblings = Array.isArray(input.siblings) ? input.siblings : []
  const attempt = Number.isInteger(input.attempt) && input.attempt > 0 ? input.attempt : 1

  const record = JSON.parse(fill(input.template, { id: uuid(), now, name }))
  if (record.kind !== kind) throw new Error(`The template does not describe a ${kind}`)
  const definition = config.kinds[kind]

  if (definition.code) {
    const prefix = String(setting(settings, definition.code.key, definition.code.default))
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(prefix)) throw new Error(`The ${definition.code.key} setting is not a valid code prefix`)
    const code = nextCode(prefix, digitsSetting(settings), siblings)
    record.code = code
    return { name: code, content: record }
  }

  const parent = input.parentPath.replace(/\/+$/, '') || '/'
  const parentName = parent.slice(parent.lastIndexOf('/') + 1)
  const inFolder = parentName === definition.folder
  const recordPath = inFolder ? parent.slice(0, parent.lastIndexOf('/')) || '/' : parent
  if (recordPath !== '/') record.regarding = { path: recordPath }
  const suffix = attempt > 1 ? `-${uuid().slice(0, 4)}` : ''
  const file = `${stamp(now)}-${kind}${suffix}.json`
  return { name: inFolder ? file : `${definition.folder}/${file}`, content: record }
}
