# Change Log

All notable changes to `@homebridge/hap-nodejs` will be documented in this file. This project tries to adhere to [Semantic Versioning](http://semver.org/).

## v2.3.1 (Pending Release)

### ⚠️ Upgrade notes

- **For developers using TypeScript**: some types are stricter now, so a plugin may need small changes before it builds again. Plugins written in JavaScript are not affected.
  - The `context` of a characteristic change is `unknown`. Check it before reading from it, for example `if (typeof context === 'object' && context !== null && 'source' in context)`.
  - The fields of a HomeKit Data Stream message are `unknown`, and `DataStreamParser.decode()` returns `unknown`. Check a field before using it, for example `if (typeof message.streamId === 'number')`.
  - A data stream payload typed as an `interface` no longer fits `sendEvent`, `sendRequest` or `sendResponse`. Use a `type`, or pass a copy like `{ ...payload }`.
  - `SerializableController` without type arguments has saved data of type `unknown`. Name the type: `SerializableController<ControllerServiceMap, MyState>`.
  - `SiriAudioStreamProducerConstructor` without a type argument has options of type `unknown`. Name the type: `SiriAudioStreamProducerConstructor<MyOptions>`.
  - `tlv.encode()` only takes numbers, strings and Buffers (or lists of them). Wrap a `Uint8Array` in `Buffer.from()`.
  - `uuid.unparse()` only takes a Buffer with at least 16 bytes from the offset, and throws otherwise.
  - `RemoteController` and `SiriAudioSession` have a type argument for the options of the Siri audio producer, and `producerOptions` has that type (it was `any`). Name it when the options are checked: `new RemoteController<MyOptions>(MyProducer, options)`.
  - A data stream handler which names its own message type, like `(message: MyMessage) => ...`, no longer fits. Type the parameter as `HDSMessage` and check the fields.
  - `HAPStorage.storage().getItem<T>()` returns `T | undefined`. Without a type argument it is `any`, as before.
  - `IdentifierCache` lost its public `_savedCacheHash` field.
- **For developers**: every `const enum` is a normal `enum` now. Names are the same, and they can be used with `isolatedModules`. All values are the same except `DataFormatTags.INTEGER_RANGE_STOP_39`, which is now 47 (0x2F). It was 46, which was wrong.
- **For developers**: `addBridgedAccessory()` throws when an accessory with the same UUID is already bridged.
- **For developers**: `removeBridgedAccessory()` and `AdaptiveLightingController.handleControllerRemoved()` no longer remove the event listeners the plugin added to the accessory or the controller.
- **For developers**: a camera restored from the cache with `sensors.motion` or `sensors.occupancy` set to `true` now gets that sensor, which a camera saved without it was missing. If the accessory already has its own sensor of that type without a subtype, `configureController()` throws, as it does for a new accessory. Pass your sensor as `sensors.motion: service` instead, or remove it.
- **For developers**: a camera delegate now gets a STOP request after a START or RECONFIGURE it answered with an error.
- **For developers**: `setProps({ minStep })` with a step which is not a whole number, for a characteristic of an integer format, is ignored with a warning. Before, it was published, and the Home app could write a value like 21.5.
- **For developers**: a data stream `sendRequest()` or `sendResponse()` before the hello message throws an `HDSConnectionError`. A request which is still waiting when the connection closes is answered at once with an error, not after 10 seconds.
- **For users**: the files in the `persist` folder, which hold the pairing keys, are saved readable by their owner only. A backup tool which runs as another user can no longer read them. After a start as another user (like root with `sudo`), give the files back to the usual user, for example with `chown`. HAP-NodeJS says so in its error.
- **For users**: a file of HAP-NodeJS in the `persist` folder which does not hold valid JSON is renamed to `.<name>.corrupt-<time>` before a new one is saved in its place. Files of plugins in that folder are left alone.
- **For developers** importing files from `dist`: the example accessories (`dist/accessories/*_accessory.js`), the definitions generator and the `.d.ts.map` files are no longer part of the package.

### Changes

- docs: fix the api documentation link in the readme
- fix: let generate-definitions find and write the es module import paths
- feat: add the homekit definitions from apple's v891 metadata
- fix(advertiser): stop advertising an unpublished accessory while others share the ciao responder
- fix(advertiser): keep a restarted bonjour-hap advertisement and wait for the goodbye on destroy
- fix(advertiser): warn when a name with a dot is used with the bonjour-hap advertiser
- fix(advertiser): log a failed systemd-resolved update instead of crashing the process
- fix(advertiser): run systemd-resolved registrations one at a time so none is left behind
- fix(advertiser): register names with a slash or percent sign with systemd-resolved
- fix(advertiser): free the old avahi entry group before registering again
- fix(accessory): cancel a pending configuration update when the accessory is unpublished
- fix(datastream): encode integers that need more than 32 bits instead of throwing
- fix(accessory): report an invalid configuration change instead of throwing from a timer
- fix(camera): free a recording stream whose open response can not be sent instead of crashing
- fix(datastream): report an error of the data stream tcp server instead of crashing
- fix(datastream): decode the integer 39 instead of dropping the message
- fix(characteristic): accept the maximum of a float characteristic whose step does not divide evenly
- fix(characteristic): keep a write response of 0, false or an empty string
- fix(controller-storage): stop saving cleared controller data again after an earlier save
- fix(controller-storage): restore the stored data again on a second load in one process
- fix(storage): fail again instead of handing out an empty store after a failed init
- fix(characteristic): keep the error state when a client write is refused
- fix: restore a custom class named like a hap definition with its own uuid
- fix(server): answer a failed pair-setup M5 with state M6
- fix(server): answer a malformed JSON body with 400 and an invalid value status
- fix(server): answer a pairing request with a missing or malformed key with a pairing error
- fix(server): deliver events after stray bytes and hold them while a second request is answered
- fix(tlv): reject a truncated entry in decodeList instead of cutting it short
- fix(server): accept a prepare write request with pid 0 and refuse a pid that is not a number
- fix(accessory): refuse to bridge a second accessory with the same uuid
- fix(accessory): build the setup uri again when the accessory is published again
- fix(identifier-cache): keep the next accessory id when a bridge has no accessories for a while
- fix(characteristic): ignore a minStep of zero or less and list valid values without drift
- fix(adaptive-lighting): accept a context that is not an object on a manual color write
- fix(adaptive-lighting): stay active when the clock is set back before the start of the curve
- fix(adaptive-lighting): emit disable in manual mode when a malformed request turns it off
- fix(adaptive-lighting): keep the listeners of the plugin when the controller is removed
- fix(adaptive-lighting): accept a transition curve of a single entry
- fix(controller-storage): remove stored data a restored controller has no use for
- fix(remote): refuse a new target without a name or category before it is stored
- fix(remote): create or remove the siri services when a saved remote is restored
- fix(remote): send every queued siri audio frame when the stream opens and when it ends
- fix(remote): stop sending siri audio and stay closed after a packet could not be sent
- fix(remote): do not mark the remote as active when its active target is not configured
- fix(remote): ignore a siri audio message without a stream id while a session is starting
- fix(camera): turn the recording state off on a factory reset
- fix(camera): signal the end of a recording whose last packet has no data
- fix(camera): ignore a recording acknowledgment for another stream
- fix(camera): add a motion or occupancy sensor which was enabled for a saved camera
- fix(camera): leave the streaming options of the plugin unchanged
- fix(camera): ignore a prepared stream which arrives after its session has ended
- fix(camera): close the rtp proxy sockets when the proxy is destroyed while they are being bound
- fix(camera): read the rtp proxy ssrc from the right field and send controller rtcp to the server
- fix(camera): free the stream when the local address for the rtp proxy can not be found
- fix(camera): tell the delegate to stop a stream whose start or reconfigure failed
- fix(datastream): leave no handler or timer behind for a request which could not be sent
- fix(datastream): stop the timers and answer waiting requests when the socket closes
- fix(camera): answer a snapshot request for a camera without streams instead of throwing
- fix(datastream): answer a request named like an inherited object property as unhandled
- fix(characteristic): refuse a client write of a number which is not whole to an integer format
- fix(characteristic): keep the value of a string characteristic which is given no string
- fix(camera): keep the SRTP keys of a stream out of the debug log
- build: stop publishing the example accessories and the definitions generator
- fix(hap-status-error): let it be subclassed and name it HapStatusError
- fix(characteristic): word the too short model or serial number warning without the warning type
- fix(characteristic): copy the props in replaceBy instead of sharing them
- fix(characteristic): leave the object passed to setProps unchanged
- fix(accessory): keep the listeners of the plugin when a bridged accessory is removed
- test: assert on two displayName checks which had no matcher and enforce it with the lint rule
- ci: let the discord announcement run by dropping the check on a job which does not exist
- fix(accessory-info): count an admin once when the same pairing is added again
- fix(controller-storage): drop a queued save when the accessory is destroyed
- chore(lint): allow const enums in the lint config instead of in 136 disable comments
- chore(lint): allow typed event interfaces in the lint config instead of in 28 disable comments
- refactor: add helpers to read the message and stack of a caught value
- refactor(model): type caught errors as unknown in the accessory model
- refactor(server): type caught errors as unknown in the server and the advertisers
- refactor(camera): type caught errors as unknown in the camera code
- refactor(datastream): type caught errors as unknown in the data stream server
- refactor(controller): type caught errors as unknown in the remote and adaptive lighting controllers
- refactor: type caught errors as unknown everywhere by dropping useUnknownInCatchVariables: false
- refactor(advertiser): type the D-Bus call helpers instead of using any
- refactor(storage): type stored controller data as unknown instead of any
- refactor(storage): type the file storage's internal values as unknown instead of any
- fix(camera): reject a selected recording configuration which is not a string as an invalid value
- fix(remote): reject target control and audio configuration writes which are not a string
- fix(datastream): reject a data stream setup write which is not a string as an invalid value
- refactor(datastream): drop a ts-expect-error and a non-null assertion in the data stream management
- refactor(accessory): replace any, ts-expect-error and needless non-null assertions with real types
- refactor(service): drop three ts-expect-error and four needless non-null assertions
- refactor(characteristic): drop a needless non-null assertion on the instance id
- refactor(server): type the list of pairings sent to a controller instead of using any
- refactor(utils): type the event arguments in awaitEventOnce as unknown instead of any
- refactor(utils): build the cloned object without any
- refactor(utils): drop the Node 18 numeric address family checks and their ts-expect-error
- refactor(camera): type the legacy SRTP options check instead of using any
- refactor(camera): close the recording generator without a ts-expect-error
- refactor(storage): type the saved accessory info and drop two ts-expect-error
- refactor(advertiser): drop two needless non-null assertions in the ciao advertiser
- refactor(camera): drop two needless non-null assertions in the stream management
- refactor(controller): drop needless non-null assertions in the adaptive lighting controller
- refactor(controller): drop needless non-null assertions in the camera controller
- refactor(remote): drop needless non-null assertions in the remote controller
- refactor(datastream): drop needless non-null assertions in the data stream server
- refactor(definitions): type the plist data in the generator and drop eleven ts-expect-error
- refactor(types): add the missing optional metadata fields to PartialCharacteristicReadDataValue
- refactor(characteristic): keep editor suggestions for the format and unit of characteristic props
- refactor(advertiser): let an advertiser return a promise from destroy and updateAdvertisement
- refactor(storage): let getItem name the type of the stored value
- refactor(datastream): add the HDSMessage type and use it for data stream messages
- refactor(camera): use the HDSMessage type in the recording management
- refactor(remote): use the HDSMessage type in the remote controller
- fix(tlv): type the further arguments of encode and reject a type which is not a number
- fix(uuid): refuse to read a uuid from a buffer which is too short or from a string
- refactor(server): type the pairing state of a connection as PairingStates instead of number
- docs(uuid): describe the errors of unparse in a way typedoc accepts
- refactor(characteristic): type the context of a characteristic change as unknown instead of any
- refactor(accessory): check the context of a characteristic change with a type guard
- refactor(controller): type the saved data of a serializable controller as unknown by default
- refactor(remote): let a plugin name the type of its siri audio producer options
- fix(camera): check the type of data stream message fields before the recording stream uses them
- fix(remote): check the type of data stream message fields before the remote controller uses them
- fix(datastream): type data stream message values as unknown and drop malformed messages
- perf(server): skip the stack trace for each listener change when its debug namespace is off
- perf(accessory): skip hashing the whole identifier cache on a save when no id changed
- perf(core): read the library version from package.json only once
- refactor(characteristic): count listeners with listenerCount instead of copying the listener list
- fix(core): let the process exit while a slow read, adaptive lighting, recording or idle timer waits
- fix(datastream): store a decoded dictionary key named __proto__ instead of replacing the prototype
- fix(datastream): refuse a terminator tag which does not end an array or a dictionary
- fix(datastream): refuse a message with arrays or dictionaries nested more than 32 levels deep
- fix(datastream): keep a data stream server usable after destroy was called before it started
- fix(camera): do not prepare a stream for a session which ended while its proxy sockets were bound
- fix(examples): merge the given options into the gstreamer audio producer instead of crashing
- fix(examples): list the targets of the apple tv remote example instead of an empty object
- refactor(examples): export the example accessories as es modules and drop the dead Core.js fields
- refactor(model): turn the const enums of accessory, service and characteristic into normal enums
- refactor(server): turn the const enums of the server, advertiser and connection into normal enums
- refactor(camera): turn the const enums of the camera code into normal enums
- refactor(datastream): turn the const enums of the data stream code into normal enums
- refactor(controller): turn the const enums of the controllers and access control into normal enums
- refactor(types): turn the const enums in types.ts and internal-types.ts into normal enums
- refactor(definitions): turn the last const enums into normal enums and drop three ts-expect-error
- test: check that every module loads on its own now that no const enum is left
- build: forbid new const enums in the lint config and drop the preserveConstEnums option
- docs(server): fix spelling mistakes in comments and messages
- docs(model): fix spelling mistakes in comments and messages
- docs(camera): fix spelling mistakes in comments and messages
- docs(datastream): fix spelling mistakes in comments and messages
- docs(controller): fix spelling mistakes in comments and messages
- docs: fix spelling mistakes in the remaining comments and messages
- docs(server): fix comments which are wrong or name functions that no longer exist
- docs(model): fix comments which are wrong or name things that no longer exist
- docs(camera): fix two comments which name a wrong sample rate and a wrong method
- docs(datastream): fix a comment which says encryption where it means decryption
- docs(controller): fix comments and docs which no longer match the code
- docs(examples): fix three comments which name the wrong value in the light example
- refactor(server): drop the unused request parameter of the pairing steps and a catch variable
- fix(crypto): stop naming node 10 in the error for a missing chacha20-poly1305 cipher
- refactor(camera): drop a branch which can never run and a repeated assignment of the proxy port
- refactor(datastream): drop writer branches which can never run and a commented-out debug block
- refactor(controller): drop the remote controller's request handler field which was never set
- refactor(definitions): drop a leftover variable and an unused parameter in the generator
- test: restore names in test titles which a lint autofix had lower-cased and drop commit hashes
- docs(readme): add install, node.js version and es module notes and drop the intel edison mentions
- docs(typedoc): hide the default export so the api documentation lists everything only once
- docs(typedoc): stop a text line after a group tag creating a second adaptive lighting group
- docs(typedoc): drop the stale MulticastOptions entry from the typedoc config
- fix(core): log the start of the library under the debug name HAP-NodeJS:Init, not Advertiser
- build: set moduleResolution to NodeNext like module and drop three options which are defaults now
- build: drop the importHelpers option which does nothing at target ES2022
- build: stop shipping declaration maps which point at source files the package does not hold
- chore: drop the stale maintainers field from package.json
- ci: pin the wiki notification action to a commit
- fix(datastream): answer the sessions which wait for the port when the server is destroyed too early
- fix(camera): keep the endpoints response of the active stream when another controller is told busy
- perf(datastream): join the chunks of an incoming frame once instead of again for every chunk
- fix(camera): reject the rtp proxy setup once every port failed to bind instead of trying for ever
- fix(controller): read the adaptive lighting update and notify intervals by the length that was sent
- fix(controller): unref the release timer of a pushed remote button and cancel it on removal/reset
- test(tv): add a spec for the access control management of televisions and speakers
- fix(tv): send the access control events with the values of their own write, not a later one
- refactor(controller): import the camera controller from its own file so it loads on its own
- fix(server): name the accessory and the port in the error when the hap server can not start
- fix(accessory): stop a controller reading or writing an accessory excluded for invalid permissions
- fix(accessory): end the event subscriptions of clients to a removed service or characteristic
- fix(model): warn with the file path when a storage file does not hold valid json
- fix(accessory): stop publish writing the advertiser it chose into the publish info of the caller
- refactor: mark members which replace an inherited one with override and turn on noImplicitOverride
- refactor: return undefined in the open on every code path and turn on noImplicitReturns
- refactor: prefix parameters which are never read with an underscore and turn on noUnusedParameters
- refactor: import types with import type and turn on the consistent-type-imports lint rule
- fix(types): export PairingStates so a plugin can name the type of the pairing state of a connection
- chore(deps): replace futoin-hkdf with the hkdf of node.js and remove unused packages
- ci: keep the npm publish token to the publish job, stay on npm 11 and pass refs as env
- ci: pin the third-party actions to a commit
- fix(storage): save the persist files, which hold the pairing keys, readable by their owner only
- fix(controller): cap an adaptive lighting update interval past 24.8 days, not update every 1 ms
- fix(characteristic): cut an over-long string without splitting an emoji in half
- fix(storage): set a persist file with invalid json aside instead of overwriting it
- ci: name the labeler job labeler, not stale
- ci: fix the labeler comment that says alpha pull requests get the beta label
- fix(storage): leave a persist file which is not json alone until hap-nodejs saves or removes it
- fix(service): answer /accessories with an error instead of crashing on a bad characteristic
- fix(server): hold events until a request which arrived during a stalled event loop is answered
- fix(server): refuse an add pairing request whose permission or public key is malformed
- test: restore the name of the PUT /prepare test which a lint autofix had lower-cased
- fix(storage): type getItem without a type argument as any again so typed plugin code still builds
- fix(camera): ignore a late error answer for a stream session which already ended
- fix(camera): answer a stream setup in proxy mode for a camera without audio instead of failing
- fix(doorbell): warn instead of throwing when the doorbell rings while it is not on an accessory
- fix(accessory): keep tlv8 values, which can hold the camera stream keys, out of the debug log
- fix(camera): answer a stream setup with an error when the plugin gives no error and no response
- refactor(camera): drop three error answers which are overwritten by the session reset at once
- fix(datastream): stop handing on the messages of a chunk once a handler closed the connection
- fix(datastream): throw a data stream error for a message on a connection not identified yet
- fix(datastream): catch an error of a response handler on the timeout of its request
- fix(datastream): reject a data stream setup write with a missing entry as an invalid value
- perf(datastream): hold an incomplete frame in one growing buffer instead of a list of its chunks
- docs(datastream): fix two comments about request ids and what sendRequest answers
- fix(remote): forget every target of a data stream connection which closed, not only the first
- fix(remote): cap the time of pushAndReleaseButton so a long one does not release after 1 ms
- fix(adaptive-lighting): refuse a transition curve of fewer than two entries, keep the running one
- docs(accessory): say which controllers keep the event handlers of the plugin on removeController
- fix(characteristic): ignore a minStep which is not a whole number for an integer format
- fix(storage): say how to fix a persist file which the user can not read, like one saved with sudo
- fix: stop publish() when unpublish() or destroy() is called while it checks the advertiser
- fix(pair-setup): mix the setup code verifier into the one-time srp key
- fix(pair-setup): drop the srp session from the connection once pair-setup ends
- feat(lock): add AccessCodeManagement for the keypad codes of the Access Code service

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.4.0`
- `bonjour-hap` @ `v3.11.0`

## v2.3.0 (2026-11-01)

### ⚠️ Upgrade notes

- **For developers** importing single files from `dist/lib` instead of the package itself: `dist/lib/Service.js` and `dist/lib/Characteristic.js` no longer attach the definitions (like `Service.Lightbulb` or `Characteristic.On`) when they are loaded on their own. Import from `@homebridge/hap-nodejs` as normal and nothing changes.
- **Node.js 22 users** need `v22.12.0` or newer. Node.js 24 and 26 are unchanged. This is the first Node.js 22 release that can `require()` an ES module, and the upstream `dbus-native` package needs it too.
- **HAP-NodeJS is now an ES module.** Importing it works as before, including `import hap from '@homebridge/hap-nodejs'`. CommonJS code can still `require('@homebridge/hap-nodejs')`, on the Node.js versions above.

### Changes

- fix: ignore state changes reported while a controller is being restored (#1133) (@seydx)
- perf: use the native crypto of Node.js for Curve25519 and Ed25519 (#1135) (@StefanRiese)
- chore: update hap characteristics and services
- chore(deps): dependency updates
- chore(deps): switch from the @homebridge/dbus-native fork back to upstream dbus-native
- fix: warn only once per address when a connection's local interface can't be found (#1131)
- fix(datastream): stop a stray unidentified frame from crashing the process
- fix(datastream): drop malformed frame payloads instead of crashing the process
- fix(datastream): destroy closed sockets when the remote never closes its side
- fix(camera): reject malformed SetupEndpoints writes before marking the stream busy
- fix(camera): answer SetupEndpoints with an error when the prepared stream response is invalid
- fix(camera): keep RTP proxy sockets open and only log errors after they are bound
- fix(datastream): decode binary data of up to 32 bytes instead of dropping it
- fix(datastream): make back-references follow the OPACK rule so reader and writer agree
- perf(datastream): stop allocating an unused buffer for every received frame
- fix(datastream): answer requests that have no handler instead of leaving them unanswered
- fix(remote): read target configurations from the Map they are stored in
- fix(remote): remove a whole target when the request lists no buttons
- fix(remote): don't crash when a delayed button release fails
- fix(remote): stop the Siri audio producer when the stream is refused
- fix(adaptive-lighting): forget the saved curve position when a new curve arrives
- fix(adaptive-lighting): keep Adaptive Lighting on when a control point request is rejected
- fix(color-utils): stop rounding the shared color temperature lookup table in place
- fix(adaptive-lighting): guard the curve maths against zero-length segments and NaN
- fix(check-name): accept names that are a single letter or number
- docs(uuid): say that unparse reads 16 bytes, not 8
- fix(accessory): unlink controller storage when a bridged accessory is removed
- fix(accessory): report slow and timed out handlers through the bridged accessory
- fix(accessory): track the primary service of a restored accessory
- fix(controller-storage): stop saving restored controller data again after it was cleared
- fix(accessory): drop client event registrations when a bridged accessory is removed
- fix(accessory): answer an Identify write of false instead of letting it time out
- fix(accessory): handle a paired identify without a set listener on the Identify characteristic
- fix(characteristic): reject instead of throwing when a legacy callback supplies an illegal value
- fix(characteristic): recompute the configuration number when setProps is called after publish
- refactor(accessory): share the read and write timeout handling and answer an empty write at once
- fix(server): answer a malformed request URL with 400 instead of crashing
- fix(server): only accept the proxy socket on the internal loopback HTTP server
- fix(server): wait for the whole HTTP response before writing event notifications
- fix(server): cap the size of request bodies, with a lower limit before pair-verify
- fix(crypto): keep a frame whose length header arrived split across two TCP packets
- fix(server): refuse pair-verify on a connection that is already verified
- fix(server): answer /pairings requests with an unexpected state or method
- fix(server): check idle connections again when the first one reaches the idle time
- fix(server): limit the timed write ttl, unref its timer and clear it when the connection closes
- fix(advertiser): warn about a system D-Bus connection error instead of crashing
- fix(tlv): reject a truncated entry in decodeWithLists instead of cutting it short
- fix(server): skip an event notification whose events were all unregistered
- fix(server): log the listener count from before the removal in HAPConnection.off()
- fix(accessory): compare a pairing's public key byte for byte instead of as text
- refactor: load the service and characteristic definitions without an import cycle
- test: migrate from jest to vitest
- chore(lint): switch to the @antfu/eslint-config rules used by homebridge
- chore: raise the minimum Node.js 22 version to 22.12.0
- feat: migrate the package to an ES module
- fix: stop a failed read or write throwing "HAPStatus is not defined" in the ES module build
- docs: regenerate docs for `v2.3.0`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.4.0`
- `bonjour-hap` @ `v3.11.0`

## v2.2.3 (2026-08-22)

### Changes

- ci: rename the pr-labeler caller job from stale to label
- fix: stop one accessory's invalid permissions taking down the whole bridge (#1129)
- chore(deps): dependency updates

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.12`
- `@homebridge/dbus-native` @ `v0.7.9`
- `bonjour-hap` @ `v3.10.5`

## v2.2.2 (2026-08-15)

### Changes

- feat: log a debug line when the accessory configuration number increments
- fix: hash a canonical form of the configuration so array reordering cannot increment c#
- docs: regenerate docs for `v2.2.2`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.12`
- `@homebridge/dbus-native` @ `v0.7.9`
- `bonjour-hap` @ `v3.10.5`

## v2.2.1 (2026-08-15)

### Changes

- refactor: drop the doubled advertiser check in the configuration-update debounce
- fix: close the exists-then-unlink gap when removing a storage key
- chore(deps): dependency updates
- docs: regenerate docs for `v2.2.1`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.12`
- `@homebridge/dbus-native` @ `v0.7.9`
- `bonjour-hap` @ `v3.10.5`

## v2.2.0 (2026-08-08)

### ⚠️ Goodbye `node-persist`

- The long-unmaintained `node-persist` dependency has been replaced with a minimal file storage (#1125, thanks @tim-fin).
- **For users**: no action needed.
  - The on-disk format is unchanged — existing pairings and accessory data are read exactly as before, nothing is migrated or rewritten
  - Writes are now atomic: an interrupted write (power loss, crash) can no longer leave behind a corrupted file that loses your pairings
  - HAP-NodeJS now also warns at startup if the storage directory is not writable, instead of failing with an obscure error later
- **For developers** using `HAPStorage.storage()` directly: the returned object now only implements the methods HAP-NodeJS itself uses — `initSync`, `getItem`, `setItemSync` and `removeItemSync`. Everything else from the old `node-persist` API now throws a clear error explaining this change. Also note:
  - `initSync({ dir })` now requires an absolute path — `node-persist` silently redirected relative paths into `node_modules`, where the data was lost on the next install
  - Keys must be plain filenames — no slashes, no leading dot
- `getItem(key, callback)` (the legacy callback form) throws — use the plain `getItem(key)`
  - <details>
    <summary>Full list of removed methods:</summary>

    - `setOptions`
    - `init`
    - `key`
    - `keys`
    - `length`
    - `forEach`
    - `values`
    - `valuesWithKeyMatch`
    - `setItem`
    - `getItemSync`
    - `removeItem`
    - `clear[Sync]`
    - `persist[Sync]`
    - `persistKey[Sync]`
    - `removePersistedKey[Sync]`
    - `parseString`
    - `parseTTLDir[Sync]`
    - `parseDataDir[Sync]`
    - `parseDir[Sync]`
    - `parseDataFile[Sync]`
    - `parseTTLFile[Sync]`
    - `parseFile[Sync]`
    - `isExpired`
    - `resolveDir`
    - `stopInterval`
    - `log`
  </details>

### Changes

- fix: replace node-persist with minimal in-repo file storage (#1125) (@tim-fin)
- Update for NodeJS 26 (@NorthernMan54)
- feat: warn when the persist directory is not writable, instead of failing obscurely at publish (#1028)
- chore(deps): dependency updates
- docs: regenerate docs for `v2.2.0`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.10`
- `@homebridge/dbus-native` @ `v0.7.7`
- `bonjour-hap` @ `v3.10.4`

## v2.1.9 (2026-07-18)

### Changes

- fix: test harness rewritten around a connection-owning HAP client, removing the axios dependency (#1122) (@hjdhjd)
- chore(ci): bump actions/setup-node to v7
- chore: dependency updates
- docs: regenerate docs for `v2.1.9`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.10`
- `@homebridge/dbus-native` @ `v0.7.7`
- `bonjour-hap` @ `v3.10.4`

## v2.1.8 (2026-07-11)

### Changes

- test: work around Node free-socket data guard in HAP HTTP client
- chore: dependency updates
- chore: update `actions/checkout` to `v7`
- chore: added `deprecate-past-pre-releases` workflow
- chore: update hap characteristics and services
- docs: regenerate docs for `v2.1.8`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.10`
- `@homebridge/dbus-native` @ `v0.7.7`
- `bonjour-hap` @ `v3.10.4`

## v2.1.7 (2026-05-26)

### Changes

- chore: dependency updates
- chore: drop local @types shims, use upstream bonjour-hap types
- chore(ci): bump release workflow action versions
- test: cover encrypted data length validation in pair handlers
- test: cover required TLV field validation in pairing handlers
- test: cover RTP proxy setup rejection handling
- test: cover SEQUENCE_NUM presence check in pair handlers
- test: cover M1 reset prevention in pair-setup
- test: cover safe accessory lookups in slow/timeout warnings
- test: cover aid.iid format validation
- test: cover camera stream start TLV parsing guards
- test: cover error argument in pairing debug logs
- test: cover constant-time pincode comparison
- test: cover characteristic warning message for non-Error throws
- fix: improve HomeKit `Name` characteristic validation (#1119) (@n0rt0nthec4t)
- docs: regenerate docs for `v2.1.7`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.9`
- `@homebridge/dbus-native` @ `v0.7.6`
- `bonjour-hap` @ `v3.10.3`

## v2.1.6 (2026-05-08)

### Changes

- fix: defer `ControllerStorage` construction until UUID is set
- chore: route HKSV diagnostics through `HAP-NodeJS:HKSV` namespace
- chore: dependency updates

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.8`
- `@homebridge/dbus-native` @ `v0.7.5`
- `bonjour-hap` @ `v3.10.2`

## v2.1.5 (2026-05-05)

### Changes

- fix: drop `ConfiguredName` HIG warning
- chore: dependency updates

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.8`
- `@homebridge/dbus-native` @ `v0.7.5`
- `bonjour-hap` @ `v3.10.2`

## v2.1.4 (2026-05-04)

### Changes

- chore: dependency updates
- docs: regenerate typedoc docs

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.8`
- `@homebridge/dbus-native` @ `v0.7.5`
- `bonjour-hap` @ `v3.10.2`

## v2.1.3 (2026-04-26)

### Changes

- fix: int32 range check in `DataStreamParser`
- fix: `readFloat64LE` missing reader index advance
- fix: utf-8 tag using char count not byte length
- fix: validate encrypted data length before crypto split
- fix: validate required TLV fields in pairing handlers
- fix: unhandled `Promise.all` rejection in RTP proxy setup
- fix: missing `SEQUENCE_NUM` check in pair handlers
- fix: prevent M1 resetting in-progress pair setup
- fix: TLV decoder missing length bounds validation
- fix: unsafe non-null assertions in accessory lookups
- fix: validate `aid.iid` format before parsing
- fix: unguarded buffer reads in camera stream TLV parsing
- fix: category defaulting to string instead of enum
- fix: missing error argument in pairing debug logs
- fix: use constant-time comparison for pincode checks
- fix: `"undefined"` string in characteristic error warnings
- fix: O(n²) buffer concat in encrypt/decrypt hot path
- chore: dependency updates, inc. `typescript`
- docs: regenerate typedoc docs

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.7`
- `@homebridge/dbus-native` @ `v0.7.4`
- `bonjour-hap` @ `v3.10.1`

## v2.1.2 (2026-03-29)

### Changes

- chore: update hap characteristics and services
- dependency updates
- regenerate documentation (`typedoc`) files

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.6`
- `@homebridge/dbus-native` @ `v0.7.4`
- `bonjour-hap` @ `v3.10.1`

## v2.1.1 (2026-03-21)

### Changes

- Improvement: HKSV recording stream AbortSignal support and graceful generator termination. (#1111) (@hjdhjd)
- dependency updates + fix code from new lint rules
- regenerate documentation (`typedoc`) files

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.5`
- `@homebridge/dbus-native` @ `v0.7.3`
- `bonjour-hap` @ `v3.10.0`

## v2.1.0 (2026-02-08)

### Changes

- update readme badges (use `shields.io`) (#1104)
- update publish workflows for npm oidc auth (#1105)
- dependency updates
- update hap characteristics and services
- regenerate documentation (`typedoc`) files

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.5`
- `@homebridge/dbus-native` @ `v0.7.3`
- `bonjour-hap` @ `v3.10.0`

## v2.0.2 (2025-09-17)

### Changes

- dependency updates
- code style - use `subarray` instead of `slice` for buffers
- fix types around buffers in test files
- update hap characteristics and services
- regenerate documentation (`typedoc`) files
- docs: remove unnecessary `@group` tags on interface declarations

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.4`
- `@homebridge/dbus-native` @ `v0.7.2`
- `bonjour-hap` @ `v3.9.1`

## v2.0.1 (2025-07-23)

### Changes

- dependency updates

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.4`
- `@homebridge/dbus-native` @ `v0.7.2`
- `bonjour-hap` @ `v3.9.1`

## v2.0.0 (2025-06-17)

### Breaking

- ⚠️ drop support for node v18
  - the minimum node version required is now `v20`
- ⚠️ republish as `@homebridge/hap-nodejs` for consistency

### Changes

- update `commander` from `v13` to `v14`
- Added support for NodeJS 24
- Update @homebridge/ciao to 1.3.3
- update `jest` to `v30` and required migration steps
- update `eslint` to `v9` and required migration steps

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.3`
- `@homebridge/dbus-native` @ `v0.7.1`
- `bonjour-hap` @ `v3.9.0`

## v1.2.0 (2025-06-08)

### Changes

- add constants for `SecuritySystemAlarmType` (#1086)
- update hk plist file from V=880 to V=886 (#1087)
- updated dependencies (#1085)
- fix OOC errors from `validateUserInput` on steps
- merge branch 'release-0.x' into latest
- fix some bad merge conflicts from previous commit
- updated dependencies, use included types from `dbus-native` (#1092)

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.2`
- `@homebridge/dbus-native` @ `v0.7.1`
- `bonjour-hap` @ `v3.8.0`

## v1.1.2 (2025-06-04)

*No changes since v1.1.1, just a version bump to trigger a new release.*

## v1.1.1 (2025-03-11)

### Changes

- Update name checking (#1083)

### Other Changes

- Update docs
- support node 22 + dependency updates (#1075)

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.0`
- `bonjour-hap` @ `v3.8.0`

## v1.1.0 (2024-07-21)

### Changes

- Set `Ciao` as the default Advertiser

### Other Changes

- Update docs
- Updated dependencies

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.0`
- `bonjour-hap` @ `v3.8.0`

## v1.0.0 (2024-07-10)

### Breaking Changes

- **The minimum Node.js version required is now `v18`.**
- **Important notice:** Because of the cleanup of the Deprecated code, you will need to migrate you code base.
    - Remove the long-deprecated init().
    - Deprecate Core, BridgedCore, legacy Camera characteristics. (#1058) (@hjdhjd)
        - For deprecated `Core` and `BridgedCore` see: https://github.com/homebridge/HAP-NodeJS/wiki/Deprecation-of-Core-and-BridgeCore
    - Legacy code deprecation cleanup. (#1059) (@hjdhjd)
        - For deprecated `storagePath` switch to `HAPStorage.setCustomStoragePath`, `AudioCodec` switch to `AudioStreamingCodec`, `VideoCodec` switch to `H264CodecParameters`,`StreamAudioParams` switch to `AudioStreamingOptions`, `StreamVideoParams` switch to `VideoStreamingOptions`,`cameraSource` switch to `CameraController`.
    - Others deprecated code to highlight removed: `useLegacyAdvertiser`, `AccessoryLoader`.
- Fix: Naming for Characteristic.ProgramMode has been corrected from `PROGRAM_SCHEDULED_MANUAL_MODE_` to `PROGRAM_SCHEDULED_MANUAL_MODE`

### Fixed

- Fix: Build Issues (#1041) (@NorthernMan54)
- Fix: Ensure data is only transmitted on open and ready connections. (#1051) (@hjdhjd)
- Fix: Ensure we check names using the full UTF-8 character set. (#1052) (@hjdhjd)
- Fix: ConfiguredName (#1049) (@donavanbecker)
- Fix: Manufacturer looking at checkName but should look at checkValue. (#1053) (@donavanbecker)

### Other Changes

- Implement warning messages for invalid characters in names (#1009) (@NorthernMan54)
- Mitigate event emitter "memory leak" warnings when a significant number of camera streaming events occur simultaneously (#1037) (@hjdhjd)
- AdaptiveLightingController fix & improvement (#1038) (@Shaquu)
- Minor fixes to recording logging and one change in logging. (#1040) (@hjdhjd)
- Bridged core and core cleanup (#1048) (@Shaquu)
- Increase snapshot handler warning timeout to 8000ms. (#1055) (@hjdhjd)
- Cleanup and refactor getLocalNetworkInterface and address a potential edge case. (#1056) (@hjdhjd)
- Correct log spacing
- Updated and fixed `typedoc` config file
- Updated dependencies

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.0`
- `bonjour-hap` @ `v3.8.0`

## v0.14.3 (2026-03-29)

### Changed

- dependency updates
- regenerate documentation for new version

## v0.14.2 (2026-03-21)

### Changed

- Improvement: HKSV recording stream AbortSignal support and graceful generator termination. (#1111) (@hjdhjd)
- dependency updates
- regenerate documentation for new version

## v0.14.1 (2026-02-07)

### Changed

- dependency updates
- update release script for oidc releases

## v0.14.0 (2025-10-29)

### Changed

- remove `treatWarningsAsErrors` flag from doc gen
- updated dependencies, fix `Buffer` types
- add node 24 to node engines in `package.json`

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.4`
- `bonjour-hap` @ `v3.9.1`

## v0.13.1 (2025-06-04)

*No changes since v0.13.0, just a version bump to trigger a new release.*

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.1`
- `bonjour-hap` @ `v3.9.0`

## v0.13.0 (2025-06-04)

### Changed

_Most of these commits have been backported from the `v1.x` track. None should be breaking changes._

- Mitigate event emitter "memory leak" warnings when a significant number of HomeKit camera streaming events occur simultaneously. (#1037)
- fix type issue and fix ts build issue
- Correct the formatting and presentation of some recording-related debug and error logging. (#1040)
- AdaptiveLightingController fix & improvement (#1038)
- Bridged core and core cleanup (#1048)
- correct log spacing
- fix: Ensure data is only transmitted on open and ready connections. (#1051)
- Increase snapshot handler warning timeout to 8000ms. (#1055)
- Cleanup and refactor `getLocalNetworkInterface` and address a potential edge case. (#1056)
- add constants for `SecuritySystemAlarmType` (#1086)
- update hk plist file from `V=880` to `V=886` (#1087)
- dependency updates, lint and repo maintenance
- fix OOC errors from `validateUserInput` on steps
- regenerate documentation for new version

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.1`
- `bonjour-hap` @ `v3.9.0`

## v0.12.3 (2024-10-26)

### Changed

- minor dependency update
- mark compatible with node v22
- fix `initWithServices` reference in typedoc

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.3.0`
- `bonjour-hap` @ `v3.8.0`

## v0.12.2 (2024-05-31)

### Changed

- Updated dependencies (`rimraf` and `@types/node`)
- Updated dependencies (`simple-plist`)
- Updated dependencies (`typescript`)

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.2.0`
- `@homebridge/dbus-native` @ `v0.6.0`

## v0.12.1 (2024-05-11)

### Changed

- Updated dependencies (`axios` and `commander`)

### Fixed

- Mitigate event emitter "memory leak" warnings when a significant number of HSV events occur simultaneously (#1029) (@hjdhjd)

### Other Changes

- Update Discord Webhooks to trigger only after published to npm

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.2.0`
- `@homebridge/dbus-native` @ `v0.6.0`

## v0.12.0 (2024-04-19)

### Changed

- Create `CHANGELOG.md` file
- Fix: typos + add logo to `README.md`
- Refresh `package-lock.json` (no major changes to dep versions)
- general repo updates
- add alpha releases
- dependency updates
- Fix: typedoc generation
- update homebridge dependencies
- regenerate docs

### Homebridge Dependencies

- `@homebridge/ciao` @ `v1.2.0`
- `@homebridge/dbus-native` @ `v0.6.0`
