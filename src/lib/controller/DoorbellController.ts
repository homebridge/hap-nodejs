import type { Doorbell } from '../definitions/index.js'

import { EventTriggerOption } from '../camera/index.js'
import { Characteristic } from '../Characteristic.js'
import { Service } from '../Service.js'
import { CameraController, CameraControllerOptions, CameraControllerServiceMap } from './CameraController.js'
import { ControllerServiceMap } from './Controller.js'

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
    this.doorbellService!.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS)
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
