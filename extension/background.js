// Side panel host adapted from youtube-digest at bb2f7b1 (MIT; see THIRD_PARTY_NOTICES.md).
function isVideoTab(tab) {
  try {
    const url = new URL(tab.url || "");
    return url.hostname === "www.youtube.com" && url.pathname === "/watch" && !!url.searchParams.get("v");
  } catch { return false; }
}

async function configureTab(tab) {
  if (!tab?.id) return;
  if (isVideoTab(tab)) {
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: `sidepanel.html?tabId=${tab.id}`, enabled: true });
  } else await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") void configureTab(tab);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(configureTab).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.tabs.query({}).then((tabs) => Promise.all(tabs.map(configureTab))).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.tabs.query({}).then((tabs) => Promise.all(tabs.map(configureTab))).catch(() => {});
});
void chrome.tabs.query({}).then((tabs) => Promise.all(tabs.map(configureTab))).catch(() => {});
