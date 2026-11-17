import type { NFCAccess } from '../definitions/index.js'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import * as tlv from '../util/tlv.js'

enum NFCAccessSupportedConfigurationTypes {
  MAXIMUM_ISSUER_KEYS = 0x01,
  MAXIMUM_SUSPENDED_DEVICE_CREDENTIAL_KEYS = 0x02,
}

enum NFCAccessControlTypes {
  OPERATION_TYPE = 0x01,
  ISSUER_KEY_REQUEST = 0x02,
  ISSUER_KEY_RESPONSE = 0x03,
  DEVICE_CREDENTIAL_KEY_REQUEST = 0x04,
  DEVICE_CREDENTIAL_KEY_RESPONSE = 0x05,
  READER_KEY_REQUEST = 0x06,
  READER_KEY_RESPONSE = 0x07,
}

enum IssuerKeyRequestTypes {
  TYPE = 0x01,
  KEY = 0x02,
  IDENTIFIER = 0x03,
}

enum IssuerKeyResponseTypes {
  IDENTIFIER = 0x01,
  STATUS_CODE = 0x02,
}

enum DeviceCredentialKeyRequestTypes {
  TYPE = 0x01,
  KEY = 0x02,
  ISSUER_KEY_IDENTIFIER = 0x03,
  STATE = 0x04,
  IDENTIFIER = 0x05,
}

enum DeviceCredentialKeyResponseTypes {
  IDENTIFIER = 0x01,
  ISSUER_KEY_IDENTIFIER = 0x02,
  STATUS_CODE = 0x03,
}

enum ReaderKeyRequestTypes {
  TYPE = 0x01,
  KEY = 0x02,
  READER_IDENTIFIER = 0x03,
  IDENTIFIER = 0x04,
}

enum ReaderKeyResponseTypes {
  IDENTIFIER = 0x01,
  STATUS_CODE = 0x02,
}

enum HardwareFinishTypes {
  RGB_COLOR_VALUE = 0x01,
}

enum NFCAccessOperation {
  LIST = 1,
  ADD = 2,
  REMOVE = 3,
}

enum NFCAccessKeyType {
  ED25519 = 1,
  NIST256 = 2,
}

enum NFCAccessKeyState {
  SUSPENDED = 0,
  ACTIVE = 1,
}

/**
 * The result of one NFC Access operation, as sent back to the Home app.
 *
 * @group Lock
 */
export enum NFCAccessResponseStatus {
  SUCCESS = 0,
  OUT_OF_RESOURCES = 1,
  DUPLICATE = 2,
  DOES_NOT_EXIST = 3,
  NOT_SUPPORTED = 4,
}

/**
 * The colour of the home key card in Wallet. These four are the only values the Home app accepts.
 *
 * @group Lock
 */
export enum HomeKeyFinish {
  BLACK = 0x000000,
  TAN = 0xDAD5CE,
  SILVER = 0xE3E3E3,
  GOLD = 0xECD6AA,
}

/**
 * @group Lock
 */
export enum NFCAccessManagementEvent {
  STATE_UPDATED = 'update-state',
}

/**
 * The key a lock uses to prove itself to a phone or a watch. There is one for a whole home.
 * It is a private key: store it as carefully as a pairing key, and never log it.
 *
 * @group Lock
 */
export interface NFCAccessReaderKey {
  /** The first 8 bytes of SHA-256("key-identifier" + private key), as hex. */
  identifier: string
  /** The NIST P-256 private key, 32 bytes as hex. */
  privateKey: string
  /** The reader identifier the Home app sent with the key, as hex. */
  readerIdentifier: string
}

/**
 * The public key of one home user. It is only stored when the Home app sends one.
 *
 * @group Lock
 */
export interface NFCAccessIssuerKey {
  /** The first 8 bytes of SHA-256("key-identifier" + public key), as hex. */
  identifier: string
  /** The Ed25519 public key, 32 bytes as hex. */
  publicKey: string
}

/**
 * The public key of the home key in the Wallet of one phone or watch.
 *
 * @group Lock
 */
export interface NFCAccessDeviceCredentialKey {
  /** The first 6 bytes of SHA-1(0x04 + public key), as hex. */
  identifier: string
  /** The NIST P-256 public key, X and Y without the 0x04 prefix: 64 bytes as hex. */
  publicKey: string
  /** The identifier of the issuer key of the user this device belongs to, as hex. */
  issuerKeyIdentifier: string
  /** `false` for a key the Home app suspended. */
  active: boolean
}

/**
 * Everything the Home app has stored on the lock for home keys. All of it survives `JSON.stringify()`.
 *
 * @group Lock
 */
