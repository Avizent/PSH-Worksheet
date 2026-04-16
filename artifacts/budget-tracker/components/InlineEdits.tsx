import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export const COST_STATUSES = ["Fixed Cost", "Variable", "Planned", "Booked"];

export function statusColor(status: string, colors: ReturnType<typeof useColors>) {
  switch (status) {
    case "Fixed Cost": return { bg: colors.primary + "15", fg: colors.primary };
    case "Variable": return { bg: colors.accent + "20", fg: colors.accent };
    case "Planned": return { bg: colors.warning + "20", fg: colors.warning };
    case "Booked": return { bg: colors.success + "20", fg: colors.success };
    default: return { bg: colors.border, fg: colors.foreground };
  }
}

export function nextStatus(s: string) {
  const i = COST_STATUSES.indexOf(s);
  return COST_STATUSES[(i + 1) % COST_STATUSES.length];
}

export function InlineText({ value, onSave, colors, style, textStyle, placeholder }: {
  value: string; onSave: (v: string) => void; colors: ReturnType<typeof useColors>;
  style?: any; textStyle?: any; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  React.useEffect(() => { setVal(value); }, [value]);

  if (editing) {
    return (
      <TextInput
        autoFocus
        value={val}
        onChangeText={setVal}
        onBlur={() => { setEditing(false); if (val !== value) onSave(val); }}
        onSubmitEditing={() => { setEditing(false); if (val !== value) onSave(val); }}
        style={[inlineStyles.input, { color: colors.foreground, borderColor: colors.primary }, style]}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
      />
    );
  }
  return (
    <TouchableOpacity onPress={() => setEditing(true)} activeOpacity={0.6} style={style}>
      <Text style={[{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }, textStyle]} numberOfLines={1}>{value || placeholder || "—"}</Text>
    </TouchableOpacity>
  );
}

export interface PickerOption { value: string; label: string; color?: string }

export function PickerCell({ value, options, onSelect, colors, style, placeholder, withDots, allowNew, newLabel, onCreateNew, freeTextFallback }: {
  value: string | null; options: PickerOption[]; onSelect: (v: string) => void;
  colors: ReturnType<typeof useColors>; style?: any; placeholder: string; withDots?: boolean;
  allowNew?: boolean; newLabel?: string; onCreateNew?: (v: string) => void;
  freeTextFallback?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newVal, setNewVal] = useState("");
  const current = options.find((o) => o.value === value);

  // Free-text fallback when no options exist (e.g., owners registry empty)
  if (freeTextFallback && options.length <= 1) {
    return (
      <InlineText
        value={value ?? ""}
        onSave={(v) => onSelect(v)}
        colors={colors}
        style={style}
        placeholder={placeholder}
      />
    );
  }

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} activeOpacity={0.6} style={[{ flexDirection: "row", alignItems: "center", gap: 4 }, style]}>
        {withDots && current?.color && <View style={[inlineStyles.dot, { backgroundColor: current.color }]} />}
        <Text style={[{ color: value ? colors.foreground : colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
          {current?.label || value || placeholder}
        </Text>
        <Feather name="chevron-down" size={12} color={colors.mutedForeground} />
      </TouchableOpacity>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => { setOpen(false); setCreating(false); }}>
        <TouchableOpacity style={inlineStyles.overlay} activeOpacity={1} onPress={() => { setOpen(false); setCreating(false); }}>
          <View style={[inlineStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ScrollView style={{ maxHeight: 320 }}>
              {options.map((opt) => (
                <TouchableOpacity key={opt.value || "_none"} onPress={() => { onSelect(opt.value); setOpen(false); }} style={[inlineStyles.item, { borderBottomColor: colors.border }]} activeOpacity={0.6}>
                  {withDots && opt.color && <View style={[inlineStyles.dot, { backgroundColor: opt.color }]} />}
                  <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 }}>{opt.label}</Text>
                  {opt.value === value && <Feather name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              ))}
              {allowNew && !creating && (
                <TouchableOpacity onPress={() => setCreating(true)} style={[inlineStyles.item, { borderBottomColor: colors.border }]} activeOpacity={0.6}>
                  <Feather name="plus" size={14} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>{newLabel ?? "New…"}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            {allowNew && creating && (
              <View style={[inlineStyles.creator, { borderTopColor: colors.border }]}>
                <TextInput
                  autoFocus
                  value={newVal}
                  onChangeText={setNewVal}
                  placeholder="Type name..."
                  placeholderTextColor={colors.mutedForeground}
                  style={[inlineStyles.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]}
                  onSubmitEditing={() => {
                    const v = newVal.trim();
                    if (v) {
                      if (onCreateNew) onCreateNew(v);
                      else onSelect(v);
                    }
                    setCreating(false); setNewVal(""); setOpen(false);
                  }}
                />
                <TouchableOpacity onPress={() => {
                  const v = newVal.trim();
                  if (v) {
                    if (onCreateNew) onCreateNew(v);
                    else onSelect(v);
                  }
                  setCreating(false); setNewVal(""); setOpen(false);
                }} style={[inlineStyles.addBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7}>
                  <Text style={{ color: colors.primaryForeground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>Add</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export function StatusBadge({ status, onCycle, colors }: { status: string; onCycle: () => void; colors: ReturnType<typeof useColors> }) {
  const sc = statusColor(status, colors);
  return (
    <TouchableOpacity onPress={onCycle} activeOpacity={0.6} style={[inlineStyles.badge, { backgroundColor: sc.bg }]}>
      <Text style={[inlineStyles.badgeText, { color: sc.fg }]}>{status}</Text>
    </TouchableOpacity>
  );
}

const inlineStyles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, fontFamily: "Inter_500Medium" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { width: "100%", maxWidth: 320, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1 },
  creator: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderTopWidth: 1 },
  addBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
