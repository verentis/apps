// File-based PLM record contracts. Every record is one JSON file whose vendor MIME names its kind.
import {
  code, date, fillTemplate, optional, optionalDate, pathOrEmpty, requires, schemas as schemaKit, text, timestamp,
} from '../../../tools/file-apps/schema.mjs'

export const installRoot = '/applications/plm'
export const schemaBase = 'https://schemas.verentis.io/plm/v1'

/**
 * Manufacturing (optional) keeps bills of materials here; engineering change orders can reference the BoM (or
 * product) they change through its vendor MIME when Manufacturing is installed.
 */
export const manufacturing = {
  boms: '/bills-of-materials',
  bomMime: 'application/vnd.verentis.manufacturing.bom+json',
}

const vendor = kind => `application/vnd.verentis.plm.${kind}+json`

export const mimeTypes = {
  ecos: 'application/vnd.verentis.plm.ecos',
  eco: vendor('eco'),
}

// Containers are content-less typed nodes that hold records as children; the file browser lists them.
export const containers = {
  ecos: { path: '/engineering-change-orders', mime: mimeTypes.ecos, holds: ['eco'] },
}

/** Records are named by a generated code (`ECO-0001`) and stored without an extension in their container. */
export const recordKinds = ['eco']
export const containerOf = { eco: 'ecos' }

export const codeSettings = {
  eco: { key: 'eco-code-prefix', default: 'ECO-', label: 'Engineering change order code prefix' },
}
export const codeDigits = { key: 'code-digits', default: 4, label: 'Code digits' }

/** An ECO moves draft → in-review → approved → applied, or is rejected during review. */
export const stages = ['draft', 'in-review', 'approved', 'applied', 'rejected']
export const changeTypes = ['new-product', 'change', 'obsolete']
export const priorities = ['low', 'normal', 'high', 'urgent']

const { schemaId, recordSchema, recordTemplate } = schemaKit(schemaBase, 'PLM')
export { schemaId }

/** `if stage is X then fields are required` (the record lifecycle key is `stage`, not `status`). */
const whenStage = (values, then) => ({
  if: { properties: { stage: { enum: values } }, required: ['stage'] },
  then,
})

// Draft records may be incomplete on disk (a generated record opens straight into its form); the review script
// checks them as they move through their stages.
export const schemas = {
  eco: recordSchema('eco', 'engineering change order', {
    code,
    title: text,
    type: { enum: changeTypes },
    product: pathOrEmpty,
    priority: { enum: priorities },
    stage: { enum: stages },
    approver: optional(200),
    effectiveDate: optionalDate,
    description: optional(10000),
    rejectionReason: optional(1000),
    submittedAt: timestamp,
    approvedAt: timestamp,
    appliedAt: timestamp,
    rejectedAt: timestamp,
  }, ['code', 'title', 'type', 'product', 'priority', 'stage', 'approver', 'effectiveDate', 'description', 'rejectionReason'], [
    whenStage(['in-review', 'approved', 'applied', 'rejected'], requires(['submittedAt'])),
    whenStage(['approved', 'applied'], {
      properties: { approvedAt: timestamp, approver: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['approvedAt', 'approver'],
    }),
    whenStage(['applied'], { properties: { appliedAt: timestamp, effectiveDate: date }, required: ['appliedAt', 'effectiveDate'] }),
    whenStage(['rejected'], {
      properties: { rejectedAt: timestamp, rejectionReason: { type: 'string', minLength: 1, maxLength: 1000 } },
      required: ['rejectedAt', 'rejectionReason'],
    }),
  ]),
}

/**
 * New-record templates. `{{ id }}`, `{{ now }}` and `{{ name }}` are substituted; the create script then adds
 * the generated `code`.
 */
export const templates = {
  eco: recordTemplate('eco', {
    title: '{{ name }}', type: 'change', product: '', priority: 'normal', stage: 'draft',
    approver: '', effectiveDate: '', description: '', rejectionReason: '',
  }),
}

/** Defaults the create script fills into empty template fields. */
export const createDefaults = {}

export { fillTemplate }
