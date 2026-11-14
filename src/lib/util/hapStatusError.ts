import { HAPStatus, IsKnownHAPStatusError } from '../HAPServer.js'

/**
 * Throws a HAP status error that is sent back to HomeKit.
 *
 * @example
 * ```ts
 * throw new HapStatusError(HAPStatus.OPERATION_TIMED_OUT);
 * ```
 *
 * @group Utils
 */
export class HapStatusError extends Error {
  public hapStatus: HAPStatus

  constructor(status: HAPStatus) {
    super(`HAP Status Error: ${status}`)

    this.name = 'HapStatusError'

    if (IsKnownHAPStatusError(status)) {
      this.hapStatus = status
    } else {
      this.hapStatus = HAPStatus.SERVICE_COMMUNICATION_FAILURE
    }
  }
}
