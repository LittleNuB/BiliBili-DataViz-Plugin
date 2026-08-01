export const REQUIRED_BUILD_ENTRY_FILES = Object.freeze([
  'dashboard.js',
  'popup.js',
  'popup/index.html',
]);

export function collectManifestEntryFiles(manifest) {
  const entries = new Set();

  addEntry(entries, manifest.background?.service_worker);
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const script of contentScript.js ?? []) {
      addEntry(entries, script);
    }
  }

  addEntry(entries, manifest.action?.default_popup);
  addEntry(entries, manifest.options_page);
  addEntry(entries, manifest.options_ui?.page);
  addEntry(entries, manifest.side_panel?.default_path);
  addEntry(entries, manifest.devtools_page);

  for (const page of Object.values(manifest.chrome_url_overrides ?? {})) {
    addEntry(entries, page);
  }
  for (const page of manifest.sandbox?.pages ?? []) {
    addEntry(entries, page);
  }
  for (const resourceGroup of manifest.web_accessible_resources ?? []) {
    for (const resource of resourceGroup.resources ?? []) {
      if (isConcreteWebAccessibleResource(resource)) {
        addEntry(entries, resource);
      }
    }
  }

  return [...entries].sort();
}

export function getRequiredReleaseEntryFiles(manifest) {
  return [...new Set([
    ...collectManifestEntryFiles(manifest),
    ...REQUIRED_BUILD_ENTRY_FILES,
  ])].sort();
}

function addEntry(entries, value) {
  if (typeof value === 'string' && value.length > 0) {
    entries.add(value.replaceAll('\\', '/'));
  }
}

function isConcreteWebAccessibleResource(value) {
  return typeof value === 'string' && !value.includes('*');
}
