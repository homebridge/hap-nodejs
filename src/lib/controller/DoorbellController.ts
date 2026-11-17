import type { Doorbell } from '../definitions/index.js'
import type { CameraControllerOptions, CameraControllerServiceMap } from './CameraController.js'
import type { ControllerServiceMap } from './Controller.js'

import { Buffer } from 'node:buffer'

import { EventTriggerOption } from '../camera/index.js'
import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import * as tlv from '../util/tlv.js'
import { CameraController } from './CameraController.js'

enum OperatingStateResponseTypes {
  STATE = 0x01,
  ABNORMAL_REASONS = 0x02,
}

/**
 * How well a doorbell is working, for {@link DoorbellController.setOperatingState}.
 *
 * @group Doorbell
 */
export enum DoorbellOperatingState {
  NORMAL = 0,
  LIMITED_FUNCTIONALITY = 1,
  SHUTDOWN_IMMINENT = 2,
}

/**
 * Why a doorbell is not working normally. The values are flags: several can be true at once.
 *
 * @group Doorbell
 */
export enum DoorbellOperatingStateAbnormalReason {
  OTHER = 1,
  LOW_TEMPERATURE = 2,
  HIGH_TEMPERATURE = 4,
}

/**
 * Builds the value of the Operating State Response characteristic of a doorbell service.
 * {@link DoorbellController.setOperatingState} does this for a doorbell made with the controller; use this
 * function for a doorbell service of your own.
 *
 * HomeKit does not document the characteristic. The layout comes from Apple's own HomeKit code.
 *
 * @example
 * ```ts
 * doorbellService.updateCharacteristic(Characteristic.OperatingStateResponse, encodeOperatingStateResponse(
 *   DoorbellOperatingState.LIMITED_FUNCTIONALITY,
 *   [DoorbellOperatingStateAbnormalReason.HIGH_TEMPERATURE],
 * ));
 * ```
 * @param state - how well the doorbell is working
 * @param abnormalReasons - why it is not working normally. Leave it out for {@link DoorbellOperatingState.NORMAL}.
 * @group Doorbell
 */
export function encodeOperatingStateResponse(state: DoorbellOperatingState, abnormalReasons: DoorbellOperatingStateAbnormalReason[] = []): string {
  const reasons = abnormalReasons.reduce((flags, reason) => flags | reason, 0)
  return Buffer.concat([
    tlv.encode(OperatingStateResponseTypes.STATE, state),
    ...(reasons
      ? [
          tlv.encode(OperatingStateResponseTypes.ABNORMAL_REASONS, reasons),
        ]
      : []),
  ]).toString('base64')
}

/**
 * Options which are additionally supplied for a {@link DoorbellController}.
 *
 * @group Doorbell
 */
export interface DoorbellOptions {
  /**
   * Name used for the {@link Service.Doorbell} service.
   */
  name?: string

  /**
   * This property may be used to supply an external {@link Service.Doorbell}.
   * This is particularly handy when one is migrating from an existing implementation
   * to a `DoorbellController` and wants to avoid losing the user's automations by removing and deleting the service.
   *
   * NOTE: You are responsible for managing the service yourself (e.g. creation, restoring, adding to accessory, ...)
   */
  externalDoorbellService?: Service
}

/**
 * The `DoorbellController` to efficiently manage doorbell implementations with HAP-NodeJS.
 *
 * NOTICE: We subclass from the {@link CameraController} here and deliberately do not introduce/set an
 * own/custom ControllerType for Doorbells, as Cameras and Doorbells are pretty much the same thing
 * and would collide otherwise.
 * As the possibility exists, both the CameraController and DoorbellController are written to support migration
 * from one to another. Meaning a serialized CameraController can be initialized as a DoorbellController
 * (on startup in {@link Controller.initWithServices}) and vice versa.
 *
 * @group Doorbell
 */
export class DoorbellController extends CameraController {
  private doorbellService?: Doorbell
  private doorbellServiceExternallySupplied = false
  /**
   * Temporary storage. Erased after init.
   */
  private doorbellOptions?: DoorbellOptions

