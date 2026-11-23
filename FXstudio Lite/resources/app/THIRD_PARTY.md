# Third-party components

## FFmpeg

VoxelMotion uses an unmodified FFmpeg command-line program to combine an exported effect with its selected sound. FFmpeg runs as a separate process.

The bundled Windows executable identifies itself as FFmpeg 6.1.1-essentials_build-www.gyan.dev. Its accompanying build information states GPL v3 and points to source code at https://github.com/FFmpeg/FFmpeg/commit/e38092ef93.

The original license and build/source information are included beside the executable:

- `resources/ffmpeg/LICENSE.txt`
- `resources/ffmpeg/BUILD-AND-SOURCE.txt`

The complete build configuration and source references supplied with that executable are preserved in `BUILD-AND-SOURCE.txt`.

## Other components

Electron, electron-updater and their dependency license files are distributed with the application. Minecraft-related textures, models, sound resources and the original effect implementation retain their existing third-party provenance; renaming this application does not transfer their ownership.
