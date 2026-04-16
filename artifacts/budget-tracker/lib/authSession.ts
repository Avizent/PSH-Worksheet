import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "user_session_token";

export async function saveSessionToken(token: string): Promise<void> {
  await AsyncStorage.setItem(KEY, token);
}

export async function getSessionToken(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function clearSessionToken(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
