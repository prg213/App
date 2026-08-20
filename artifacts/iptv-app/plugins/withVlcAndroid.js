const {
  createRunOncePlugin,
  withAppBuildGradle,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultVlcAndroid';

/**
 * LibVLC and React Native both bundle libc++_shared.so. LibVLC must retain
 * its copy or the player can crash at runtime, so remove React Native's copy
 * immediately before Android merges native libraries.
 *
 * The upstream VLC Expo plugin targets the Gradle anchor removed in Expo 57.
 * Appending this generated block at project scope works with the current
 * React Native Gradle template without relying on that obsolete anchor.
 */
function withVlcAndroid(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(PLUGIN_NAME)) {
      return config;
    }

    config.modResults.contents = `${config.modResults.contents.trimEnd()}

// @generated begin ${PLUGIN_NAME} - do not modify
tasks.configureEach { task ->
    if (task.name.contains("merge") && task.name.contains("NativeLibs")) {
        task.doFirst {
            def reactNativeDirectory = task.externalLibNativeLibs
                .getFiles()
                .find { file -> file.toString().contains("jetified-react-android") }

            if (reactNativeDirectory != null) {
                def nativeLibraries = java.nio.file.Files.walk(reactNativeDirectory.toPath())
                try {
                    nativeLibraries
                        .filter { file -> file.toString().endsWith("libc++_shared.so") }
                        .forEach { file -> java.nio.file.Files.deleteIfExists(file) }
                } finally {
                    nativeLibraries.close()
                }
            }
        }
    }
}
// @generated end ${PLUGIN_NAME}
`;

    return config;
  });
}

module.exports = createRunOncePlugin(withVlcAndroid, PLUGIN_NAME, '1.0.0');