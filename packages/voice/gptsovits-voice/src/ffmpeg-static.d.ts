/**
 * Type surface for the `ffmpeg-static` package, which ships no bundled types:
 * its default export is the absolute path of the platform ffmpeg binary that
 * the package postinstall downloaded, or null when that download failed.
 */
declare module 'ffmpeg-static' {
  /** Absolute path of the bundled ffmpeg binary, or null when the platform build is absent. */
  const ffmpegPath: string | null
  export default ffmpegPath
}
