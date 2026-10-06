/** Brand image imports are embedded in the brand client bundle as data URLs. */
declare module '*.png' {
  const image: string
  export default image
}
