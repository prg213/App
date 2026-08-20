export type UpdateFailureKind = 'permission' | 'storage' | 'installer';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnknownSourcePermissionError(error: unknown): boolean {
  // Keep this deliberately narrow. Fire OS can describe unrelated installer
  // failures as "not allowed to install"; sending someone to an already
  // enabled Unknown Apps setting in that case cannot fix the problem.
  return /unknown sources|unknown apps|request_install_packages|canrequestpackageinstalls/i.test(
    errorMessage(error),
  );
}

function isInsufficientStorageError(error: unknown): boolean {
  return /insufficient storage|not enough space|storage full|install_failed_insufficient_storage/i.test(
    errorMessage(error),
  );
}

export function classifyUpdateFailure(error: unknown): UpdateFailureKind {
  if (isUnknownSourcePermissionError(error)) return 'permission';
  if (isInsufficientStorageError(error)) return 'storage';
  return 'installer';
}