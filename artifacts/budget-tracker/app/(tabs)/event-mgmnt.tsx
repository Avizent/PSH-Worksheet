import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useLayout } from "@/hooks/useLayout";
import { DesktopSidebar } from "@/components/DesktopSidebar";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { WebRefreshButton } from "@/components/WebRefreshButton";
import { ToastProvider, useToast } from "@/components/Toast";
import {
  useListEvents,
  useListAlerts,
  useListBudgetLines,
  useListEventTasks,
  useCreateEventTask,
  useUpdateEventTask,
  useDeleteEventTask,
  useListTaskReminders,
  useCreateTaskReminder,
  useDeleteTaskReminder,
  useListInAppAlerts,
  useMarkInAppAlertRead,
  useMarkAllInAppAlertsRead,
  useCheckEventReminders,
  getListEventTasksQueryKey,
  getListInAppAlertsQueryKey,
  getListTaskRemindersQueryKey,
} from "@workspace/api-client-react";
import {
  ListEventsResponseItem,
  ListEventTasksResponseItem,
  ListInAppAlertsResponseItem,
} from "@workspace/api-zod";
import type { z } from "zod";

// The zod schemas use `coerce.date()`, so z.infer types timestamps as Date -
// but these values arrive over JSON as ISO strings and are only ever fed to
// formatDate/daysUntil, which accept either. Widen the date fields so the
// declared types match what actually comes back from the API.
type JsonDates<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: T[P] extends Date ? Date | string
    : T[P] extends Date | null | undefined ? Date | string | null | undefined
    : T[P];
};

type MarketingEvent = JsonDates<
  z.infer<typeof ListEventsResponseItem>,
  "eventDate" | "createdAt" | "updatedAt"
>;
type EventTask = JsonDates<
  z.infer<typeof ListEventTasksResponseItem>,
  "dueDate" | "createdAt" | "updatedAt"
>;
type InAppAlert = JsonDates<
  z.infer<typeof ListInAppAlertsResponseItem>,
  "readAt" | "createdAt"
>;

