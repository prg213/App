import fs from 'fs';
import path from 'path';
import { classifyUpdateFailure } from '@/services/updateInstallFailure';

const source = fs.readFileSync(
  path.resolve(__dirname, '../components/UpdateModal.tsx'),
  'utf8',
);
const failureSource = fs.readFileSync(
  path.resolve(__dirname, '../services/updateInstallFailure.ts'),
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
    expect(source).toContain("failureKind === 'permission'");
    expect(failureSource).toContain('unknown sources|unknown apps|request_install_packages|canrequestpackageinstalls');
    expect(failureSource).not.toContain('not allowed to install/i.test(');
    expect(source).toContain("'Try Again', onPress: installApk");
  });

  it('classifies only actual permission denials as unknown-app guidance', () => {
    expect(classifyUpdateFailure(new Error('REQUEST_INSTALL_PACKAGES denied'))).toBe('permission');
    expect(classifyUpdateFailure(new Error('installer not allowed to install this package'))).toBe('installer');
  });

  it('classifies storage failures for both download and installer staging', () => {
    expect(classifyUpdateFailure(new Error('INSTALL_FAILED_INSUFFICIENT_STORAGE'))).toBe('storage');
    expect(source).toContain('There is not enough free storage to download this update.');
    expect(source).toContain('There is not enough free storage to stage this update.');
  });
});