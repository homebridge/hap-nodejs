// here's a fake hardware device that we'll expose to HomeKit
import {
  Accessory,
  AccessoryEventTypes,
  Categories,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicValue,
  NodeCallback,
  Service,
  uuid, VoidCallback,
} from '../index.js'

const MOTION_SENSOR = {
  motionDetected: false,

  getStatus: () => {
    // set the boolean here, this will be returned to the device
    MOTION_SENSOR.motionDetected = false
  },
  identify: () => {
    console.log('Identify the motion sensor!')
  },
}

// Generate a consistent UUID for our Motion Sensor Accessory that will remain the same even when
// restarting our server. We use the `uuid.generate` helper function to create a deterministic
// UUID based on an arbitrary "namespace" and the word "motionsensor".
const motionSensorUUID = uuid.generate('hap-nodejs:accessories:motionsensor')

// This is the Accessory that we'll return to HAP-NodeJS that represents our fake motionSensor.
export const accessory = new Accessory('Motion Sensor', motionSensorUUID)

accessory.category = Categories.SENSOR

// set some basic properties (these values are arbitrary and setting them is optional)
accessory
  .getService(Service.AccessoryInformation)!
  .setCharacteristic(Characteristic.Manufacturer, 'Oltica')
  .setCharacteristic(Characteristic.Model, 'Rev-1')
  .setCharacteristic(Characteristic.SerialNumber, 'A1S2NASF88EW')

// listen for the "identify" event for this Accessory
accessory.on(AccessoryEventTypes.IDENTIFY, (_paired: boolean, callback: VoidCallback) => {
  MOTION_SENSOR.identify()
  callback() // success
})

accessory
  .addService(Service.MotionSensor, 'Fake Motion Sensor') // services exposed to the user should have "names" like "Fake Motion Sensor" for us
  .getCharacteristic(Characteristic.MotionDetected)!
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
    MOTION_SENSOR.getStatus()
    callback(null, Boolean(MOTION_SENSOR.motionDetected))
  })
