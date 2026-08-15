/**
 * Transforms the Chrome MV3 manifest into its Firefox variant: Firefox runs MV3
 * backgrounds as event page scripts, does not know the "debugger" permission,
 * and requires a gecko add-on id for signing.
 */
export function toFirefoxManifest(manifest) {
  const out = structuredClone(manifest);
  out.background = { scripts: ['background.js'] };
  delete out.minimum_chrome_version;
  delete out.offline_enabled;
  if (Array.isArray(out.optional_permissions)) {
    out.optional_permissions = out.optional_permissions.filter((p) => p !== 'debugger');
    if (out.optional_permissions.length === 0) delete out.optional_permissions;
  }
  out.browser_specific_settings = {
    gecko: { id: 'fullshot@smollet.app', strict_min_version: '128.0' },
  };
  return out;
}
