import type { VerentisClient } from '@verentis/sdk'
import type { NativePort } from '../app/lib/collaboration'

type SDKCollaboration = VerentisClient['collaboration']

// Verify the adapter against the actual pinned SDK rather than a parallel schema.
export function assertSDKContract(client: SDKCollaboration): NativePort {
  return client
}