function formatDate(dateVal: Date | string | null | undefined): string {
  if (!dateVal) return "TBD";
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(dateVal: Date | string | null | undefined): number | null {
  if (!dateVal) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = dateVal instanceof Date ? new Date(dateVal) : new Date(dateVal);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatTimeAgo(dateVal: Date | string): string {
  const diff = Date.now() - (dateVal instanceof Date ? dateVal : new Date(dateVal)).getTime();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor(diff / 60000);
  if (days > 0) return days === 1 ? "Yesterday" : `${days} days ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "Just now";
}

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  high: { color: "#ef4444", label: "High" },
  medium: { color: "#f59e0b", label: "Med" },
  low: { color: "#22c55e", label: "Low" },
};

const STATUS_COLORS: Record<string, string> = {
  Planned: "#3b82f6",
  Confirmed: "#22c55e",
  Cancelled: "#ef4444",
  Completed: "#9ca3af",
};

interface ReminderPillsProps {
  taskId: number;
  colors: ReturnType<typeof useColors>;
  onAdd: (taskId: number) => void;
}

function ReminderPills({ taskId, colors, onAdd }: ReminderPillsProps) {
  const queryClient = useQueryClient();
  const { data: reminders } = useListTaskReminders(taskId);
  const deleteMutation = useDeleteTaskReminder();

  const handleDelete = (remId: number) => {
    deleteMutation.mutate({ id: remId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTaskRemindersQueryKey(taskId) });
      },
    });
  };

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {(reminders || []).map((r) => (
        <TouchableOpacity
          key={r.id}
          onPress={() => handleDelete(r.id)}
          style={[styles.reminderPill, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}
        >
          <Feather name="bell" size={10} color={colors.primary} />
          <Text style={{ fontSize: 10, color: colors.primary, fontFamily: "Inter_500Medium" }}>
            {r.daysBefore}d{r.label ? ` · ${r.label}` : ""}{r.firedAt ? " ✓" : ""}
          </Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        onPress={() => onAdd(taskId)}
        style={[styles.reminderPill, { backgroundColor: colors.muted, borderColor: colors.border }]}
      >
        <Feather name="plus" size={10} color={colors.mutedForeground} />
        <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>reminder</Text>
      </TouchableOpacity>
    </View>
  );
}

interface TaskItemProps {
  task: EventTask;
  colors: ReturnType<typeof useColors>;
  onToggle: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  onAddReminder: (taskId: number) => void;
}

function TaskItem({ task, colors, onToggle, onDelete, onAddReminder }: TaskItemProps) {
  const isDone = task.status === "done";
  const days = daysUntil(task.dueDate);
  const priorityCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const overdue = days !== null && days < 0 && !isDone;

  return (
    <View style={[styles.taskRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <TouchableOpacity
        onPress={() => onToggle(task.id, task.status)}
        style={[styles.checkbox, { borderColor: isDone ? colors.success : colors.border, backgroundColor: isDone ? colors.success : "transparent" }]}
        activeOpacity={0.7}
      >
        {isDone && <Feather name="check" size={11} color="#fff" />}
      </TouchableOpacity>

      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={[styles.taskTitle, { color: isDone ? colors.mutedForeground : colors.foreground, textDecorationLine: isDone ? "line-through" : "none" }]}>
            {task.title}
          </Text>
          <View style={[styles.priorityBadge, { backgroundColor: priorityCfg.color + "20" }]}>
            <Text style={{ fontSize: 10, color: priorityCfg.color, fontFamily: "Inter_600SemiBold" }}>{priorityCfg.label}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {task.dueDate && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Feather name="calendar" size={11} color={overdue ? "#ef4444" : colors.mutedForeground} />
              <Text style={{ fontSize: 11, color: overdue ? "#ef4444" : colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                {formatDate(task.dueDate)}{overdue ? " (overdue)" : days === 0 ? " (today)" : ""}
              </Text>
            </View>
          )}
          {task.assignee && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Feather name="user" size={11} color={colors.mutedForeground} />
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{task.assignee}</Text>
            </View>
          )}
        </View>
        <ReminderPills taskId={task.id} colors={colors} onAdd={onAddReminder} />
      </View>

      <TouchableOpacity onPress={() => onDelete(task.id)} style={{ padding: 4 }} activeOpacity={0.7}>
        <Feather name="trash-2" size={14} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

interface AlertItemProps {
  alert: InAppAlert;
  colors: ReturnType<typeof useColors>;
  onMarkRead: (id: number) => void;
}

function AlertItem({ alert, colors, onMarkRead }: AlertItemProps) {
  const isUnread = !alert.readAt;
  return (
    <TouchableOpacity
      onPress={() => isUnread && onMarkRead(alert.id)}
      activeOpacity={isUnread ? 0.7 : 1}
      style={[styles.alertItem, { borderColor: colors.border, backgroundColor: isUnread ? colors.primary + "08" : colors.card }]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        {isUnread && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
        {!isUnread && <View style={{ width: 8 }} />}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
            {alert.message}
          </Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 }}>
            {formatTimeAgo(alert.createdAt)}{!isUnread ? " · read" : ""}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

interface AddTaskModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (data: { title: string; dueDate?: string; assignee?: string; priority: string; notes?: string }) => void;
  colors: ReturnType<typeof useColors>;
}

function AddTaskModal({ visible, onClose, onAdd, colors }: AddTaskModalProps) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [notes, setNotes] = useState("");

  const handleAdd = () => {
    if (!title.trim()) return;
    const data: { title: string; dueDate?: string; assignee?: string; priority: string; notes?: string } = {
      title: title.trim(),
      priority,
    };
    if (assignee.trim()) data.assignee = assignee.trim();
    if (dueDate.trim()) {
      const d = new Date(dueDate.trim());
      if (!isNaN(d.getTime())) data.dueDate = d.toISOString();
    }
    if (notes.trim()) data.notes = notes.trim();
    onAdd(data);
    setTitle(""); setAssignee(""); setDueDate(""); setPriority("medium"); setNotes("");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Task</Text>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Title *</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            value={title}
            onChangeText={setTitle}
            placeholder="Task title"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Assignee</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            value={assignee}
            onChangeText={setAssignee}
            placeholder="Name"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Due Date (YYYY-MM-DD)</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="2026-06-15"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Priority</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            {(["low", "medium", "high"] as const).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setPriority(p)}
                style={[styles.priorityBtn, { borderColor: priority === p ? PRIORITY_CONFIG[p].color : colors.border, backgroundColor: priority === p ? PRIORITY_CONFIG[p].color + "20" : "transparent" }]}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 12, color: priority === p ? PRIORITY_CONFIG[p].color : colors.mutedForeground, fontFamily: "Inter_500Medium", textTransform: "capitalize" }}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, height: 64 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={colors.mutedForeground}
            multiline
          />

          <TouchableOpacity
            onPress={handleAdd}
            disabled={!title.trim()}
            style={[styles.addBtn, { backgroundColor: title.trim() ? colors.primary : colors.muted }]}
            activeOpacity={0.8}
          >
            <Text style={{ color: title.trim() ? colors.primaryForeground : colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Add Task</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

interface AddReminderModalProps {
  visible: boolean;
  taskId: number | null;
  onClose: () => void;
  onAdd: (taskId: number, daysBefore: number, label?: string) => void;
  colors: ReturnType<typeof useColors>;
}

function AddReminderModal({ visible, taskId, onClose, onAdd, colors }: AddReminderModalProps) {
  const [days, setDays] = useState("3");
  const [label, setLabel] = useState("");

  const handleAdd = () => {
    if (!taskId) return;
    const n = parseInt(days, 10);
    if (isNaN(n) || n < 1) return;
    onAdd(taskId, n, label.trim() || undefined);
    setDays("3"); setLabel("");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Reminder</Text>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Days before due date</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            value={days}
            onChangeText={setDays}
            keyboardType="numeric"
            placeholder="3"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
          />
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Label (optional)</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. First nudge"
            placeholderTextColor={colors.mutedForeground}
          />
          <TouchableOpacity
            onPress={handleAdd}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Add Reminder</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

interface EventDetailProps {
  event: MarketingEvent;
  colors: ReturnType<typeof useColors>;
  budgetLineName?: string;
}

function EventDetail({ event, colors, budgetLineName }: EventDetailProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [reminderTaskId, setReminderTaskId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: tasks, isLoading: tasksLoading, refetch: refetchTasks } = useListEventTasks(event.id);
  const { data: inAppAlerts, isLoading: alertsLoading, refetch: refetchAlerts } = useListInAppAlerts({ eventId: event.id });
  const unreadCount = (inAppAlerts || []).filter((a) => !a.readAt).length;

  const checkReminders = useCheckEventReminders();
  const createTask = useCreateEventTask();
  const updateTask = useUpdateEventTask();
  const deleteTask = useDeleteEventTask();
  const createReminder = useCreateTaskReminder();
  const markRead = useMarkInAppAlertRead();
  const markAllRead = useMarkAllInAppAlertsRead();

  useEffect(() => {
    checkReminders.mutate({ id: event.id }, {
      onSuccess: (result) => {
        if (result.fired > 0) {
          queryClient.invalidateQueries({ queryKey: getListInAppAlertsQueryKey({ eventId: event.id }) });
        }
      },
    });
  }, [event.id]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchTasks(), refetchAlerts()]);
    setRefreshing(false);
  };

  const handleToggleTask = (id: number, status: string) => {
    const nextStatus = status === "done" ? "open" : "done";
    updateTask.mutate({ id, data: { status: nextStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventTasksQueryKey(event.id) });
      },
    });
  };

  const handleDeleteTask = (id: number) => {
    deleteTask.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventTasksQueryKey(event.id) });
        queryClient.invalidateQueries({ queryKey: getListInAppAlertsQueryKey({ eventId: event.id }) });
      },
    });
  };

  const handleAddTask = (data: { title: string; dueDate?: string; assignee?: string; priority: string; notes?: string }) => {
    createTask.mutate({ id: event.id, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventTasksQueryKey(event.id) });
        setAddTaskOpen(false);
        toast.show("Task added", { kind: "success" });
      },
      onError: () => toast.show("Failed to add task", { kind: "error" }),
    });
  };

  const handleAddReminder = (taskId: number, daysBefore: number, label?: string) => {
    createReminder.mutate({ id: taskId, data: { daysBefore, ...(label ? { label } : {}) } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTaskRemindersQueryKey(taskId) });
        setReminderTaskId(null);
        toast.show("Reminder added", { kind: "success" });
      },
      onError: () => toast.show("Failed to add reminder", { kind: "error" }),
    });
  };

  const handleMarkRead = (id: number) => {
    markRead.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInAppAlertsQueryKey({ eventId: event.id }) });
      },
    });
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate({ data: { eventId: event.id } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInAppAlertsQueryKey({ eventId: event.id }) });
      },
    });
  };

  const statusColor = STATUS_COLORS[event.status] || colors.mutedForeground;
  const openTasks = (tasks || []).filter((t) => t.status === "open");
  const doneTasks = (tasks || []).filter((t) => t.status === "done");

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <ScrollView
        style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border }}
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
        refreshControl={Platform.OS !== "web" ? <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} /> : undefined}
      >
        <View style={[styles.eventDetailHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground, flex: 1 }}>{event.name}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Feather name="calendar" size={12} color={colors.mutedForeground} />
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{formatDate(event.eventDate)}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Feather name="tag" size={12} color={statusColor} />
              <Text style={{ fontSize: 12, color: statusColor, fontFamily: "Inter_500Medium" }}>{event.status}</Text>
            </View>
            {budgetLineName && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Feather name="link" size={12} color={colors.mutedForeground} />
                <Text style={{ fontSize: 12, color: colors.primary, fontFamily: "Inter_500Medium" }}>{budgetLineName}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground, textTransform: "uppercase", letterSpacing: 0.5 }}>
            TASKS ({openTasks.length} open)
          </Text>
          <TouchableOpacity
            onPress={() => setAddTaskOpen(true)}
            style={[styles.addTaskBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={14} color={colors.primaryForeground} />
            <Text style={{ fontSize: 12, color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Add Task</Text>
          </TouchableOpacity>
        </View>

        {tasksLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (tasks || []).length === 0 ? (
          <View style={[styles.emptyTasks, { borderColor: colors.border }]}>
            <Feather name="check-square" size={24} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>No tasks yet. Add one to get started.</Text>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            {openTasks.map((task) => (
              <TaskItem key={task.id} task={task} colors={colors} onToggle={handleToggleTask} onDelete={handleDeleteTask} onAddReminder={setReminderTaskId} />
            ))}
            {doneTasks.length > 0 && (
              <>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_500Medium", marginTop: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Completed</Text>
                {doneTasks.map((task) => (
                  <TaskItem key={task.id} task={task} colors={colors} onToggle={handleToggleTask} onDelete={handleDeleteTask} onAddReminder={setReminderTaskId} />
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={{ width: 280, minWidth: 240 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground, textTransform: "uppercase", letterSpacing: 0.5 }}>IN-APP ALERTS</Text>
            {unreadCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text style={{ fontSize: 10, color: "#fff", fontFamily: "Inter_700Bold" }}>{unreadCount}</Text>
              </View>
            )}
          </View>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={handleMarkAllRead} activeOpacity={0.7}>
              <Text style={{ fontSize: 11, color: colors.primary, fontFamily: "Inter_500Medium" }}>Mark all read</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView contentContainerStyle={{ padding: 12, gap: 6, paddingBottom: 40 }}>
          {alertsLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (inAppAlerts || []).length === 0 ? (
            <View style={{ alignItems: "center", padding: 20, gap: 8 }}>
              <Feather name="bell-off" size={20} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" }}>No alerts yet. Add reminders to tasks to receive notifications.</Text>
            </View>
          ) : (
            [...(inAppAlerts || [])].reverse().map((alert) => (
              <AlertItem key={alert.id} alert={alert} colors={colors} onMarkRead={handleMarkRead} />
            ))
          )}
        </ScrollView>
      </View>

      <AddTaskModal visible={addTaskOpen} onClose={() => setAddTaskOpen(false)} onAdd={handleAddTask} colors={colors} />
      <AddReminderModal visible={reminderTaskId !== null} taskId={reminderTaskId} onClose={() => setReminderTaskId(null)} onAdd={handleAddReminder} colors={colors} />
    </View>
  );
}

function EventList({
  events,
  selectedId,
  onSelect,
  colors,
}: {
  events: MarketingEvent[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ gap: 6 }}>
      {events.map((event) => {
        const isSelected = selectedId === event.id;
        const statusColor = STATUS_COLORS[event.status] || colors.mutedForeground;
        return (
          <TouchableOpacity
            key={event.id}
            onPress={() => onSelect(event.id)}
            activeOpacity={0.75}
            style={[
              styles.eventListItem,
              {
                backgroundColor: isSelected ? colors.primary + "15" : colors.card,
                borderColor: isSelected ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: isSelected ? colors.primary : colors.foreground }} numberOfLines={1}>
                {event.name}
              </Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 1 }}>
                {formatDate(event.eventDate)}
              </Text>
            </View>
            <Feather name="chevron-right" size={14} color={isSelected ? colors.primary : colors.mutedForeground} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function EventMgmntContent() {
  const colors = useColors();
  const { mode } = useLayout();
  const isDesktop = mode === "desktop";
  const isWeb = Platform.OS === "web";

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [refreshing, setRefreshing] = useState(false);

  const { data: events, isLoading, isError, refetch } = useListEvents();
  const { data: alerts } = useListAlerts({ resolved: false });
  const { data: budgetLines } = useListBudgetLines();

  const selectedEvent = (events || []).find((e) => e.id === selectedEventId) ?? null;
  const budgetLineName = selectedEvent?.budgetLineId
    ? (budgetLines || []).find((bl) => bl.id === selectedEvent.budgetLineId)?.lineItem
    : undefined;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleSelect = (id: number) => {
    setSelectedEventId(id);
    if (!isDesktop) setMobileView("detail");
  };

  const handleBack = () => {
    setMobileView("list");
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError && !events) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ErrorState title="Failed to load events" message="Could not fetch events." onRetry={handleRefresh} />
      </View>
    );
  }

  const eventList = (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.listContainer, { paddingTop: isWeb && isDesktop ? 67 : isWeb ? 67 : 0 }]}
      refreshControl={Platform.OS !== "web" ? <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} /> : undefined}
    >
      <SectionHeader
        title="Event Management"
        subtitle={`${(events || []).length} events`}
      />
      {(!events || events.length === 0) ? (
        <EmptyState
          icon="clipboard"
          title="No events"
          message="Create events in the Events screen first, then manage them here."
        />
      ) : (
        <EventList
          events={events}
          selectedId={selectedEventId}
          onSelect={handleSelect}
          colors={colors}
        />
      )}
    </ScrollView>
  );

  const detailPanel = selectedEvent ? (
    <ToastProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {!isDesktop && (
          <View style={[styles.mobileDetailHeader, { backgroundColor: colors.card, borderBottomColor: colors.border, paddingTop: isWeb ? 67 : 16 }]}>
            <TouchableOpacity onPress={handleBack} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} activeOpacity={0.7}>
              <Feather name="arrow-left" size={18} color={colors.primary} />
              <Text style={{ fontSize: 14, color: colors.primary, fontFamily: "Inter_500Medium" }}>Events</Text>
            </TouchableOpacity>
          </View>
        )}
        <EventDetail event={selectedEvent} colors={colors} budgetLineName={budgetLineName} />
      </View>
    </ToastProvider>
  ) : (
    <View style={[styles.center, { flex: 1, backgroundColor: colors.background }]}>
      <Feather name="clipboard" size={32} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 12, textAlign: "center" }}>
        Select an event to manage its tasks and reminders
      </Text>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.desktopRoot, { backgroundColor: colors.background }]}>
        <DesktopSidebar alertCount={(alerts || []).length} />
        <View style={[styles.desktopEventList, { borderRightColor: colors.border, backgroundColor: colors.background }]}>
          <WebRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
          {eventList}
        </View>
        <View style={{ flex: 1 }}>
          {detailPanel}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <WebRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
      {mobileView === "list" ? eventList : detailPanel}
    </View>
  );
}

export default function EventMgmntScreen() {
  return (
    <ToastProvider>
      <EventMgmntContent />
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  desktopRoot: {
    flex: 1,
    flexDirection: "row",
  },
  desktopEventList: {
    width: 260,
    borderRightWidth: 1,
  },
  listContainer: {
    gap: 8,
    padding: 16,
    paddingBottom: 40,
  },
  eventListItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  eventDetailHeader: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 8,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  taskTitle: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  priorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reminderPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  alertItem: {
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    flexShrink: 0,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  emptyTasks: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
    borderWidth: 1,
    borderRadius: 8,
    borderStyle: "dashed",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 4,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  priorityBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  addBtn: {
    padding: 13,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
  },
  mobileDetailHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
});