export interface NFCAccessState {
  readerKey?: NFCAccessReaderKey
  issuerKeys: NFCAccessIssuerKey[]
  deviceCredentialKeys: NFCAccessDeviceCredentialKey[]
}

/**
 * @group Lock
 */
export interface NFCAccessManagementOptions {
  /** How many issuer keys the lock can hold. Default 16. */
  maximumIssuerKeys?: number
  /** How many suspended device credential keys the lock can hold. Default 16. */
  maximumSuspendedDeviceCredentialKeys?: number
  /** How many device credential keys the lock can hold in all. Default 16. */
  maximumDeviceCredentialKeys?: number
  /** The state saved before a restart. */
  state?: NFCAccessState
  /** Supply your own instance to sideload the NFCAccess service. */
  service?: NFCAccess
}

export declare interface NFCAccessManagement {
  on(event: 'update-state', listener: (state: NFCAccessState) => void): this

  emit(event: 'update-state', state: NFCAccessState): boolean
}

const KEY_IDENTIFIER_PREFIX = Buffer.from('key-identifier', 'ascii')

/**
 * Builds the value of the Hardware Finish characteristic for a card colour.
 * Set it on the AccessoryInformation service of a lock with home keys.
 *
 * @example
 * ```ts
 * accessory.getService(Service.AccessoryInformation)!
 *   .setCharacteristic(Characteristic.HardwareFinish, encodeHardwareFinish(HomeKeyFinish.TAN));
 * ```
 * @param finish - the colour of the home key card in Wallet
 * @group Lock
 */
export function encodeHardwareFinish(finish: HomeKeyFinish): string {
  return tlv.encode(HardwareFinishTypes.RGB_COLOR_VALUE, tlv.writeUInt32(finish)).toString('base64')
}

/**
 * Handles the NFCAccess service of a lock: the part of Apple Home Key which runs over HomeKit.
 * The Home app hands the lock a reader key, and the public key of the home key on each phone and watch.
 *
 * This is only half of Home Key. The other half is the NFC reader at the door, which talks to the phone with
 * those keys. HAP-NodeJS has no part in that: without a reader, the key shows in Wallet and opens nothing.
 *
 * Listen for {@link NFCAccessManagementEvent.STATE_UPDATED} to save the state and to hand it to the reader, and
 * pass the saved state back as {@link NFCAccessManagementOptions.state} on the next start.
 *
 * The state holds a private key. Save it in a file of your own which nobody has a reason to share. A Homebridge
 * plugin must not put it in the context of the accessory: that is written to the `cachedAccessories` file,
 * which people post in bug reports.
 *
 * The lock also needs a LockMechanism service, and the colour of the card comes from the Hardware Finish
 * characteristic of the AccessoryInformation service: see {@link encodeHardwareFinish}.
 *
 * HomeKit does not document this service. The layout comes from Apple's own HomeKit code, and the handling of
 * reader keys and device credential keys matches the plugin homebridge-fake-homekey. The handling of issuer keys
 * and the answers to a list of device credential keys are not confirmed against a Home app.
 *
 * @example
 * ```ts
 * // an accessory restored from the cache already has the service: hand it over, so no second one is added
 * const cachedService = accessory.getService(Service.NFCAccess);
 * const nfcAccess = new NFCAccessManagement({ state: savedState, service: cachedService });
 * if (!cachedService) {
 *   accessory.addService(nfcAccess.getService());
 * }
 * accessory.getService(Service.AccessoryInformation)!
 *   .setCharacteristic(Characteristic.HardwareFinish, encodeHardwareFinish(HomeKeyFinish.TAN));
 *
 * nfcAccess.on(NFCAccessManagementEvent.STATE_UPDATED, (state) => {
 *   // save the state in a file of your own (not in the accessory context), and hand it to the NFC reader
 * });
 * ```
 *
 * @group Lock
 */
export class NFCAccessManagement extends EventEmitter {
  private readonly nfcAccessService: NFCAccess

  private readonly maximumIssuerKeys: number
  private readonly maximumSuspendedDeviceCredentialKeys: number
  private readonly maximumDeviceCredentialKeys: number

  private state: NFCAccessState

