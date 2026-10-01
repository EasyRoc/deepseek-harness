/** CSS Modules compile to class-name maps; the client tsconfig has no CSS tooling. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
