// Push when a job ends (src/push.js sends it through Expo). Apple-login users have no LINE chat, so this is how
// their result reaches them while the app is closed. Tapping the notification opens that job.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router, type Href } from "expo-router";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let sent = false;
// Tells the server this phone's push address. With `ask`, asks for permission first (at the moment it makes sense:
// starting a job); without it, only phones that already allowed notifications are registered. Never throws.
export async function registerPush({ ask = false } = {}) {
  if (sent) return;
  try {
    if (!ask && (await Notifications.getPermissionsAsync()).status !== "granted") return;
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "ผลงาน", importance: Notifications.AndroidImportance.DEFAULT });
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId; // set by `eas init`
    if (!projectId) return; // shortcut: no EAS project yet, so no Expo push token; run `eas init` before TestFlight
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const r = await api("POST", "/api/push", { token: data });
    sent = r.ok;
  } catch {
    // simulators and phones without Google Play services have no push: results still show in the app
  }
}

export function openJobFromPush() {
  const go = (n: Notifications.Notification) => {
    const id = Number(n.request.content.data?.jobId);
    if (id) router.push(`/job/${id}` as Href);
  };
  const last = Notifications.getLastNotificationResponse(); // the app was opened from a notification
  if (last) go(last.notification);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => go(r.notification));
  return () => sub.remove();
}