  /**
   * Instantiates a new NFCAccessManagement.
   *
   * @param {NFCAccessManagementOptions} options - the limits of the lock, its saved state and your own NFCAccess service
   */
  constructor(options: NFCAccessManagementOptions = {}) {
    super()

    this.maximumIssuerKeys = options.maximumIssuerKeys ?? 16
    this.maximumSuspendedDeviceCredentialKeys = options.maximumSuspendedDeviceCredentialKeys ?? 16
    this.maximumDeviceCredentialKeys = options.maximumDeviceCredentialKeys ?? 16
    this.state = {
      readerKey: options.state?.readerKey && { ...options.state.readerKey },
      issuerKeys: (options.state?.issuerKeys ?? []).map(key => ({ ...key })),
      deviceCredentialKeys: (options.state?.deviceCredentialKeys ?? []).map(key => ({ ...key })),
    }

    this.nfcAccessService = options.service || new Service.NFCAccess()
    this.setupServiceHandlers()
  }

  /**
   * The identifier of a reader key or an issuer key: the first 8 bytes of SHA-256("key-identifier" + key).
   *
   * @param key - the private key of a reader key, or the public key of an issuer key
   */
  public static keyIdentifier(key: Buffer): Buffer {
    return createHash('sha256').update(Buffer.concat([KEY_IDENTIFIER_PREFIX, key])).digest().subarray(0, 8)
  }

  /**
   * @returns the NFCAccess service
   */
  public getService(): NFCAccess {
    return this.nfcAccessService
  }

  /**
   * @returns a copy of everything the Home app has stored on the lock. It holds a private key.
   */
  public getState(): NFCAccessState {
    return {
      readerKey: this.state.readerKey && { ...this.state.readerKey },
      issuerKeys: this.state.issuerKeys.map(key => ({ ...key })),
      deviceCredentialKeys: this.state.deviceCredentialKeys.map(key => ({ ...key })),
    }
  }

  /**
   * This destroys the NFCAccessManagement.
   * It unregisters the SET handler it has associated with the given NFCAccess service.
   * It removes all event handlers which were registered to this object.
   */
  public destroy(): void {
    this.removeAllListeners()

    this.nfcAccessService.getCharacteristic(Characteristic.NFCAccessControlPoint).removeOnSet()
  }

  private handleControlPointWrite(value: string): string {
    let response: Buffer = Buffer.alloc(0)
    const before = JSON.stringify(this.state)

    try {
      const objects = tlv.decodeWithLists(Buffer.from(value, 'base64'))
      const operationData = objects[NFCAccessControlTypes.OPERATION_TYPE] as Buffer | undefined
      const operation = operationData
        ? tlv.readVariableUIntLE(operationData)
        : undefined

      // one write can hold several requests of one kind, as a list: each gets its own answer, in the same order
      const answer = (
        requestType: NFCAccessControlTypes,
        responseType: NFCAccessControlTypes,
        handle: (fields: Record<number, Buffer>) => Buffer[],
      ): Buffer | undefined => {
        const requests = objects[requestType]
        if (requests === undefined) {
          return undefined
        }
        const answers = (Array.isArray(requests)
          ? requests
          : [requests]).flatMap(data => handle(tlv.decode(data)))
        // an empty list is no entry at all, not an entry of zero length
        return answers.length > 0
          ? tlv.encode(responseType, answers)
          : Buffer.alloc(0)
      }

      response = answer(NFCAccessControlTypes.READER_KEY_REQUEST, NFCAccessControlTypes.READER_KEY_RESPONSE, fields => this.handleReaderKey(operation, fields))
        ?? answer(NFCAccessControlTypes.DEVICE_CREDENTIAL_KEY_REQUEST, NFCAccessControlTypes.DEVICE_CREDENTIAL_KEY_RESPONSE, fields => this.handleDeviceCredentialKey(operation, fields))
        ?? answer(NFCAccessControlTypes.ISSUER_KEY_REQUEST, NFCAccessControlTypes.ISSUER_KEY_RESPONSE, fields => this.handleIssuerKey(operation, fields))
        ?? Buffer.alloc(0)
    } catch {
      // a value which cannot be read is answered with nothing, as an unknown request is
    }

    if (JSON.stringify(this.state) !== before) {
      const state = this.getState()
      setTimeout(() => { // timeout this so any action won't be executed on sync to the HAP request
        // the state of this write, not the state at the time the timer fires: another write may have followed by then
        this.emit(NFCAccessManagementEvent.STATE_UPDATED, state)
      }, 0).unref()
    }

    return response.toString('base64')
  }

