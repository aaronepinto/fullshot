/**
 * Guards around the "debugger" permission. Chrome does not allow debugger to be
 * an optional permission, so it is declared as required in the Chrome manifest;
 * Firefox has no chrome.debugger API at all and its build strips the permission,
 * so every check must degrade to false instead of throwing there.
 */

export function debuggerAvailable(): boolean {
  return typeof chrome.debugger !== 'undefined';
}

export async function hasDebuggerPermission(): Promise<boolean> {
  if (!debuggerAvailable()) return false;
  try {
    return await chrome.permissions.contains({ permissions: ['debugger'] });
  } catch {
    return false;
  }
}

export async function requestDebuggerPermission(): Promise<boolean> {
  // The permission is granted at install in Chrome; this stays as the single
  // call site gate so a future packaging change only has to edit this module.
  return hasDebuggerPermission();
}
