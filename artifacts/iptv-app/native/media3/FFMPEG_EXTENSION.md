# Optional Media3 FFmpeg decoder extension

To enable MPEG Layer II/MP2 audio for Android and Fire TV IPTV streams, the EAS
Android pre-install hook builds the extension from the **official AndroidX
Media3 1.9.2 tag** and official FFmpeg `release/6.0` source.

`native/media3/media3-decoder-ffmpeg-1.9.2.aar`

The Expo plugin copies that artifact into the generated Android app and adds it
as a local Gradle dependency. The native bridge detects `FfmpegLibrary` at
runtime and reports the resulting capability to React.

The hook requires the `mp2` decoder and validates `armeabi-v7a`, `arm64-v8a`,
`x86`, and `x86_64` before the config plugin packages the artifact. Do not
substitute a third-party AAR or another Media3 version: Media3 does not publish
this extension to Maven Central, and its native FFmpeg libraries must match
both the Media3 version and the shipped Android ABIs.