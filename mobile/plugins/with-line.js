// The LINE SDK's own plugin (@xmartlabs/react-native-line) patches an AppDelegate shape that Expo SDK 58 no longer
// generates, so this does the same two things: its Info.plist entries, and hand LINE's return URL to the SDK.
const { withAppDelegate, withDangerousMod, withPlugins } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const withLineInfoPlist = require("@xmartlabs/react-native-line/plugin/ios/withCustomInfoPlist");

const OPEN_URL = `
  // LINE Login comes back to the app through its URL scheme (line3rdp.<bundle id>).
  public override func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    if LineLogin.application(app, open: url, options: options) {
      return true
    }
    return super.application(app, open: url, options: options)
  }
`;

const withLineAppDelegate = (config) => withAppDelegate(config, (c) => {
  let src = c.modResults.contents;
  if (!src.includes("import react_native_line")) src = src.replace(/(internal )?import Expo\n/, (m) => `${m}import react_native_line\n`);
  if (!src.includes("LineLogin.application")) src = src.replace(/(class AppDelegate[^{]*\{\n)/, `$1${OPEN_URL}`);
  c.modResults.contents = src;
  return c;
});

// Under the scene life cycle (Expo SDK 58, iOS 27) a returning URL arrives at the scene, not the app delegate.
const SCENE_URL = `
  override func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    let rest = URLContexts.filter { !LineLogin.application(UIApplication.shared, open: $0.url, options: [:]) }
    if !rest.isEmpty { super.scene(scene, openURLContexts: rest) }
  }
`;
const withLineScene = (config) => withDangerousMod(config, ["ios", (c) => {
  const file = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName, "SceneDelegate.swift");
  if (!fs.existsSync(file)) return c;
  let src = fs.readFileSync(file, "utf8");
  if (!src.includes("LineLogin")) {
    src = src.replace(/(internal )?import Expo\n/, (m) => `${m}import react_native_line\n`).replace(/(class SceneDelegate[^{]*\{\n)/, `$1${SCENE_URL}`);
    fs.writeFileSync(file, src);
  }
  return c;
}]);

module.exports = (config, props) => withPlugins(config, [[withLineInfoPlist, props], withLineAppDelegate, withLineScene]);
