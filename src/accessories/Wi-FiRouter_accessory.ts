import { Accessory, AccessoryEventTypes, Categories, Service, uuid, VoidCallback } from '../index.js'

const UUID = uuid.generate('hap-nodejs:accessories:wifi-router')
export const accessory = new Accessory('Wi-Fi Router', UUID)

accessory.category = Categories.ROUTER

accessory.on(AccessoryEventTypes.IDENTIFY, (_paired: boolean, callback: VoidCallback) => {
  console.log('Identify the \'%s\'', accessory.displayName)
  callback()
})

accessory.addService(Service.WiFiRouter)
