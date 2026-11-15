import type { VoidCallback } from '../index.js'

import { Accessory, AccessoryEventTypes, Categories, Characteristic, Service, uuid } from '../index.js'

const UUID = uuid.generate('hap-nodejs:accessories:wifi-satellite')
export const accessory = new Accessory('Wi-Fi Satellite', UUID)

accessory.category = Categories.ROUTER

accessory.on(AccessoryEventTypes.IDENTIFY, (_paired: boolean, callback: VoidCallback) => {
  console.log('Identify the \'%s\'', accessory.displayName)
  callback()
})

const satellite = accessory.addService(Service.WiFiSatellite)

satellite.getCharacteristic(Characteristic.WiFiSatelliteStatus)!
  .updateValue(Characteristic.WiFiSatelliteStatus.CONNECTED)
