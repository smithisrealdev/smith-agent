// app.json holds the real app. SMITH_PERSONAL_TEAM=1 builds a copy you can install on your own iPhone with a free
// Apple "Personal Team" (no paid Apple Developer Program):
//   SMITH_PERSONAL_TEAM=1 EXPO_PUBLIC_API_URL=http://<this Mac's IP>:3100 npx expo prebuild -p ios --clean
//   SMITH_PERSONAL_TEAM=1 EXPO_PUBLIC_API_URL=http://<this Mac's IP>:3100 npx expo run:ios --device --configuration Release
// A personal team can't sign Sign in with Apple or push, and the store bundle id stays free for the paid team,
// so that copy uses com.smithagent.app.dev (also registered on the LINE Login channel) and leaves both out.
// No team is set here on purpose: `expo run:ios` then picks this Mac's signing certificate and lets Xcode make the profile.
const fs = require("fs");
const path = require("path");
const { withFinalizedMod } = require("expo/config-plugins");
const plist = require("@expo/plist").default;

const PAID_ONLY = ["aps-environment", "com.apple.developer.applesignin"];

// Expo applies the plugins of installed packages (expo-notifications, expo-apple-authentication) even when they are not
// listed, and they add these entitlements; a finalized mod runs after all of them and takes the entitlements back out.
const withoutPaidEntitlements = (config) => withFinalizedMod(config, ["ios", async (c) => {
  const { platformProjectRoot, projectName } = c.modRequest;
  const file = path.join(platformProjectRoot, projectName, `${projectName}.entitlements`);
  if (fs.existsSync(file)) {
    const e = plist.parse(fs.readFileSync(file, "utf8"));
    for (const key of PAID_ONLY) delete e[key];
    fs.writeFileSync(file, plist.build(e));
  }
  return c;
}]);

module.exports = ({ config }) => {
  if (!process.env.SMITH_PERSONAL_TEAM) return config;
  return withoutPaidEntitlements({
    ...config,
    ios: { ...config.ios, bundleIdentifier: "com.smithagent.app.dev", usesAppleSignIn: false },
  });
};
