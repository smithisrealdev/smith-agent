import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Prompt_400Regular, Prompt_500Medium, Prompt_600SemiBold } from "@expo-google-fonts/prompt";
import { Mitr_500Medium, Mitr_600SemiBold, Mitr_700Bold } from "@expo-google-fonts/mitr";
import { PrefsProvider, usePrefs } from "@/lib/prefs";
import { openJobFromPush } from "@/lib/push";
import { ToastHost } from "@/ui/kit";

SplashScreen.preventAutoHideAsync();

function Root() {
  const { ready, prefs } = usePrefs();
  const scheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({ Prompt_400Regular, Prompt_500Medium, Prompt_600SemiBold, Mitr_500Medium, Mitr_600SemiBold, Mitr_700Bold });
  const fonts = fontsLoaded || !!fontError; // a font that fails to load falls back to the system font rather than block the app
  useEffect(() => {
    if (ready && fonts) SplashScreen.hideAsync();
  }, [ready, fonts]);
  useEffect(() => (ready ? openJobFromPush() : undefined), [ready]);
  if (!ready || !fonts) return null;
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: prefs.motion ? "default" : "none", contentStyle: { backgroundColor: scheme === "dark" ? "#0B1020" : "#FFFFFF" } }}>
        <Stack.Screen name="settings" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.75, 1], sheetCornerRadius: 28 }} />
        <Stack.Screen name="live/[id]" options={{ animation: prefs.motion ? "fade_from_bottom" : "none" }} />
        <Stack.Screen name="welcome" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="login" options={{ animation: "fade", gestureEnabled: false }} />
      </Stack>
    </>
  );
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PrefsProvider>
          <ToastHost>
            <Root />
          </ToastHost>
        </PrefsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
