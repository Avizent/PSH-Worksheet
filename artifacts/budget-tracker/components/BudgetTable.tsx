import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Platform, TextInput } from "react-native";
import { useColors } from "@/hooks/useColors";

interface BudgetLineRow {
  id: number;
  category: string;
  lineItem: string;
  owner: string | null;
  costStatus: string;
  totalPlan: number;
  totalActual: number;
  variance: number;
  projectionPct?: number;
}

interface BudgetTableProps {
  data: BudgetLineRow[];
  showProjection?: boolean;
  onProjectionChange?: (lineId: number, value: string) => void;
}

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1000) {
    return "\u00a3" + (val / 1000).toFixed(1) + "k";
  }
  return "\u00a3" + val.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function InlineProjectionInput({ lineId, value, onSave, colors }: {
  lineId: number;
  value: number;
  onSave: (lineId: number, val: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [localVal, setLocalVal] = useState(String(value));

  const handleBlur = () => {
    if (localVal !== String(value)) {
      onSave(lineId, localVal);
    }
  };

  return (
    <View style={styles.projInputContainer}>
      <TextInput
        style={[styles.projInput, { color: colors.foreground, borderColor: colors.border }]}
        value={localVal}
        onChangeText={setLocalVal}
        onBlur={handleBlur}
        keyboardType="numeric"
      />
      <Text style={[styles.projPct, { color: colors.mutedForeground }]}>%</Text>
    </View>
  );
}

export function BudgetTable({ data, showProjection, onProjectionChange }: BudgetTableProps) {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === "web"}>
        <View>
          <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.cellCategory, styles.headerText, { color: colors.mutedForeground }]}>Line Item</Text>
            <Text style={[styles.cellSmall, styles.headerText, { color: colors.mutedForeground }]}>Category</Text>
            <Text style={[styles.cellSmall, styles.headerText, { color: colors.mutedForeground }]}>Owner</Text>
            <Text style={[styles.cellSmall, styles.headerText, { color: colors.mutedForeground }]}>Type</Text>
            <Text style={[styles.cellNumber, styles.headerText, { color: colors.mutedForeground }]}>Plan</Text>
            <Text style={[styles.cellNumber, styles.headerText, { color: colors.mutedForeground }]}>Actual</Text>
            <Text style={[styles.cellNumber, styles.headerText, { color: colors.mutedForeground }]}>Variance</Text>
            <Text style={[styles.cellVarPct, styles.headerText, { color: colors.mutedForeground }]}>Var %</Text>
            {showProjection && (
              <Text style={[styles.cellProjection, styles.headerText, { color: colors.mutedForeground }]}>Proj %</Text>
            )}
          </View>
          {data.map((row) => {
            const varianceColor = row.variance > 0 ? colors.success : row.variance < 0 ? colors.destructive : colors.foreground;
            return (
              <View key={row.id} style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text style={[styles.cellCategory, { color: colors.foreground }]} numberOfLines={1}>{row.lineItem}</Text>
                <Text style={[styles.cellSmall, { color: colors.mutedForeground }]} numberOfLines={1}>{row.category}</Text>
                <Text style={[styles.cellSmall, { color: colors.mutedForeground }]} numberOfLines={1}>{row.owner || "-"}</Text>
                <View style={styles.cellSmall}>
                  <View style={[styles.badge, { backgroundColor: row.costStatus === "Fixed Cost" ? colors.primary + "15" : colors.accent + "20" }]}>
                    <Text style={[styles.badgeText, { color: row.costStatus === "Fixed Cost" ? colors.primary : colors.accent }]}>
                      {row.costStatus === "Fixed Cost" ? "Fixed" : "Variable"}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.cellNumber, { color: colors.foreground }]}>{formatCurrency(row.totalPlan)}</Text>
                <Text style={[styles.cellNumber, { color: colors.foreground }]}>{formatCurrency(row.totalActual)}</Text>
                <Text style={[styles.cellNumber, { color: varianceColor }]}>{formatCurrency(row.variance)}</Text>
                <Text style={[styles.cellVarPct, { color: row.variance >= 0 ? colors.success : colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                  {row.totalPlan > 0 ? ((row.variance / row.totalPlan) * 100).toFixed(1) + "%" : "-"}
                </Text>
                {showProjection && (
                  <View style={styles.cellProjection}>
                    {row.costStatus === "Fixed Cost" && onProjectionChange ? (
                      <InlineProjectionInput
                        lineId={row.id}
                        value={row.projectionPct ?? 0}
                        onSave={onProjectionChange}
                        colors={colors}
                      />
                    ) : (
                      <Text style={[styles.projDash, { color: colors.mutedForeground }]}>-</Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  headerText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  cellCategory: {
    width: 180,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    paddingRight: 8,
  },
  cellSmall: {
    width: 100,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingRight: 8,
  },
  cellNumber: {
    width: 90,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "right" as const,
    paddingRight: 8,
  },
  cellVarPct: {
    width: 65,
    fontSize: 13,
    textAlign: "right" as const,
    paddingRight: 8,
  },
  cellProjection: {
    width: 80,
    paddingRight: 8,
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  projInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  projInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    width: 50,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "right" as const,
  },
  projPct: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  projDash: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center" as const,
  },
});
