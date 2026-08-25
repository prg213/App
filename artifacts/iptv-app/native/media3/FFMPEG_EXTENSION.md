# Optional Media3 FFmpeg decoder extension

To enable MPEG Layer II/MP2 audio for Android and Fire TV IPTV streams, place
the **license-approved, ABI-complete** Media3 1.9.2 FFmpeg decoder AAR at:

`native/media3/media3-decoder-ffmpeg-1.9.2.aar`

The Expo plugin copies that artifact into the generated Android app and adds it
as a local Gradle dependency. The native bridge detects `FfmpegLibrary` at
runtime and reports the resulting capability to React.

Do not substitute a random Maven artifact or a differently-versioned AAR:
Media3 does not publish this extension to Maven Central, and its native FFmpeg
libraries must match both the Media3 version and the shipped Android ABIs.