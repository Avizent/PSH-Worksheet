import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect, Text as SvgText, Line, G } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/contexts/CurrencyContext";

interface EventItem {
  name: string;
  month: number;
  status: string;
  budget: number;
}

interface EventsGanttProps {
  events: EventItem[];
  width: number;
  height: number;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function EventsGantt({ events, width, height }: EventsGanttProps) {
  const { formatCompact } = useCurrency();
  const colors = useColors();
  const padding = { top: 30, right: 20, bottom: 30, left: 120 };
  const chartW = width - padding.left - padding.right;
  const rowH = Math.min(32, (height - padding.top - padding.bottom) / Math.max(events.length, 1));
  const colW = chartW / 12;

  const statusColor = (status: string) => {
    if (status === "Confirmed") return colors.success;
    if (status === "Completed") return colors.primary;
    return colors.accent;
  };
  const statusFg = (status: string) => {
    if (status === "Confirmed") return colors.successForeground;
    if (status === "Completed") return colors.primaryForeground;
    return colors.accentForeground;
  };

  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>Events Timeline</Text>
      <Svg width={width} height={Math.max(height, padding.top + events.length * rowH + padding.bottom)}>
        {MONTH_LABELS.map((label, i) => {
          const x = padding.left + colW * i;
          return (
            <G key={i}>
              <Line x1={x} y1={padding.top - 5} x2={x} y2={padding.top + events.length * rowH} stroke={colors.border} strokeWidth={1} strokeDasharray="3,3" />
              <SvgText x={x + colW / 2} y={padding.top - 10} fontSize={10} fill={colors.mutedForeground} textAnchor="middle">
                {label}
              </SvgText>
            </G>
          );
        })}

        {events.map((evt, i) => {
          const y = padding.top + i * rowH;
          const x = padding.left + (evt.month - 1) * colW + 2;
          const barW = Math.max(colW - 4, 8);
          const fill = statusColor(evt.status);
          const budgetLabel = formatCompact(evt.budget);

          return (
            <G key={i}>
              <SvgText x={padding.left - 8} y={y + rowH / 2 + 4} fontSize={11} fill={colors.foreground} textAnchor="end">
                {evt.name.length > 16 ? evt.name.slice(0, 14) + "…" : evt.name}
              </SvgText>
              <Rect x={x} y={y + 4} width={barW} height={rowH - 8} fill={fill} rx={4} opacity={0.8} />
              <SvgText x={x + barW / 2} y={y + rowH / 2 + 3} fontSize={9} fill={statusFg(evt.status)} textAnchor="middle" fontWeight="600">
                {budgetLabel}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Confirmed</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Planned</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  legend: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 4 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
