import type { AccessCode as AccessCodeService } from '../definitions/index.js'

import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'

import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import * as tlv from '../util/tlv.js'

enum AccessCodeSupportedConfigurationTypes {
  CHARACTER_SET = 0x01,
  MINIMUM_VALUE_LENGTH = 0x02,
  MAXIMUM_VALUE_LENGTH = 0x03,
  MAXIMUM_ACCESS_CODES = 0x04,
}

enum AccessCodeControlTypes {
  OPERATION_TYPE = 0x01,
  REQUEST = 0x02,
  RESPONSE = 0x03,
}

enum AccessCodeControlRequestTypes {
  IDENTIFIER = 0x01,
  ACCESS_CODE = 0x02,
}

enum AccessCodeControlResponseTypes {
  IDENTIFIER = 0x01,
  ACCESS_CODE = 0x02,
  FLAGS = 0x03,
  STATUS_CODE = 0x04,
}

/** The only character set HomeKit defines: the digits 0 to 9. */
const CHARACTER_SET_ARABIC_NUMERALS = 0x01

enum AccessCodeOperation {
  LIST = 1,
  READ = 2,
  ADD = 3,
  UPDATE = 4,
  REMOVE = 5,
}

/**
 * The result of one access code operation, as sent back to the Home app.
 *
 * @group Lock
 */
export enum AccessCodeResponseStatus {
  SUCCESS = 0,
  UNKNOWN = 1,
  EXCEEDED_MAXIMUM_ALLOWED_ACCESS_CODES = 2,
  TOO_MANY_BULK_OPERATIONS = 3,
  DUPLICATE = 4,
  SMALLER_THAN_MINIMUM_LENGTH = 5,
  LARGER_THAN_MAXIMUM_LENGTH = 6,
  INVALID_CHARACTER = 7,
  INVALID_REQUEST = 8,
  DOES_NOT_EXIST = 9,
}

/**
 * @group Lock
 */
export enum AccessCodeManagementEvent {
  ACCESS_CODES_UPDATED = 'update-access-codes',
}

/**
 * One access code stored on the lock.
 *
 * @group Lock
 */
export interface StoredAccessCode {
  /** The number the lock gave this code. The Home app uses it to read, change and remove the code. */
  identifier: number
  /** The code itself, digits only. */
  accessCode: string
}

/**
 * @group Lock
 */
export interface AccessCodeManagementOptions {
  /** The shortest code the lock accepts. Default 4. */
  minimumLength?: number
  /** The longest code the lock accepts. Default 8. */
  maximumLength?: number
  /** How many codes the lock can hold. Default 16. */
  maximumAccessCodes?: number
  /** The codes already on the lock, for example the ones saved before a restart. */
  accessCodes?: StoredAccessCode[]
  /** Supply your own instance to sideload the AccessCode service. */
  service?: AccessCodeService
}

interface AccessCodeResult {
  identifier?: number
  accessCode?: string
  status: AccessCodeResponseStatus
}

export declare interface AccessCodeManagement {
  on(event: 'update-access-codes', listener: (accessCodes: StoredAccessCode[]) => void): this

  emit(event: 'update-access-codes', accessCodes: StoredAccessCode[]): boolean
}

/**
 * Handles the AccessCode service of a lock with a keypad: the Home app lists, adds, changes and removes the codes
 * people type on the keypad.
 *
 * The codes are kept in memory. Listen for {@link AccessCodeManagementEvent.ACCESS_CODES_UPDATED} to save them and to
 * send them to the lock, and pass the saved ones back as {@link AccessCodeManagementOptions.accessCodes} on the next start.
 *
 * HomeKit does not document this service. The layout comes from Apple's own HomeKit code, and matches the public
 * reverse engineering in https://github.com/rednblkx/homekit-lock-access-code.
 *
 * @example
 * ```ts
 * // an accessory restored from the cache already has the service: hand it over, so no second one is added
 * const cachedService = accessory.getService(Service.AccessCode);
 * const accessCodes = new AccessCodeManagement({ accessCodes: savedCodes, service: cachedService });
 * if (!cachedService) {
 *   accessory.addService(accessCodes.getService());
 * }
 *
 * accessCodes.on(AccessCodeManagementEvent.ACCESS_CODES_UPDATED, (codes) => {
 *   // save the codes, and send them to the lock
 * });
 *
 * // when someone types a code on the keypad
 * if (accessCodes.hasAccessCode('1234')) {
 *   // unlock
 * }
 * ```
 *
 * @group Lock
 */
export class AccessCodeManagement extends EventEmitter {
  private readonly accessCodeService: AccessCodeService

  private readonly minimumLength: number
  private readonly maximumLength: number
  private readonly maximumAccessCodes: number

  private readonly accessCodes = new Map<number, string>()

  /**
   * A counter which goes up by one whenever the codes change.
   * How the Home app uses the Configuration State characteristic is not confirmed; a change counter is the usual meaning.
   */
  private configurationState = 0

