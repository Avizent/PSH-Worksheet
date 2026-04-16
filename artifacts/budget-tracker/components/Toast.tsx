import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastCtx {
  show: (message: string, opts?: { kind?: ToastKind; durationMs?: number }) => void;
  showUndo: (message: string, opts: { onUndo: () => void; onTimeout: () => void; durationMs?: number }) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}

let _id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const [items, setItems] = useState<ToastItem[]>([]);
  const timeouts = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    setItems((s) => s.filter((t) => t.id !== id));
    const tm = timeouts.current.get(id);
    if (tm) { clearTimeout(tm); timeouts.current.delete(id); }
  }, []);

  const show = useCallback((message: string, opts?: { kind?: ToastKind; durationMs?: number }) => {
    const id = ++_id;
    const item: ToastItem = { id, message, kind: opts?.kind ?? "info" };
    setItems((s) => [...s, item]);
    const tm = setTimeout(() => remove(id), opts?.durationMs ?? (opts?.kind === "error" ? 5000 : 2800));
    timeouts.current.set(id, tm);
  }, [remove]);

  const showUndo = useCallback((message: string, opts: { onUndo: () => void; onTimeout: () => void; durationMs?: number }) => {
    const id = ++_id;
    const item: ToastItem = {
      id, message, kind: "info", actionLabel: "Undo",
      onAction: () => { opts.onUndo(); remove(id); },
    };
    setItems((s) => [...s, item]);
    const tm = setTimeout(() => { opts.onTimeout(); remove(id); }, opts.durationMs ?? 5000);
    timeouts.current.set(id, tm);
  }, [remove]);

  return (
    <Ctx.Provider value={{ show, showUndo }}>
      {children}
      <View pointerEvents="box-none" style={styles.host}>
        {items.map((t) => {
          const bg = t.kind === "error" ? colors.destructive : t.kind === "success" ? colors.success : colors.foreground;
          const fg = "#ffffff";
          return (
            <Animated.View key={t.id} style={[styles.toast, { backgroundColor: bg, ...(Platform.OS === "web" ? { boxShadow: "0 4px 18px rgba(0,0,0,0.18)" } : {}) }]}>
              <Feather name={t.kind === "error" ? "alert-circle" : t.kind === "success" ? "check-circle" : "info"} size={16} color={fg} />
              <Text style={[styles.msg, { color: fg }]} numberOfLines={2}>{t.message}</Text>
              {t.actionLabel && t.onAction && (
                <TouchableOpacity onPress={t.onAction} style={styles.actionBtn} activeOpacity={0.7}>
                  <Text style={[styles.actionText, { color: fg }]}>{t.actionLabel}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => remove(t.id)} style={styles.closeBtn} hitSlop={6} activeOpacity={0.7}>
                <Feather name="x" size={14} color={fg} />
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, bottom: 24, alignItems: "center", gap: 8, zIndex: 9999 },
  toast: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, maxWidth: 480, minWidth: 280 },
  msg: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.18)" },
  actionText: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  closeBtn: { padding: 2 },
});
