import type { InjectionKey } from 'vue'

export const hostCleanupKey: InjectionKey<(cleanup: () => Promise<void>) => () => void> = Symbol('host-cleanup')
