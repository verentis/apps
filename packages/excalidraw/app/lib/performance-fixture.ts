export function performanceElements() {
  return Array.from({ length: 1000 }, (_, i) => ({
    id: `fixture-${i}`, type: 'rectangle' as const,
    x: i % 40 * 100, y: Math.floor(i / 40) * 80, width: 80, height: 60,
    angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
    fillStyle: 'hachure' as const, strokeWidth: 1, strokeStyle: 'solid' as const,
    roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
    seed: i + 1, version: 1, versionNonce: i + 1, isDeleted: false,
    boundElements: null, updated: 1, link: null, locked: false,
  }))
}
