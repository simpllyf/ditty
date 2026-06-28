/**
 * Back-compat shim. The pitch + scale primitives moved to `theory/`; this
 * re-exports them so existing imports of `./scale` keep working. New code should
 * import from `./theory/pitch` and `./theory/scales` directly.
 */
export * from "./theory/pitch";
export * from "./theory/scales";
