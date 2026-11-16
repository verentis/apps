// JSON Schema building blocks for file-based records: one JSON file per record, its vendor MIME naming its kind.
export const text = { type: 'string', maxLength: 1000 }
export const optional = (maxLength = 1000) => ({ type: 'string', maxLength })
export const uuid = { type: 'string', format: 'uuid' }
export const timestamp = { type: 'string', format: 'date-time', pattern: 'Z$' }
export const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
export const optionalDate = { type: 'string', pattern: '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' }
export const optionalEmail = { type: 'string', maxLength: 254, pattern: '^([^@\\s]+@[^@\\s]+)?$' }
export const optionalCountry = { type: 'string', pattern: '^([A-Z]{2})?$' }
export const optionalCurrency = { type: 'string', pattern: '^([A-Z]{3})?$' }
export const code = { type: 'string', maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }
/** An exact, non-negative decimal amount kept as a string (`"1250.00"`); empty while a draft is incomplete. */
export const money = { type: 'string', pattern: '^((0|[1-9][0-9]{0,14})(\\.[0-9]{1,4})?)?$' }
/** A non-negative decimal quantity or percentage kept as a string. */
export const decimal = { type: 'string', pattern: '^((0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?)?$' }
/** A workspace path chosen in a select; empty until chosen. */
export const pathOrEmpty = { type: 'string', maxLength: 4096, pattern: '^(/.*)?$' }

export function object(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function array(items, minItems = 0, maxItems = 1000) {
  return { type: 'array', items, minItems, maxItems }
}

/** A reference to another record: its absolute workspace path, plus the stable node id when known. */
export const fileReference = object({
  path: { type: 'string', pattern: '^/', maxLength: 4096 },
  nodeId: uuid,
}, ['path'])

export const address = object({
  lines: array({ type: 'string', maxLength: 200 }, 0, 5),
  city: optional(),
  region: optional(),
  postalCode: optional(32),
  country: optionalCountry,
}, [])

/** `required` that Ajv strict mode accepts in conditional subschemas: the properties are declared alongside. */
export const requires = fields => ({ properties: Object.fromEntries(fields.map(field => [field, true])), required: fields })

/** `if status is X then fields are required`. */
export const whenStatus = (values, fields) => ({
  if: { properties: { status: { enum: values } }, required: ['status'] },
  then: requires(fields),
})

export function schemas(schemaBase, app) {
  const schemaId = kind => `${schemaBase}/${kind}.schema.json`
  function recordSchema(kind, title, properties, required, rules = []) {
    const id = schemaId(kind)
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: id,
      title: `${app} ${title}`,
      ...object({
        $schema: { const: id },
        schemaVersion: { const: 1 },
        kind: { const: kind },
        id: uuid,
        state: { enum: ['active', 'archived'] },
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: timestamp,
        ...properties,
      }, ['$schema', 'schemaVersion', 'kind', 'id', 'state', 'createdAt', 'updatedAt', ...required]),
      allOf: [
        { if: { properties: { state: { const: 'archived' } }, required: ['state'] }, then: { properties: { archivedAt: timestamp }, required: ['archivedAt'] } },
        ...rules,
      ],
    }
  }
  function settingsSchema(properties, required) {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: schemaId('settings'),
      title: `${app} settings`,
      ...object({ $schema: { const: schemaId('settings') }, schemaVersion: { const: 1 }, ...properties }, ['$schema', 'schemaVersion', ...required]),
    }
  }
  const recordTemplate = (kind, fields) => ({
    $schema: schemaId(kind), schemaVersion: 1, kind, id: '{{ id }}', state: 'active',
    createdAt: '{{ now }}', updatedAt: '{{ now }}', code: '', ...fields,
  })
  return { schemaId, recordSchema, settingsSchema, recordTemplate }
}

// Mirrors the platform "New" substitution over a packaged template's text. Every placeholder sits
// inside a JSON string, so values are JSON-escaped to keep names with quotes or backslashes valid.
export function fillTemplate(text, values) {
  return text.replace(/\{\{\s*(id|now|name)\s*\}\}/g, (_, key) => JSON.stringify(String(values[key] ?? '')).slice(1, -1))
}