  /**
   * @returns the answers to one reader key request, without the type of the response around them
   */
  private handleReaderKey(operation: number | undefined, fields: Record<number, Buffer>): Buffer[] {
    const readerKey = this.state.readerKey
    const answer = (status: NFCAccessResponseStatus) => [
      tlv.encode(ReaderKeyResponseTypes.STATUS_CODE, status),
    ]

    switch (operation) {
      case NFCAccessOperation.LIST:
        // a lock without a reader key answers with nothing
        return readerKey
          ? [
              tlv.encode(ReaderKeyResponseTypes.IDENTIFIER, Buffer.from(readerKey.identifier, 'hex')),
            ]
          : []
      case NFCAccessOperation.ADD: {
        const type = fields[ReaderKeyRequestTypes.TYPE]
        const privateKey = fields[ReaderKeyRequestTypes.KEY]
        if (!type || tlv.readVariableUIntLE(type) !== NFCAccessKeyType.NIST256 || privateKey?.length !== 32) {
          return answer(NFCAccessResponseStatus.NOT_SUPPORTED)
        }
        const identifier = NFCAccessManagement.keyIdentifier(privateKey).toString('hex')
        if (readerKey?.identifier === identifier) {
          return answer(NFCAccessResponseStatus.DUPLICATE)
        }
        this.state.readerKey = {
          identifier,
          privateKey: privateKey.toString('hex'),
          readerIdentifier: (fields[ReaderKeyRequestTypes.READER_IDENTIFIER] ?? Buffer.alloc(0)).toString('hex'),
        }
        return answer(NFCAccessResponseStatus.SUCCESS)
      }
      case NFCAccessOperation.REMOVE: {
        const wanted = fields[ReaderKeyRequestTypes.IDENTIFIER]?.toString('hex')
        if (!readerKey || (wanted !== undefined && wanted !== readerKey.identifier)) {
          return answer(NFCAccessResponseStatus.DOES_NOT_EXIST)
        }
        // without the reader key the device credential keys open nothing, so they go with it
        this.state.readerKey = undefined
        this.state.deviceCredentialKeys = []
        return answer(NFCAccessResponseStatus.SUCCESS)
      }
      default:
        return []
    }
  }

  /**
   * @returns the answers to one device credential key request, without the type of the response around them
   */
  private handleDeviceCredentialKey(operation: number | undefined, fields: Record<number, Buffer>): Buffer[] {
    const issuerKeyIdentifier = fields[DeviceCredentialKeyRequestTypes.ISSUER_KEY_IDENTIFIER]
    const answer = (status: NFCAccessResponseStatus) => [
      Buffer.concat([
        ...(issuerKeyIdentifier
          ? [
              tlv.encode(DeviceCredentialKeyResponseTypes.ISSUER_KEY_IDENTIFIER, issuerKeyIdentifier),
            ]
          : []),
        tlv.encode(DeviceCredentialKeyResponseTypes.STATUS_CODE, status),
      ]),
    ]

    switch (operation) {
      case NFCAccessOperation.LIST:
        return this.state.deviceCredentialKeys.map(key => Buffer.concat([
          tlv.encode(DeviceCredentialKeyResponseTypes.IDENTIFIER, Buffer.from(key.identifier, 'hex')),
          tlv.encode(DeviceCredentialKeyResponseTypes.ISSUER_KEY_IDENTIFIER, Buffer.from(key.issuerKeyIdentifier, 'hex')),
          tlv.encode(DeviceCredentialKeyResponseTypes.STATUS_CODE, NFCAccessResponseStatus.SUCCESS),
        ]))
      case NFCAccessOperation.ADD: {
        const type = fields[DeviceCredentialKeyRequestTypes.TYPE]
        const publicKey = fields[DeviceCredentialKeyRequestTypes.KEY]
        if (!type || tlv.readVariableUIntLE(type) !== NFCAccessKeyType.NIST256 || publicKey?.length !== 64 || !issuerKeyIdentifier) {
          return answer(NFCAccessResponseStatus.NOT_SUPPORTED)
        }
        const identifier = createHash('sha1').update(Buffer.concat([
          Buffer.from([0x04]),
          publicKey,
        ])).digest().subarray(0, 6).toString('hex')
        if (this.state.deviceCredentialKeys.some(key => key.identifier === identifier)) {
          return answer(NFCAccessResponseStatus.DUPLICATE)
        }
        const state = fields[DeviceCredentialKeyRequestTypes.STATE]
        const active = !state || tlv.readVariableUIntLE(state) === NFCAccessKeyState.ACTIVE
        const suspended = this.state.deviceCredentialKeys.filter(key => !key.active).length
        if (this.state.deviceCredentialKeys.length >= this.maximumDeviceCredentialKeys
          || (!active && suspended >= this.maximumSuspendedDeviceCredentialKeys)) {
          return answer(NFCAccessResponseStatus.OUT_OF_RESOURCES)
        }
        this.state.deviceCredentialKeys.push({
          identifier,
          publicKey: publicKey.toString('hex'),
          issuerKeyIdentifier: issuerKeyIdentifier.toString('hex'),
          active,
        })
        return answer(NFCAccessResponseStatus.SUCCESS)
      }
      case NFCAccessOperation.REMOVE: {
        // which identifier the Home app sends is not confirmed, so the full public key is accepted too
        const wanted = fields[DeviceCredentialKeyRequestTypes.IDENTIFIER]?.toString('hex')
        const index = wanted === undefined
          ? -1
          : this.state.deviceCredentialKeys.findIndex(key => key.identifier === wanted || key.publicKey === wanted)
        if (index < 0) {
          return answer(NFCAccessResponseStatus.DOES_NOT_EXIST)
        }
        this.state.deviceCredentialKeys.splice(index, 1)
        return answer(NFCAccessResponseStatus.SUCCESS)
      }
      default:
        return []
    }
  }