  /**
   * Instantiates a new AccessCodeManagement.
   *
   * @param {AccessCodeManagementOptions} options - the limits of the lock, the codes it holds and your own AccessCode service
   */
  constructor(options: AccessCodeManagementOptions = {}) {
    super()

    this.minimumLength = options.minimumLength ?? 4
    this.maximumLength = options.maximumLength ?? 8
    this.maximumAccessCodes = options.maximumAccessCodes ?? 16
    for (const { identifier, accessCode } of options.accessCodes ?? []) {
      this.accessCodes.set(identifier, accessCode)
    }

    this.accessCodeService = options.service || new Service.AccessCode()
    this.setupServiceHandlers()
  }

  /**
   * @returns the AccessCode service
   */
  public getService(): AccessCodeService {
    return this.accessCodeService
  }

  /**
   * @returns the codes stored on the lock, in the order of their identifiers
   */
  public getAccessCodes(): StoredAccessCode[] {
    return [...this.accessCodes]
      .sort(([a], [b]) => a - b)
      .map(([identifier, accessCode]) => ({ identifier, accessCode }))
  }

  /**
   * Whether a code typed on the keypad is one of the stored codes.
   *
   * @param accessCode - the code which was typed
   */
  public hasAccessCode(accessCode: string): boolean {
    return [
      ...this.accessCodes.values(),
    ].includes(accessCode)
  }

  /**
   * This destroys the AccessCodeManagement.
   * It unregisters the SET handler it has associated with the given AccessCode service.
   * It removes all event handlers which were registered to this object.
   */
  public destroy(): void {
    this.removeAllListeners()

    this.accessCodeService.getCharacteristic(Characteristic.AccessCodeControlPoint).removeOnSet()
  }

  private handleControlPointWrite(value: string): string {
    let operation: number | undefined
    let results: AccessCodeResult[]
    let changed = false

    try {
      const objects = tlv.decodeWithLists(Buffer.from(value, 'base64'))
      const operationData = objects[AccessCodeControlTypes.OPERATION_TYPE] as Buffer | undefined
      operation = operationData
        ? tlv.readVariableUIntLE(operationData)
        : undefined

      const requestData = objects[AccessCodeControlTypes.REQUEST]
      const requests = (requestData === undefined
        ? []
        : Array.isArray(requestData)
          ? requestData
          : [requestData])
        .map((data) => {
          const fields = tlv.decode(data)
          const identifier = fields[AccessCodeControlRequestTypes.IDENTIFIER]
          return {
            identifier: identifier
              ? tlv.readVariableUIntLE(identifier)
              : undefined,
            accessCode: fields[AccessCodeControlRequestTypes.ACCESS_CODE]?.toString('utf8'),
          }
        })

      switch (operation) {
        case AccessCodeOperation.LIST:
          results = this.getAccessCodes().map(code => ({ ...code, status: AccessCodeResponseStatus.SUCCESS }))
          break
        case AccessCodeOperation.READ:
          results = requests.map(({ identifier }) => this.read(identifier))
          break
        case AccessCodeOperation.ADD:
          results = requests.map(({ accessCode }) => this.add(accessCode))
          break
        case AccessCodeOperation.UPDATE:
          results = requests.map(({ identifier, accessCode }) => this.update(identifier, accessCode))
          break
        case AccessCodeOperation.REMOVE:
          results = requests.map(({ identifier }) => this.remove(identifier))
          break
        default:
          results = [
            { status: AccessCodeResponseStatus.INVALID_REQUEST },
          ]
      }
      // READ never changes anything, and LIST has no requests
      changed = operation !== AccessCodeOperation.LIST && operation !== AccessCodeOperation.READ
        && results.some(result => result.status === AccessCodeResponseStatus.SUCCESS)
    } catch {
      results = [
        { status: AccessCodeResponseStatus.INVALID_REQUEST },
      ]
    }

    if (changed) {
      this.configurationState = this.configurationState >= 0xFFFF
        ? 1
        : this.configurationState + 1
      this.accessCodeService.updateCharacteristic(Characteristic.ConfigurationState, this.configurationState)

      const accessCodes = this.getAccessCodes()
      setTimeout(() => { // timeout this so any action won't be executed on sync to the HAP request
        // the codes of this write, not the state at the time the timer fires: another write may have followed by then
        this.emit(AccessCodeManagementEvent.ACCESS_CODES_UPDATED, accessCodes)
      }, 0).unref()
    }

    return this.encodeResponse(operation, results).toString('base64')
  }

  private read(identifier: number | undefined): AccessCodeResult {
    const accessCode = identifier === undefined
      ? undefined
      : this.accessCodes.get(identifier)
    return accessCode === undefined
      ? { identifier, status: AccessCodeResponseStatus.DOES_NOT_EXIST }
      : { identifier, accessCode, status: AccessCodeResponseStatus.SUCCESS }
  }

