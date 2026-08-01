import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useCurrency, type DisplayCurrency } from "@/contexts/CurrencyContext";

const OPTIONS: { key: DisplayCurrency; label: string }[] = [
  { key: "SEK", label: "kr" },
  { key: "GBP", label: "£" },
];

/**
 * Segmented SEK/GBP control. Figures are always stored in SEK; selecting GBP
 * converts for display only, so the active rate is shown alongside to make it
 * obvious which rate the numbers on screen are based on.
 */
export function CurrencyToggle() {
  const colors = useColors();
  const { currency, rate, needsRate, setCurrency } = useCurrency();

  return (
    <View style={styles.wrap}>
      <View style={[styles.group, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        {OPTIONS.map((opt) => {
          const isActive = opt.key === currency;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => setCurrency(opt.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`Show figures in ${opt.key === "SEK" ? "Swedish kronor" : "pounds sterling"}`}
              style={[
                styles.option,
                isActive && { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  { color: isActive ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {currency === "GBP" && rate !== null && (
        <Text style={[styles.rateBadge, { color: colors.mutedForeground }]}>@ {rate}</Text>
      )}
      {needsRate && (
        <Text style={[styles.rateBadge, { color: colors.mutedForeground }]}>set a rate in Admin</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  group: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
  },
  option: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    minWidth: 34,
    alignItems: "center",
  },
  optionText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  rateBadge: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
