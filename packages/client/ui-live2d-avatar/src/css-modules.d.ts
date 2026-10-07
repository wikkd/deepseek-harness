/**
 * Client stylesheets compile to hashed class maps (lightningcss in the bundle
 * build); this declaration gives the TypeScript program the import shape.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
