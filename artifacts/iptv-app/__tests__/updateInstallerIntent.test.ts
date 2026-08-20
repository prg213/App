import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../components/UpdateModal.tsx'),
  'utf8',
);

describe('in-app Android updater installer hand-off', () => {
  it('uses the package-installer action instead of the generic VIEW action', () => {
    expect(source).toContain("const INSTALL_PACKAGE_ACTION = 'android.intent.action.INSTALL_PACKAGE'");
    expect(source).toContain('startActivityAsync(INSTALL_PACKAGE_ACTION');
    expect(source).not.toContain("startActivityAsync('android.intent.action.VIEW'");
  });

  it('shares the downloaded APK through FileProvider with the installer read grant', () => {
    expect(source).toContain('getContentUriAsync(file.uri)');
    expect(source).toContain('const INSTALLER_FLAGS = 0x10000001');
    expect(source).toContain("const APK_MIME_TYPE = 'application/vnd.android.package-archive'");
  });

  it('shows unknown-app permission guidance only for a matching installer error', () => {
    expect(source).toContain('const permissionBlocked = isUnknownSourcePermissionError(e)');
    expect(source).toContain('permissionBlocked');
    expect(source).toContain("'Try Again', onPress: installApk");
  });
});