import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Polyline, Circle, Text as SvgText, Line, G } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

interface LineChartProps {
  data: Array<{ label: string; cumPlanned: number; cumActual: number }>;
  width: number;
  height: number;
}

export function LineChart({ data, width, height }: LineChartProps) {
  const colors = useColors();
  const padding = { top: 20, right: 20, bottom: 40, left: 55 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...data.flatMap(d => [d.cumPlanned, d.cumActual]), 1);
  const niceMax = Math.ceil(maxVal / 100000) * 100000;

  const getX = (i: number) => padding.left + (i / (data.length - 1)) * chartW;
  const getY = (val: number) => padding.top + chartH - (val / niceMax) * chartH;

  const plannedPoints = data.map((d, i) => `${getX(i)},${getY(d.cumPlanned)}`).join(" ");

  const actualData = data.filter(d => d.cumActual > 0);
  const actualPoints = actualData.map((d, i) => {
    const idx = data.indexOf(d);
    return `${getX(idx)},${getY(d.cumActual)}`;
  }).join(" ");

  const yTicks = 5;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (niceMax / yTicks) * i);

  return (
    <View>
      <Text style={[styles.title, { color: colors.foreground }]}>Cumulative Spend vs Plan</Text>
      <Svg width={width} height={height}>
        {tickVals.map((val, i) => {
          const y = getY(val);
          return (
            <G key={i}>
              <Line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray="4,4" />
              <SvgText x={padding.left - 8} y={y + 4} fontSize={10} fill={colors.mutedForeground} textAnchor="end">
                {val >= 1000000 ? `£${(val / 1000000).toFixed(1)}M` : val >= 1000 ? `£${(val / 1000).toFixed(0)}k` : `£${val}`}
              </SvgText>
            </G>
          );
        })}

        <Polyline points={plannedPoints} fill="none" stroke={colors.primary + "60"} strokeWidth={2} strokeDasharray="6,4" />
        {actualPoints.length > 0 && (
          <Polyline points={actualPoints} fill="none" stroke={colors.primary} strokeWidth={2.5} />
        )}

        {actualData.map((d) => {
          const idx = data.indexOf(d);
          return (
            <Circle key={idx} cx={getX(idx)} cy={getY(d.cumActual)} r={3.5} fill={colors.primary} />
          );
        })}

        {data.map((d, i) => (
          <SvgText key={i} x={getX(i)} y={height - padding.bottom + 16} fontSize={10} fill={colors.mutedForeground} textAnchor="middle">
            {d.label}
          </SvgText>
        ))}

        <Line x1={padding.left} y1={padding.top + chartH} x2={width - padding.right} y2={padding.top + chartH} stroke={colors.border} strokeWidth={1} />
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary + "60", borderStyle: "dashed" }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Plan</Text>
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
