/**
 * Use in the `default` branch of a `switch` over a discriminated union so that
 * adding a new union member without handling it is a compile error, not a
 * silent fallthrough.
 */
export function assertNever(value: never): never {
  throw new Error(`Unreachable case: ${JSON.stringify(value)}`);
}
