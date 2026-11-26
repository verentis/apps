// Field Service views from the design: who is out today, and their load.
import { listPage } from '../../../tools/file-apps/canvas.mjs'
import { containers, mimeTypes } from './contracts.mjs'

const today = "Date().slice(0, 10)"
export function listPages() {
  return [
    listPage({ file: 'technicians.page.yaml', id: 'field-service-technicians', name: 'Technicians', description: "Who is out today and how much each has on.", icon: 'users-round', container: containers.tasks.path, mime: mimeTypes.task, clickable: false,
      rows: `RECORDS.filter(e => ['new', 'scheduled', 'on-site'].includes(e.data.stage || 'new') && !!e.data.technician).map(e => e.data.technician).filter((t, i, all) => all.indexOf(t) === i).map(t => ({ technician: t,`
        + ` today: RECORDS.filter(e => e.data.technician === t && e.data.scheduledDate === ${today}).length, onsite: RECORDS.filter(e => e.data.technician === t && e.data.stage === 'on-site').length,`
        + ` open: RECORDS.filter(e => e.data.technician === t && ['new', 'scheduled', 'on-site'].includes(e.data.stage || 'new')).length, hours: RECORDS.filter(e => e.data.technician === t && e.data.scheduledDate === ${today}).reduce((sum, e) => sum + (Number(e.data.hours) || 0), 0) })).sort((a, b) => b.today - a.today)`,
      columns: [['technician', 'Technician'], ['today', 'Jobs today', 'end'], ['onsite', 'On site now', 'end'], ['open', 'Open jobs', 'end'], ['hours', 'Hours logged today', 'end']], empty: 'No technician has open jobs.' }),
  ]
}
