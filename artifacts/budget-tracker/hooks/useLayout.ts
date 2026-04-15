import { useWindowDimensions, Platform } from "react-native";

export type LayoutMode = "mobile" | "desktop";

export function useLayout(): { mode: LayoutMode; width: number; height: number } {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const mode: LayoutMode = isWeb && width >= 768 ? "desktop" : "mobile";
  return { mode, width, height };
}