  /**
   * Initializes a new `DoorbellController`.
   * @param options - The {@link CameraControllerOptions} and optional {@link DoorbellOptions}.
   */
  constructor(options: CameraControllerOptions & DoorbellOptions) {
    super(options)
    this.doorbellOptions = {
      name: options.name,
      externalDoorbellService: options.externalDoorbellService,
    }
  }

  /**
   * Call this method to signal a doorbell button press.
   */
  public ringDoorbell(): void {
    if (!this.doorbellService) {
      // a ring from a plugin event (a webhook, a push) can come before configureController or after the controller was
      // removed. Throwing here would end the process of a plugin which does not expect it
      console.warn('HAP-NodeJS WARNING: ringDoorbell() was called while the doorbell controller is not added to an accessory. The ring was ignored.')
      return
    }

    this.doorbellService.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS)
  }

  /**
   * Call this method to tell the Home app how well the doorbell is working, for example that it is too hot or
   * too cold to work fully. It sets the Operating State Response characteristic of the doorbell service, and adds
   * that characteristic on the first call.
   *
   * For a doorbell service which was not made with this controller, see {@link encodeOperatingStateResponse}.
   *
   * @example
   * ```ts
   * doorbellController.setOperatingState(DoorbellOperatingState.LIMITED_FUNCTIONALITY, [
   *   DoorbellOperatingStateAbnormalReason.HIGH_TEMPERATURE,
   * ]);
   *
   * // when it has cooled down
   * doorbellController.setOperatingState(DoorbellOperatingState.NORMAL);
   * ```
   * @param state - how well the doorbell is working
   * @param abnormalReasons - why it is not working normally. Leave it out for {@link DoorbellOperatingState.NORMAL}.
   */
  public setOperatingState(state: DoorbellOperatingState, abnormalReasons: DoorbellOperatingStateAbnormalReason[] = []): void {
    if (!this.doorbellService) {
      // as with ringDoorbell(): a call from a plugin event must not end the process of the plugin
      console.warn('HAP-NodeJS WARNING: setOperatingState() was called while the doorbell controller is not added to an accessory. The state was ignored.')
      return
    }

    this.doorbellService.updateCharacteristic(Characteristic.OperatingStateResponse, encodeOperatingStateResponse(state, abnormalReasons))
  }

  override constructServices(): CameraControllerServiceMap {
    if (this.doorbellOptions?.externalDoorbellService) {
      this.doorbellService = this.doorbellOptions.externalDoorbellService
      this.doorbellServiceExternallySupplied = true
    } else {
      this.doorbellService = new Service.Doorbell(this.doorbellOptions?.name ?? '', '')
    }
    this.doorbellService.setPrimaryService()

    const serviceMap = super.constructServices()
    if (!this.doorbellServiceExternallySupplied) {
      serviceMap.doorbell = this.doorbellService
    }
    return serviceMap
  }

  override initWithServices(serviceMap: CameraControllerServiceMap): void | CameraControllerServiceMap {
    const result = super._initWithServices(serviceMap)

    if (this.doorbellOptions?.externalDoorbellService) {
      this.doorbellService = this.doorbellOptions.externalDoorbellService
      this.doorbellServiceExternallySupplied = true

      if (result.serviceMap.doorbell) {
        delete result.serviceMap.doorbell
        result.updated = true
      }
    } else {
      this.doorbellService = result.serviceMap.doorbell

      if (!this.doorbellService) { // see NOTICE above
        this.doorbellService = new Service.Doorbell(this.doorbellOptions?.name ?? '', '')

        result.serviceMap.doorbell = this.doorbellService
        result.updated = true
      }
    }

    this.doorbellService.setPrimaryService()

    if (result.updated) {
      return result.serviceMap
    }
  }

  // eslint-disable-next-line unused-imports/no-unused-vars
  protected override migrateFromDoorbell(_serviceMap: ControllerServiceMap): boolean {
    return false
  }

  protected override retrieveEventTriggerOptions(): Set<EventTriggerOption> {
    const result = super.retrieveEventTriggerOptions()
    result.add(EventTriggerOption.DOORBELL)
    return result
  }

  override handleControllerRemoved(): void {
    super.handleControllerRemoved()

    this.doorbellService = undefined
  }

  override configureServices(): void {
    super.configureServices()

    this.doorbellService!.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .onGet(() => null) // a value of null represents nothing is pressed

    this.doorbellOptions = undefined
  }
}
