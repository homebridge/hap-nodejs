import type { AccessControl } from '../definitions/index.js'

import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'

import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import * as tlv from '../util/tlv.js'

enum AccessControlTypes {
  PASSWORD = 0x01,
  PASSWORD_REQUIRED = 0x02,
}

/**
 * This defines the Access Level for TVs and Speakers. It is pretty much only used for the AirPlay 2 protocol
 * so this information is not really useful.
 *
 * @group Television
 */
export enum AccessLevel {
  // noinspection JSUnusedGlobalSymbols
  /**
   * This access level is set when the user selects "Anyone" or "Anyone On The Same Network"
   * in the Access Control settings.
   */
  ANYONE = 0,
  /**
   * This access level is set when the user selects "Only People Sharing this Home" in the
   * Access Control settings.
   * On this level password setting is ignored.
   * Requests to the HAPServer can only come from Home members anyway, so there is no real use to it.
   * This is pretty much only used for the AirPlay 2 protocol.
   */
  HOME_MEMBERS_ONLY = 1,

  // 2 seems to be also a valid value in the range, but never encountered it.
  // so don't know what's the use of it.
}

/**
 * @group Television
 */
export enum AccessControlEvent {
  ACCESS_LEVEL_UPDATED = 'update-control-level',
  PASSWORD_SETTING_UPDATED = 'update-password',
}

export declare interface AccessControlManagement {
  on(event: 'update-control-level', listener: (accessLevel: AccessLevel) => void): this
  on(event: 'update-password', listener: (password: string | undefined, passwordRequired: boolean) => void): this

  emit(event: 'update-control-level', accessLevel: AccessLevel): boolean
  emit(event: 'update-password', password: string | undefined, passwordRequired: boolean): boolean
}

/**
 * @group Television
 */
export class AccessControlManagement extends EventEmitter {
  private readonly accessControlService: AccessControl

  /**
   * The current access level set for the Home
   */
  private accessLevel: AccessLevel = 0

  private passwordRequired = false
  private password?: string // kept when passwordRequired = false, but getPassword() does not return it then

  /**
   * Instantiates a new AccessControlManagement.
   *
   * @param {boolean} password - if set to true the service will listen for password settings
   */
  constructor(password?: boolean)
  /**
   * Instantiates a new AccessControlManagement.
   *
   * @param {boolean} password - if set to true the service will listen for password settings
   * @param {AccessControl} service - supply your own instance to sideload the AccessControl service
   */
  constructor(password?: boolean, service?: AccessControl)
  constructor(password?: boolean, service?: AccessControl) {
    super()

    this.accessControlService = service || new Service.AccessControl()
    this.setupServiceHandlers(password)
  }

  /**
   * @returns the AccessControl service
   */
  public getService(): AccessControl {
    return this.accessControlService
  }

  /**
   * @returns the current {@link AccessLevel} configured for the Home
   */
  public getAccessLevel(): AccessLevel {
    return this.accessLevel
  }

  /**
   * @returns the current password configured for the Home or `undefined` if no password is required.
   */
  public getPassword(): string | undefined {
    return this.passwordRequired ? this.password : undefined
  }

  /**
   * This destroys the AccessControlManagement.
   * It unregisters all GET or SET handlers it has associated with the given AccessControl service.
   * It removes all event handlers which were registered to this object.
   */
  public destroy(): void {
    this.removeAllListeners()

    this.accessControlService.getCharacteristic(Characteristic.AccessControlLevel).removeOnSet()
    if (this.accessControlService.testCharacteristic(Characteristic.PasswordSetting)) {
      this.accessControlService.getCharacteristic(Characteristic.PasswordSetting).removeOnSet()
    }
  }

  private handleAccessLevelChange(value: number) {
    this.accessLevel = value
    setTimeout(() => { // timeout this so any action won't be executed on sync to the HAP request
      // the value of this write, not the state at the time the timer fires: another write may have followed by then
      this.emit(AccessControlEvent.ACCESS_LEVEL_UPDATED, value)
    }, 0).unref()
  }

  private handlePasswordChange(value: string) {
    const data = Buffer.from(value, 'base64')
    const objects = tlv.decode(data)

    const password = objects[AccessControlTypes.PASSWORD]?.toString('utf8')
    const passwordRequired = !!objects[AccessControlTypes.PASSWORD_REQUIRED][0]

    this.password = password
    this.passwordRequired = passwordRequired

    setTimeout(() => { // timeout this so any action won't be executed on sync to the HAP request
      // the values of this write, not the state at the time the timer fires: another write may have followed by then
      this.emit(AccessControlEvent.PASSWORD_SETTING_UPDATED, password, passwordRequired)
    }, 0).unref()
  }

  private setupServiceHandlers(enabledPasswordCharacteristics?: boolean) {
    this.accessControlService.getCharacteristic(Characteristic.AccessControlLevel)
      .onSet(value => this.handleAccessLevelChange(value as number))
      .updateValue(0)

    if (enabledPasswordCharacteristics) {
      this.accessControlService.getCharacteristic(Characteristic.PasswordSetting)
        .onSet(value => this.handlePasswordChange(value as string))
        .updateValue('')
    }
  }
}