  private add(accessCode: string | undefined): AccessCodeResult {
    const invalid = this.validate(accessCode)
    if (invalid !== undefined || accessCode === undefined) {
      return { accessCode, status: invalid ?? AccessCodeResponseStatus.INVALID_REQUEST }
    }
    if (this.accessCodes.size >= this.maximumAccessCodes) {
      return { accessCode, status: AccessCodeResponseStatus.EXCEEDED_MAXIMUM_ALLOWED_ACCESS_CODES }
    }

    let identifier = 0
    while (this.accessCodes.has(identifier)) {
      identifier++
    }
    this.accessCodes.set(identifier, accessCode)
    return { identifier, accessCode, status: AccessCodeResponseStatus.SUCCESS }
  }

  private update(identifier: number | undefined, accessCode: string | undefined): AccessCodeResult {
    if (identifier === undefined || !this.accessCodes.has(identifier)) {
      return { identifier, status: AccessCodeResponseStatus.DOES_NOT_EXIST }
    }
    const invalid = this.validate(accessCode, identifier)
    if (invalid !== undefined || accessCode === undefined) {
      return { identifier, status: invalid ?? AccessCodeResponseStatus.INVALID_REQUEST }
    }

    this.accessCodes.set(identifier, accessCode)
    return { identifier, accessCode, status: AccessCodeResponseStatus.SUCCESS }
  }

  private remove(identifier: number | undefined): AccessCodeResult {
    const result = this.read(identifier)
    if (result.status === AccessCodeResponseStatus.SUCCESS && identifier !== undefined) {
      this.accessCodes.delete(identifier)
    }
    return result
  }

  /**
   * @returns the status for a code which cannot be stored, or `undefined` for a code which can
   */
  private validate(accessCode: string | undefined, ignoreIdentifier?: number): AccessCodeResponseStatus | undefined {
    if (accessCode === undefined) {
      return AccessCodeResponseStatus.INVALID_REQUEST
    }
    if (!/^\d*$/.test(accessCode)) {
      return AccessCodeResponseStatus.INVALID_CHARACTER
    }
    if (accessCode.length < this.minimumLength) {
      return AccessCodeResponseStatus.SMALLER_THAN_MINIMUM_LENGTH
    }
    if (accessCode.length > this.maximumLength) {
      return AccessCodeResponseStatus.LARGER_THAN_MAXIMUM_LENGTH
    }
    for (const [identifier, existing] of this.accessCodes) {
      if (existing === accessCode && identifier !== ignoreIdentifier) {
        return AccessCodeResponseStatus.DUPLICATE
      }
    }
    return undefined
  }

  private encodeResponse(operation: number | undefined, results: AccessCodeResult[]): Buffer {
    const responses = results.map((result) => {
      const fields: Buffer[] = []
      if (result.identifier !== undefined) {
        fields.push(tlv.encode(AccessCodeControlResponseTypes.IDENTIFIER, tlv.writeVariableUIntLE(result.identifier)))
      }
      if (result.accessCode !== undefined) {
        fields.push(tlv.encode(AccessCodeControlResponseTypes.ACCESS_CODE, result.accessCode))
      }
      fields.push(
        tlv.encode(AccessCodeControlResponseTypes.FLAGS, 0),
        tlv.encode(AccessCodeControlResponseTypes.STATUS_CODE, result.status),
      )
      return Buffer.concat(fields)
    })

    return Buffer.concat([
      // the operation is echoed: Apple's HomeKit daemon is reported to crash on an answer without it
      tlv.encode(AccessCodeControlTypes.OPERATION_TYPE, operation ?? 0),
      // an empty list is no entry at all, not an entry of zero length
      ...(responses.length > 0
        ? [
            tlv.encode(AccessCodeControlTypes.RESPONSE, responses),
          ]
        : []),
    ])
  }

  private setupServiceHandlers() {
    this.accessCodeService.getCharacteristic(Characteristic.AccessCodeSupportedConfiguration)
      .updateValue(Buffer.concat([
        tlv.encode(AccessCodeSupportedConfigurationTypes.CHARACTER_SET, CHARACTER_SET_ARABIC_NUMERALS),
        tlv.encode(AccessCodeSupportedConfigurationTypes.MINIMUM_VALUE_LENGTH, this.minimumLength),
        tlv.encode(AccessCodeSupportedConfigurationTypes.MAXIMUM_VALUE_LENGTH, this.maximumLength),
        tlv.encode(AccessCodeSupportedConfigurationTypes.MAXIMUM_ACCESS_CODES, this.maximumAccessCodes),
      ]).toString('base64'))

    this.accessCodeService.getCharacteristic(Characteristic.ConfigurationState)
      .updateValue(this.configurationState)

    this.accessCodeService.getCharacteristic(Characteristic.AccessCodeControlPoint)
      .onSet(value => this.handleControlPointWrite(value as string))
      .updateValue('')
  }
}
