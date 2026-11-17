import { Buffer } from 'node:buffer'

import * as tlv from './tlv.js'

enum ErrorStatusTypes {
  ERROR_ENTRY = 0x01,
}

enum ErrorEntryTypes {
  ERROR_CODE = 0x01,
  MANUFACTURER_ERROR_INFO = 0x02,
}

/**
 * The faults an accessory can report with the Error Status characteristic.
 * The Home app turns a fault which was not there before into a notification, like "Front Door Jammed".
 *
 * @group Utils
 */
export enum ErrorStatusCode {
  SENSOR_FAILURE = 0,
  AUDIO_FAILURE = 1,
  BULB_FAILURE = 2,
  POWER_INSTABILITY = 3,
  EXCESSIVE_BATTERY_DRAIN = 4,
  CONNECTIVITY_FAILURE = 5,
  COOLING_FAILURE = 6,
  HEATING_FAILURE = 7,
  JAMMED = 8,
  DEVICE_OVERHEATING = 9,
  SAFETY_TEMPERATURE_EXCEEDED = 10,
  SUDDEN_TEMPERATURE_CHANGE = 11,
  FREEZE_RISK = 12,
  CALIBRATION_ERROR = 13,
  DEVICE_DAMAGED = 14,
}

/**
 * One fault of an accessory.
 *
 * @group Utils
 */
export interface ErrorStatusEntry {
  code: ErrorStatusCode
  /** Text of the manufacturer about the fault, like its own error number. Keep it short. */
  manufacturerErrorInfo?: string
}

/**
 * Builds the value of the Error Status characteristic from the faults an accessory has right now.
 * No faults is an empty value.
 *
 * No service lists the characteristic, so add it to the service the fault belongs to, and update it when a
 * fault starts or ends.
 *
 * HomeKit does not document this characteristic, which is new in iOS 27. The layout comes from Apple's own
 * HomeKit code.
 *
 * @example
 * ```ts
 * const errorStatus = lockService.addCharacteristic(Characteristic.ErrorStatus);
 *
 * // when the lock jams
 * errorStatus.updateValue(encodeErrorStatus([{ code: ErrorStatusCode.JAMMED }]));
 *
 * // when the fault ends
 * errorStatus.updateValue(encodeErrorStatus([]));
 * ```
 * @param entries - the faults the accessory has right now
 * @group Utils
 */
export function encodeErrorStatus(entries: ErrorStatusEntry[]): string {
  if (entries.length === 0) {
    return ''
  }

  return tlv.encode(ErrorStatusTypes.ERROR_ENTRY, entries.map(entry => Buffer.concat([
    tlv.encode(ErrorEntryTypes.ERROR_CODE, tlv.writeVariableUIntLE(entry.code)),
    ...(entry.manufacturerErrorInfo
      ? [
          tlv.encode(ErrorEntryTypes.MANUFACTURER_ERROR_INFO, entry.manufacturerErrorInfo),
        ]
      : []),
  ]))).toString('base64')
}

/**
 * Reads the value of the Error Status characteristic back into its faults.
 *
 * @param value - the value of the characteristic, as base64
 * @group Utils
 */
export function decodeErrorStatus(value: string): ErrorStatusEntry[] {
  const entries = tlv.decodeWithLists(Buffer.from(value, 'base64'))[ErrorStatusTypes.ERROR_ENTRY]
  if (entries === undefined) {
    return []
  }

  return (Array.isArray(entries)
    ? entries
    : [entries]).map((data) => {
    const fields = tlv.decode(data)
    const code = fields[ErrorEntryTypes.ERROR_CODE]
    if (!code) {
      throw new Error('Error Status entry without an error code')
    }
    const info = fields[ErrorEntryTypes.MANUFACTURER_ERROR_INFO]
    return {
      code: tlv.readVariableUIntLE(code),
      ...(info && {
        manufacturerErrorInfo: info.toString('utf8'),
      }),
    }
  })
}
