import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const repo = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, repo), 'utf8')
const exists = path => existsSync(new URL(path, repo))

const config = JSON.parse(read('.github/verentis-delivery.json'))
const hosted = ['image-viewer', 'markdown-viewer', 'smart-editor', 'excalidraw']
const packageOnly = [
  'crm', 'accounting', 'invoicing',
  'appointments', 'appraisals', 'approvals', 'documents', 'employees', 'events', 'expenses',
  'field-service', 'fleet', 'helpdesk', 'inventory', 'knowledge', 'maintenance', 'manufacturing',
  'payroll', 'planning', 'plm', 'project', 'purchase', 'quality', 'recruitment', 'referrals',
  'rental', 'sales', 'social-marketing', 'spreadsheet-bi', 'surveys', 'time-off', 'timesheets',
]
const packages = readdirSync(new URL('packages/', repo), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && readdirSync(new URL(`packages/${entry.name}/`, repo)).some(file => file.endsWith('.app.yaml')))
  .map(entry => entry.name)

test('every package is classified exactly once', () => {
  assert.deepEqual([...packages].sort(), [...hosted, ...packageOnly].sort())
  assert.deepEqual(config.hosted.map(app => app.name), hosted)
})

for (const app of config.hosted) {
  test(`${app.name} is a deployable hosted app`, () => {
    assert.match(app.name, /^[a-z][a-z0-9-]{0,40}$/)
    assert.equal(app['package-root'], `packages/${app.name}`)
    assert.equal(app.image, `verentis/${app.name}`)
    assert.ok(exists(app.dockerfile ?? `${app.context ?? app['package-root']}/Dockerfile`), 'Dockerfile')
    assert.ok(exists(app.manifests), 'k8s template')
    assert.ok(app.health?.length > 0, 'health check')
  })

  test(`${app.name} renders into the apps namespace with the wildcard certificate`, () => {
    const template = read(app.manifests)
    const objects = template.split(/^---$/m).filter(object => /^kind:/m.test(object))
    assert.ok(objects.length > 0)
    for (const object of objects) assert.match(object, /^ {2}namespace: __NAMESPACE__$/m)
    assert.match(template, /secretName: __TLS_SECRET__/)
    assert.doesNotMatch(template, /cert-manager\.io|kind: (Namespace|Certificate|ClusterRole)/)
  })
}

for (const name of packageOnly) {
  test(`${name} stays package-only`, () => {
    assert.ok(!exists(`packages/${name}/Dockerfile`))
    assert.ok(!exists(`packages/${name}/k8s`))
  })
}

test('production hosts are region-free and every production overlay has a feature overlay', () => {
  for (const name of packages) {
    const production = read(`packages/${name}/environments/production.yaml`)
    assert.doesNotMatch(production, /verentis\.dev/)
    assert.match(production, /\.apps\.verentis\.io/)
    assert.ok(exists(`packages/${name}/environments/feature.yaml`))
  }
})

test('Excalidraw uses an unprivileged port without weakening pod security or changing the Service port', () => {
  const dockerfile = read('packages/excalidraw/Dockerfile')
  const deployment = read('packages/excalidraw/k8s/deployment.yaml')
  assert.match(dockerfile, /ENV .*PORT=8080\b/)
  assert.match(dockerfile, /^EXPOSE 8080$/m)
  assert.match(deployment, /name: http\s+containerPort: 8080/)
  assert.match(deployment, /runAsNonRoot: true/)
  assert.match(deployment, /runAsUser: 65532/)
  assert.match(deployment, /readOnlyRootFilesystem: true/)
  assert.match(deployment, /drop: \[ALL\]/)
  assert.match(deployment, /port: 80\s+targetPort: http/)
})
