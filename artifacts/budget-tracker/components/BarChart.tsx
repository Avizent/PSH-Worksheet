import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect, Text as SvgText, Line, G } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

interface BarChartProps {
  data: Array<{ label: string; planned: number; actual: number }>;
  width: number;
  height: number;
}

export function BarChart({ data, width, height }: BarChartProps) {
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.flatMap(d => [d.planned, d.actual]), 1);
  const niceMax = Math.ceil(maxVal / 10000) * 10000;

  const barGroupWidth = chartW / data.length;
  const barWidth = Math.min(barGroupWidth * 0.35, 20);
  const gap = 2;

  const yTicks = 5;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (niceMax / yTicks) * i);

  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>Plan vs Actual (Monthly)</Text>
      <Svg width={width} height={height}>
        {tickVals.map((val, i) => {
          const y = padding.top + chartH - (val / niceMax) * chartH;
          return (
            <G key={i}>
              <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
              <SvgText x={padding.left - 8} y={y + 4} fontSize={10} fill={colors.mutedForeground} textAnchor="end">
                {val >= 1000 ? `£${(val / 1000).toFixed(0)}k` : `£${val}`}
              </SvgText>
            </G>
          );
        })}

        {data.map((d, i) => {
          const cx = padding.left + barGroupWidth * i + barGroupWidth / 2;
          const plannedH = (d.planned / niceMax) * chartH;
          const actualH = (d.actual / niceMax) * chartH;

          return (
            <G key={i}>
              <Rect
                x={cx - barWidth - gap / 2}
                y={padding.top + chartH - plannedH}
                width={barWidth}
                height={plannedH}
                fill={colors.primary + "60"}
                rx={2}
              />
              <Rect
                x={cx + gap / 2}
                y={padding.top + chartH - actualH}
                width={barWidth}
                height={actualH}
                fill={colors.primary}
                rx={2}
              />
              <SvgText
                x={cx}
                y={height - padding.bottom + 16}
                fontSize={10}
                fill={colors.mutedForeground}
                textAnchor="middle"
              >
                {d.label}
              </SvgText>
            </G>
          );
        })}

        <Line x1={padding.left} y1={padding.top + chartH} x2={width - padding.right} y2={padding.top + chartH} stroke={colors.border} strokeWidth={1} />
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary + "60" }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Planned</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Actual</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  legend: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
