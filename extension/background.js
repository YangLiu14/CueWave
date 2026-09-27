// Side panel host adapted from youtube-digest at bb2f7b1 (MIT; see THIRD_PARTY_NOTICES.md).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !/^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url || "")) return;
  chrome.sidePanel.setOptions({ tabId: tab.id, path: "sidepanel.html", enabled: true });
  chrome.sidePanel.open({ tabId: tab.id });
});
