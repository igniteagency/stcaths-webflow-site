/**
 * Injects the BugHerd script only on webflow.io staging domains
 */
function initBugHerd() {
  const siteAPIKey = '';

  // Only load on webflow.io domains
  if (window.location.hostname.includes('webflow.io')) {
    window
      .loadExternalScript(
        `https://www.bugherd.com/sidebarv2.js?apikey=${siteAPIKey}`,
        'body',
        false
      )
      .then(() => {
        console.log('BugHerd script loaded successfully');
      })
      .catch((error) => {
        console.error('Failed to load BugHerd script:', error);
      });
  }
}

window.addEventListener('load', () => {
  initBugHerd();
});
