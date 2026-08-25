const fs = require('fs');
const path = require('path');
const {
  createRunOncePlugin,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultMedia3LivePlayer';
const JAVA_PACKAGE = 'com.prg213.streamvault.media3';
const FFMPEG_AAR_NAME = 'media3-decoder-ffmpeg-1.9.2.aar';

function copyBridgeSources(projectRoot) {
  const sourceRoot = path.join(projectRoot, 'native', 'media3');
  const destinationRoot = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...JAVA_PACKAGE.split('.'),
  );
  fs.mkdirSync(destinationRoot, { recursive: true });
  const expectedSources = new Set([
    'StreamVaultMedia3Package.java',
    'StreamVaultMedia3ViewManager.java',
    'StreamVaultMedia3View.java',
    'StreamVaultMedia3ControlModule.java',
    'StreamVaultMedia3Session.java',
  ]);
  for (const entry of fs.readdirSync(destinationRoot)) {
    if (entry.endsWith('.java') && expectedSources.has(entry)) {
      fs.unlinkSync(path.join(destinationRoot, entry));
    }
  }
  for (const entry of fs.readdirSync(sourceRoot)) {
    if (!entry.endsWith('.java')) continue;
    fs.copyFileSync(path.join(sourceRoot, entry), path.join(destinationRoot, entry));
  }
}

function copyOptionalFfmpegExtension(projectRoot, platformProjectRoot) {
  const source = path.join(projectRoot, 'native', 'media3', FFMPEG_AAR_NAME);
  if (!fs.existsSync(source)) return false;

  const destination = path.join(platformProjectRoot, 'app', 'libs', FFMPEG_AAR_NAME);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

function withMedia3LivePlayer(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      copyBridgeSources(config.modRequest.projectRoot);
      copyOptionalFfmpegExtension(
        config.modRequest.projectRoot,
        config.modRequest.platformProjectRoot,
      );
      return config;
    },
  ]);

  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes('import com.prg213.streamvault.media3.StreamVaultMedia3Package')) {
      const importAnchor = /^import .+$/m;
      if (!importAnchor.test(contents)) {
        throw new Error(`${PLUGIN_NAME}: could not find a Kotlin import in MainApplication`);
      }
      contents = contents.replace(
        importAnchor,
        (match) => `${match}\nimport com.prg213.streamvault.media3.StreamVaultMedia3Package`,
      );
    }
    if (!contents.includes('add(StreamVaultMedia3Package())')) {
      const packageListAnchor = /PackageList\(this\)\.packages\.apply \{\s*/;
      if (!packageListAnchor.test(contents)) {
        throw new Error(`${PLUGIN_NAME}: could not find PackageList apply block in MainApplication`);
      }
      contents = contents.replace(
        packageListAnchor,
        (match) => `${match}          add(StreamVaultMedia3Package())\n`,
      );
    }
    config.modResults.contents = contents;
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(PLUGIN_NAME)) return config;
    const ffmpegAar = path.join(
      config.modRequest.projectRoot,
      'native',
      'media3',
      FFMPEG_AAR_NAME,
    );
    const ffmpegDependency = fs.existsSync(ffmpegAar)
      ? `\n    implementation(files("libs/${FFMPEG_AAR_NAME}"))`
      : '';
    config.modResults.contents = `${config.modResults.contents.trimEnd()}

// @generated begin ${PLUGIN_NAME} - do not modify
dependencies {
    implementation("androidx.media3:media3-exoplayer:1.9.2")
    implementation("androidx.media3:media3-exoplayer-hls:1.9.2")
    implementation("androidx.media3:media3-exoplayer-rtsp:1.9.2")
    implementation("androidx.media3:media3-ui:1.9.2")${ffmpegDependency}
}
// @generated end ${PLUGIN_NAME}
`;
    return config;
  });
}

module.exports = createRunOncePlugin(withMedia3LivePlayer, PLUGIN_NAME, '1.0.0');