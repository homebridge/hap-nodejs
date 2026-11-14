import { describe, expect, it, vi } from 'vitest'

import { HAPStatus } from '../HAPServer.js'
import { DataStreamManagement } from './DataStreamManagement.js'

describe('DataStreamManagement', () => {
  it('should reject a setup write which is not a string as an invalid value', () => {
    const management = new DataStreamManagement()
    const callback = vi.fn()

    // @ts-expect-error: private access
    management.handleSetupDataStreamTransportWrite(5, callback, {})

    expect(callback).toHaveBeenCalledExactlyOnceWith(HAPStatus.INVALID_VALUE_IN_REQUEST)
    // @ts-expect-error: private access
    expect(management.dataStreamServer.preparedSessions).toHaveLength(0)

    management.destroy()
  })
})
