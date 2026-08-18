chrome.runtime.onInstalled.addListener(() => {
  // The worker exists only so the CDP runner can verify the unpacked harness identity.
});
