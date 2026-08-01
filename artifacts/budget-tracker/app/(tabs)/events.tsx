import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Text, Platform, ActivityIndicator, RefreshControl, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { WebRefreshButton } from "@/components/WebRefreshButton";
import { SectionHeader } from "@/components/SectionHeader";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { useRouter } from "expo-router";
import { useListEvents, useListAlerts } from "@workspace/api-client-react";
import { useCurrency } from "@/contexts/CurrencyContext";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function EventsContent() {
  const { formatCompact: formatCurrency } = useCurrency();
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";

  const router = useRouter();
  const { data: events, isLoading, isError, refetch } = useListEvents();
  const { data: alerts } = useListAlerts({ resolved: false });
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError && !events) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ErrorState
          title="Failed to load events"
          message="We couldn't fetch events. Check your connection and try again."
          onRetry={handleRefresh}
        />
      </View>
    );
  }

  const statusColors: Record<string, string> = {
    Planned: colors.primary,
    Confirmed: colors.success,
    Cancelled: colors.destructive,
    Completed: colors.mutedForeground,
  };

  const content = (
    <View style={{ flex: 1 }}>
    <WebRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingTop: isWeb ? 67 : 0,
          paddingBottom: isWeb ? 34 : 20,
          paddingHorizontal: isDesktop ? 32 : 16,
        },
      ]}
      refreshControl={
        Platform.OS !== "web" ? (
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      <SectionHeader title="Events" subtitle={`${(events || []).length} marketing events`} />

      {(!events || events.length === 0) ? (
        <EmptyState
          icon="calendar"
          title="No events"
          message="Marketing events will appear here once created."
        />
      ) : (
        <View style={styles.list}>
          {events.map((event) => {
            const statusColor = statusColors[event.status] || colors.mutedForeground;
            return (
              <View key={event.id} style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
                <View style={styles.eventHeader}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.eventName, { color: colors.foreground }]}>{event.name}</Text>
                  <TouchableOpacity
                    onPress={() => router.push("/event-mgmnt")}
                    style={[styles.manageBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}
                    activeOpacity={0.7}
                  >
                    <Feather name="clipboard" size={12} color={colors.primary} />
                    <Text style={{ fontSize: 11, color: colors.primary, fontFamily: "Inter_500Medium" }}>Manage</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.eventDetails}>
                  <View style={styles.detailRow}>
                    <Feather name="calendar" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.detailText, { color: colors.mutedForeground }]}>{formatDate(event.eventDate ?? null)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Feather name="tag" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.detailText, { color: statusColor }]}>{event.status}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Feather name="dollar-sign" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.detailText, { color: colors.mutedForeground }]}>{formatCurrency(event.estimatedCost ?? null)}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={(alerts || []).length} />
        <View style={styles.desktopContent}>{content}</View>
      </View>
    );
  }

  return content;
}

export default function EventsScreen() {
  return <EventsContent />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  contentContainer: {
    gap: 12,
  },
  list: {
    gap: 10,
  },
  eventCard: {
    borderWidth: 1,
    padding: 14,
  },
  eventHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  eventName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  eventDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  detailText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopContent: {
    flex: 1,
  },
});
