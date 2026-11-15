import { describe, expect, it, vi } from 'vitest'

import { Accessory } from '../Accessory.js'
import { EventTriggerOption } from '../camera/index.js'
import * as uuid from '../util/uuid.js'
import { createCameraControllerOptions } from './CameraController.spec.js'
import { DoorbellController } from './DoorbellController.js'

import '../definitions/index.js'

describe('DoorbellController', () => {
  it('event trigger options', () => {
    const controller = new DoorbellController(createCameraControllerOptions())

    // @ts-expect-error: protected access
    const options = controller.retrieveEventTriggerOptions()
    expect([...options].sort()).toEqual([EventTriggerOption.MOTION, EventTriggerOption.DOORBELL])

    controller.constructServices()
    controller.configureServices()

    expect(controller.recordingManagement).toBeTruthy()
    // @ts-expect-error: private access
    expect(controller.recordingManagement.eventTriggerOptions).toEqual(3)
  })

  describe('ringDoorbell while the controller is not added to an accessory', () => {
    it('should warn instead of throwing before configureController', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const doorbell = new DoorbellController(createCameraControllerOptions())
        expect(() => doorbell.ringDoorbell()).not.toThrow()
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    })

    it('should warn instead of throwing after the controller was removed', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const accessory = new Accessory('Bell', uuid.generate('ring-after-removal'))
        const doorbell = new DoorbellController(createCameraControllerOptions())
        accessory.configureController(doorbell)
        accessory.removeController(doorbell)
        expect(() => doorbell.ringDoorbell()).not.toThrow()
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    })
  })
})
