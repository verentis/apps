import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { Scene } from './format'
import { performanceElements } from './performance-fixture'

export const templates = [
  { id: 'blank', name: 'Blank document' },
  { id: 'flowchart', name: 'Simple flowchart' },
  { id: 'wireframe', name: 'Page wireframe' },
] as const
export type TemplateId = typeof templates[number]['id']

export function createTemplate(id: TemplateId = 'blank'): Scene {
  const elements = id === 'flowchart' ? convertToExcalidrawElements([
    { type: 'rectangle', x: 100, y: 100, width: 160, height: 80, label: { text: 'Start' } },
    { type: 'arrow', x: 270, y: 140, width: 110, height: 0 },
    { type: 'diamond', x: 400, y: 90, width: 160, height: 100, label: { text: 'Decide' } },
    { type: 'arrow', x: 580, y: 140, width: 110, height: 0 },
    { type: 'rectangle', x: 700, y: 100, width: 160, height: 80, label: { text: 'Finish' } },
  ]) : id === 'wireframe' ? convertToExcalidrawElements([
    { type: 'rectangle', x: 100, y: 80, width: 700, height: 500 },
    { type: 'rectangle', x: 120, y: 100, width: 660, height: 60, label: { text: 'Header' } },
    { type: 'rectangle', x: 120, y: 180, width: 180, height: 320, label: { text: 'Navigation' } },
    { type: 'rectangle', x: 320, y: 180, width: 460, height: 320, label: { text: 'Content' } },
    { type: 'rectangle', x: 120, y: 520, width: 660, height: 40, label: { text: 'Footer' } },
  ]) : []
  return { elements, appState: { viewBackgroundColor: '#ffffff' }, files: {} }
}

export function performanceFixture(): Scene {
  return {
    elements: convertToExcalidrawElements(performanceElements()),
    appState: { viewBackgroundColor: '#ffffff' }, files: {},
  }
}
