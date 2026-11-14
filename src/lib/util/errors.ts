/** Returns the message of a thrown value: its `message` when that is a string, otherwise the value as a string. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

/** Returns the stack of a thrown value when it has one as a string, otherwise undefined. */
export function errorStack(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string') {
    return error.stack
  }
  return undefined
}
