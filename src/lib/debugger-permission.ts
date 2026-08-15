/**
 * Guards around the optional "debugger" permission. Firefox has no
 * chrome.debugger API and rejects the permission name outright, so every
 * check and request must degrade to false instead of throwing there.
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
  if (!debuggerAvailable()) return false;
  try {
    return await chrome.permissions.request({ permissions: ['debugger'] });
  } catch {
    return false;
  }
}
