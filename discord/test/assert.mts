export function assert(condition: boolean | undefined, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
