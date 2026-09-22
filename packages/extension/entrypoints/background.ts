import { connect } from "../lib/connection";

const KEEPALIVE_ALARM = "keepalive";
const KEEPALIVE_PERIOD_MINUTES = 0.5;

export default defineBackground(() => {
  connect();

  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      connect();
    }
  });

  console.log("[background] Claude in Chrome MCP service worker started");
});
