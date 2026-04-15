import { Platform } from "react-native";

export function getApiUrl(): string {
  if (Platform.OS === "web") {
    return "";
  }

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    const base = domain.startsWith("http") ? domain : `https://${domain}`;
    return base;
  }

  return "http://localhost:8080";
}
