/* global NodeJS */
import type { EventEmitter } from 'node:events'

/**
 * @group Utils
 */
export function PromiseTimeout(timeout: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, timeout)
  })
}

/**
 * @group Utils
 */
export function awaitEventOnce<Obj extends EventEmitter, Event extends string, T>(element: Obj, event: Event, timeout?: number): Promise<T>
/**
 * @group Utils
 */
export function awaitEventOnce<Obj extends EventEmitter, Event extends string>(element: Obj, event: Event, timeout?: number): Promise<void>
export function awaitEventOnce<Obj extends EventEmitter, Event extends string, T>(element: Obj, event: Event, timeout = 5000): Promise<void | T> {
  return new Promise<void | T>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout

    const resolveListener = (...args: unknown[]) => {
      clearTimeout(timeoutId)

      // the caller names the type of the event's payload: one argument resolves as itself, several as an array
      resolve(args.length
        ? (args.length === 1
            ? args[0]
            : args) as T
        : undefined)
    }

    timeoutId = setTimeout(() => {
      element.removeListener(event, resolveListener)
      reject(new Error(`awaitEventOnce for event ${event} timed out!`))
    }, timeout)

    element.once(event, resolveListener)
  })
}
