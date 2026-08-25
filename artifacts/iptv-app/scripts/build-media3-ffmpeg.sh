#!/usr/bin/env bash
#
# Produces the AndroidX Media3 1.9.2 FFmpeg decoder extension from its official
# source tree. This runs in the EAS Android pre-install hook, before Expo
# prebuild invokes the config plugin that consumes the generated AAR.
set -euo pipefail

MEDIA3_VERSION="1.9.2"
ANDROIDX_MEDIA_REPOSITORY="https://github.com/androidx/media.git"
FFMPEG_REPOSITORY="https://git.ffmpeg.org/ffmpeg.git"
FFMPEG_REF="release/6.0"
MIN_ANDROID_API="21"
REQUIRED_ABIS=(armeabi-v7a arm64-v8a x86 x86_64)
# MPEG Layer II is the required IPTV compatibility decoder. Keep a small set of
# common stream-audio decoders alongside it for the same official extension.
ENABLED_DECODERS=(mp2 mp3 aac ac3 eac3 dca flac opus vorbis)

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/native/media3"
OUTPUT_AAR="${OUTPUT_DIR}/media3-decoder-ffmpeg-${MEDIA3_VERSION}.aar"
OUTPUT_METADATA="${OUTPUT_DIR}/media3-decoder-ffmpeg-${MEDIA3_VERSION}.json"
BUILD_ROOT="${PROJECT_ROOT}/.eas-build/media3-${MEDIA3_VERSION}"
ANDROIDX_CHECKOUT="${BUILD_ROOT}/androidx-media"
FFMPEG_CHECKOUT="${BUILD_ROOT}/ffmpeg"

if [[ "${EAS_BUILD_PLATFORM:-android}" != "android" ]]; then
  echo "Skipping Media3 FFmpeg extension: this is not an Android EAS build."
  exit 0
fi

fail() {
  echo "Media3 FFmpeg extension build failed: $*" >&2
  exit 1
}

for command in git unzip sha256sum; do
  command -v "${command}" >/dev/null || fail "required build command '${command}' is unavailable."
done

ANDROID_NDK_PATH="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
[[ -n "${ANDROID_NDK_PATH}" ]] || fail "ANDROID_NDK_HOME/ANDROID_NDK_ROOT is not set. Use an EAS Android image that includes NDK r26b or newer."
[[ -d "${ANDROID_NDK_PATH}" ]] || fail "Android NDK directory '${ANDROID_NDK_PATH}' does not exist."

ANDROID_SDK_PATH="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "${ANDROID_SDK_PATH}" ]] || fail "ANDROID_HOME/ANDROID_SDK_ROOT is not set. Use an EAS Android image with the Android SDK."
[[ -d "${ANDROID_SDK_PATH}" ]] || fail "Android SDK directory '${ANDROID_SDK_PATH}' does not exist."

if ! command -v cmake >/dev/null; then
  CMAKE_BIN="$(find "${ANDROID_SDK_PATH}/cmake" -type f -path '*/bin/cmake' 2>/dev/null | sort -V | tail -n 1 || true)"
  [[ -n "${CMAKE_BIN}" ]] || fail "CMake 3.21+ is unavailable in the EAS Android image."
  export PATH="$(dirname "${CMAKE_BIN}"):${PATH}"
fi
cmake --version | awk 'NR == 1 { print "Using " $0 }'

if [[ "${1:-}" == "--verify-environment" ]]; then
  echo "Media3 FFmpeg EAS prerequisites are available."
  exit 0
fi

rm -rf "${BUILD_ROOT}"
mkdir -p "${BUILD_ROOT}" "${OUTPUT_DIR}"

git clone --depth 1 --branch "${MEDIA3_VERSION}" "${ANDROIDX_MEDIA_REPOSITORY}" "${ANDROIDX_CHECKOUT}"
[[ "$(git -C "${ANDROIDX_CHECKOUT}" describe --tags --exact-match)" == "${MEDIA3_VERSION}" ]] \
  || fail "official AndroidX source checkout is not exactly tag ${MEDIA3_VERSION}."

git clone --depth 1 --branch "${FFMPEG_REF}" "${FFMPEG_REPOSITORY}" "${FFMPEG_CHECKOUT}"
[[ "$(git -C "${FFMPEG_CHECKOUT}" branch --show-current)" == "${FFMPEG_REF}" ]] \
  || fail "official FFmpeg source checkout is not exactly ${FFMPEG_REF}."

FFMPEG_JNI_DIR="${ANDROIDX_CHECKOUT}/libraries/decoder_ffmpeg/src/main/jni"
ln -s "${FFMPEG_CHECKOUT}" "${FFMPEG_JNI_DIR}/ffmpeg"

pushd "${FFMPEG_JNI_DIR}" >/dev/null
./build_ffmpeg.sh \
  "${ANDROIDX_CHECKOUT}/libraries/decoder_ffmpeg/src/main" \
  "${ANDROID_NDK_PATH}" \
  "linux-x86_64" \
  "${MIN_ANDROID_API}" \
  "${ENABLED_DECODERS[@]}"
popd >/dev/null

pushd "${ANDROIDX_CHECKOUT}" >/dev/null
./gradlew :libraries:decoder_ffmpeg:assembleRelease
popd >/dev/null

BUILT_AAR="$(find "${ANDROIDX_CHECKOUT}/libraries/decoder_ffmpeg/build/outputs/aar" -maxdepth 1 -name '*-release.aar' -print -quit)"
[[ -n "${BUILT_AAR}" ]] || fail "AndroidX Gradle did not produce a decoder_ffmpeg release AAR."

for abi in "${REQUIRED_ABIS[@]}"; do
  unzip -l "${BUILT_AAR}" | grep -q "jni/${abi}/" \
    || fail "official decoder AAR is missing required ${abi} native libraries."
done
unzip -p "${BUILT_AAR}" classes.jar >/dev/null \
  || fail "official decoder AAR does not contain a readable classes.jar."

cp "${BUILT_AAR}" "${OUTPUT_AAR}"
AAR_SHA256="$(sha256sum "${OUTPUT_AAR}" | awk '{print $1}')"
cat > "${OUTPUT_METADATA}" <<EOF
{
  "media3Version": "${MEDIA3_VERSION}",
  "androidxMediaRepository": "${ANDROIDX_MEDIA_REPOSITORY}",
  "androidxMediaTag": "${MEDIA3_VERSION}",
  "ffmpegRepository": "${FFMPEG_REPOSITORY}",
  "ffmpegRef": "${FFMPEG_REF}",
  "minimumAndroidApi": ${MIN_ANDROID_API},
  "abis": ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"],
  "enabledDecoders": ["mp2", "mp3", "aac", "ac3", "eac3", "dca", "flac", "opus", "vorbis"],
  "sha256": "${AAR_SHA256}"
}
EOF

echo "Built and verified official Media3 ${MEDIA3_VERSION} FFmpeg extension: ${OUTPUT_AAR}"