  /**
   * @returns the answers to one issuer key request, without the type of the response around them
   */
  private handleIssuerKey(operation: number | undefined, fields: Record<number, Buffer>): Buffer[] {
    const answer = (status: NFCAccessResponseStatus, identifier?: string) => [
      Buffer.concat([
        ...(identifier
          ? [
              tlv.encode(IssuerKeyResponseTypes.IDENTIFIER, Buffer.from(identifier, 'hex')),
            ]
          : []),
        tlv.encode(IssuerKeyResponseTypes.STATUS_CODE, status),
      ]),
    ]

    switch (operation) {
      case NFCAccessOperation.LIST:
        return this.state.issuerKeys.map(key => Buffer.concat([
          tlv.encode(IssuerKeyResponseTypes.IDENTIFIER, Buffer.from(key.identifier, 'hex')),
          tlv.encode(IssuerKeyResponseTypes.STATUS_CODE, NFCAccessResponseStatus.SUCCESS),
        ]))
      case NFCAccessOperation.ADD: {
        const type = fields[IssuerKeyRequestTypes.TYPE]
        const publicKey = fields[IssuerKeyRequestTypes.KEY]
        if (!type || tlv.readVariableUIntLE(type) !== NFCAccessKeyType.ED25519 || publicKey?.length !== 32) {
          return answer(NFCAccessResponseStatus.NOT_SUPPORTED)
        }
        const identifier = NFCAccessManagement.keyIdentifier(publicKey).toString('hex')
        if (this.state.issuerKeys.some(key => key.identifier === identifier)) {
          return answer(NFCAccessResponseStatus.DUPLICATE, identifier)
        }
        if (this.state.issuerKeys.length >= this.maximumIssuerKeys) {
          return answer(NFCAccessResponseStatus.OUT_OF_RESOURCES, identifier)
        }
        this.state.issuerKeys.push({
          identifier,
          publicKey: publicKey.toString('hex'),
        })
        return answer(NFCAccessResponseStatus.SUCCESS, identifier)
      }
      case NFCAccessOperation.REMOVE: {
        const wanted = fields[IssuerKeyRequestTypes.IDENTIFIER]?.toString('hex')
        const index = this.state.issuerKeys.findIndex(key => key.identifier === wanted)
        if (index < 0) {
          return answer(NFCAccessResponseStatus.DOES_NOT_EXIST, wanted)
        }
        this.state.issuerKeys.splice(index, 1)
        return answer(NFCAccessResponseStatus.SUCCESS, wanted)
      }
      default:
        return []
    }
  }

  private setupServiceHandlers() {
    this.nfcAccessService.getCharacteristic(Characteristic.NFCAccessSupportedConfiguration)
      .updateValue(Buffer.concat([
        tlv.encode(NFCAccessSupportedConfigurationTypes.MAXIMUM_ISSUER_KEYS, this.maximumIssuerKeys),
        tlv.encode(NFCAccessSupportedConfigurationTypes.MAXIMUM_SUSPENDED_DEVICE_CREDENTIAL_KEYS, this.maximumSuspendedDeviceCredentialKeys),
      ]).toString('base64'))

    // Kept at 0, as the plugin homebridge-fake-homekey does, which works with the Home app.
    // AccessCodeManagement counts up instead. Which of the two the Home app needs is not confirmed.
    this.nfcAccessService.getCharacteristic(Characteristic.ConfigurationState)
      .updateValue(0)

    this.nfcAccessService.getCharacteristic(Characteristic.NFCAccessControlPoint)
      .onSet(value => this.handleControlPointWrite(value as string))
      .updateValue('')
  }
}
