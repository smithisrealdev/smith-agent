// Settings kept on this phone (as in the web app): big text, motion, pictures, theme. Plus consent and the order-box draft.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Appearance } from "react-native";
import { saved } from "./api";

export type Prefs = { big: boolean; motion: boolean; pictures: boolean; theme: "auto" | "light" | "dark" };
const DEFAULTS: Prefs = { big: false, motion: true, pictures: true, theme: "auto" };

type Ctx = {
  ready: boolean;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
};
const PrefsCtx = createContext<Ctx>({ ready: false, prefs: DEFAULTS, setPref: () => {}, consent: false, setConsent: () => {}, draft: "", setDraft: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [consent, setConsentState] = useState(false);
  const [draft, setDraftState] = useState("");
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    Promise.all([saved.get<Partial<Prefs>>("prefs"), saved.get<object>("consent"), saved.get<string>("draft")]).then(([p, c, d]) => {
      setPrefs({ ...DEFAULTS, ...p });
      setConsentState(Boolean(c));
      setDraftState(d || "");
      setReady(true);
    });
  }, []);
  useEffect(() => Appearance.setColorScheme?.(prefs.theme === "auto" ? "unspecified" : prefs.theme), [prefs.theme]);
  const value: Ctx = {
    ready,
    prefs,
    setPref: (k, v) => setPrefs((old) => {
      const next = { ...old, [k]: v };
      saved.set("prefs", next);
      return next;
    }),
    consent,
    setConsent: (v) => {
      setConsentState(v);
      saved.set("consent", v ? { at: new Date().toISOString() } : null);
    },
    draft,
    setDraft: (v) => {
      setDraftState(v);
      clearTimeout(draftTimer.current); // saved once typing pauses, not on every keystroke
      draftTimer.current = setTimeout(() => saved.set("draft", v || null), 400);
    },
  };
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}
export const usePrefs = () => useContext(PrefsCtx);
