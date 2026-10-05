import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { apiClient } from '../services/api.js';
import { AttendanceDayDetailScreen } from './AttendanceDayDetailScreen.js';
import { RegularizationModal } from './RegularizationModal.js';

export interface CalendarDaySummary {
  date: string;
  status: 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'weekly_off';
  firstIn: string | null;
  lastOut: string | null;
  totalWorkMinutes: number;
  isRegularized: boolean;
}

export interface CalendarResponse {
  from: string;
  to: string;
  summary: {
    presentDays: number;
    halfDays: number;
    absentDays: number;
    onLeaveDays: number;
    holidays: number;
    weeklyOffDays: number;
    regularizedCount: number;
  };
  days: CalendarDaySummary[];
}

export function AttendanceHistoryScreen() {
  const [currentYearMonth, setCurrentYearMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const [data, setData] = useState<CalendarResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Detail view state
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showRegModal, setShowRegModal] = useState(false);

  const fetchCalendar = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const y = currentYearMonth.year;
    const m = currentYearMonth.month; // 0-indexed
    const fromStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    // Last day of month
    const lastDay = new Date(y, m + 1, 0).getDate();
    const toStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    try {
      const res = await apiClient<CalendarResponse>(
        `/api/v1/attendance/calendar?from=${fromStr}&to=${toStr}`,
      );
      setData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load attendance calendar.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentYearMonth]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  const handlePrevMonth = () => {
    setCurrentYearMonth(prev => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 };
      }
      return { year: prev.year, month: prev.month - 1 };
    });
  };

  const handleNextMonth = () => {
    setCurrentYearMonth(prev => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 };
      }
      return { year: prev.year, month: prev.month + 1 };
    });
  };

  const getMonthName = (monthIdx: number) => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return months[monthIdx] || '';
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'present':
        return '#10b981';
      case 'half_day':
        return '#f59e0b';
      case 'absent':
        return '#ef4444';
      case 'on_leave':
        return '#8b5cf6';
      case 'holiday':
      case 'weekly_off':
        return '#3b82f6';
      default:
        return '#94a3b8';
    }
  };

  if (selectedDate) {
    return (
      <AttendanceDayDetailScreen
        date={selectedDate}
        onBack={() => {
          setSelectedDate(null);
          fetchCalendar();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Top App Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Attendance History</Text>
        <TouchableOpacity
          style={styles.regButton}
          onPress={() => setShowRegModal(true)}
        >
          <Text style={styles.regButtonText}>+ Regularize</Text>
        </TouchableOpacity>
      </View>

      {/* Month Navigator */}
      <View style={styles.monthNavigator}>
        <TouchableOpacity style={styles.navButton} onPress={handlePrevMonth}>
          <Text style={styles.navButtonText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>
          {getMonthName(currentYearMonth.month)} {currentYearMonth.year}
        </Text>
        <TouchableOpacity style={styles.navButton} onPress={handleNextMonth}>
          <Text style={styles.navButtonText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* KPI Chips */}
      {data?.summary && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kpiContainer}
        >
          <View style={[styles.kpiBadge, { backgroundColor: '#064e3b' }]}>
            <Text style={[styles.kpiValue, { color: '#6ee7b7' }]}>{data.summary.presentDays}</Text>
            <Text style={styles.kpiTitle}>Present</Text>
          </View>

          <View style={[styles.kpiBadge, { backgroundColor: '#78350f' }]}>
            <Text style={[styles.kpiValue, { color: '#fcd34d' }]}>{data.summary.halfDays}</Text>
            <Text style={styles.kpiTitle}>Half Day</Text>
          </View>

          <View style={[styles.kpiBadge, { backgroundColor: '#7f1d1d' }]}>
            <Text style={[styles.kpiValue, { color: '#fca5a5' }]}>{data.summary.absentDays}</Text>
            <Text style={styles.kpiTitle}>Absent</Text>
          </View>

          <View style={[styles.kpiBadge, { backgroundColor: '#1e3a8a' }]}>
            <Text style={[styles.kpiValue, { color: '#93c5fd' }]}>
              {data.summary.holidays + data.summary.weeklyOffDays}
            </Text>
            <Text style={styles.kpiTitle}>Off/Holiday</Text>
          </View>

          {data.summary.regularizedCount > 0 && (
            <View style={[styles.kpiBadge, { backgroundColor: '#4c1d95' }]}>
              <Text style={[styles.kpiValue, { color: '#c4b5fd' }]}>
                {data.summary.regularizedCount}
              </Text>
              <Text style={styles.kpiTitle}>Regularized</Text>
            </View>
          )}
        </ScrollView>
      )}

      {isLoading && !isRefreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading attendance data...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchCalendar}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.dayList}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                setIsRefreshing(true);
                fetchCalendar();
              }}
              tintColor="#38bdf8"
            />
          }
        >
          {(!data?.days || data.days.length === 0) ? (
            <Text style={styles.emptyText}>No attendance records found for this period.</Text>
          ) : (
            data.days.map(day => {
              const dayDate = new Date(day.date);
              const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'short' });
              const dayNum = day.date.slice(8, 10);
              const statusColor = getStatusColor(day.status);

              return (
                <TouchableOpacity
                  key={day.date}
                  style={styles.dayCard}
                  onPress={() => setSelectedDate(day.date)}
                  activeOpacity={0.7}
                >
                  <View style={styles.dateCol}>
                    <Text style={styles.dayNum}>{dayNum}</Text>
                    <Text style={styles.dayName}>{dayName}</Text>
                  </View>

                  <View style={styles.infoCol}>
                    <View style={styles.statusRow}>
                      <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
                        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                        <Text style={[styles.statusText, { color: statusColor }]}>
                          {day.status.replace('_', ' ').toUpperCase()}
                        </Text>
                      </View>

                      {day.isRegularized && (
                        <View style={styles.regChip}>
                          <Text style={styles.regChipText}>REG</Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.timingsText}>
                      In: {formatTime(day.firstIn)}  •  Out: {formatTime(day.lastOut)}
                    </Text>
                  </View>

                  <View style={styles.hoursCol}>
                    <Text style={styles.hoursValue}>
                      {(day.totalWorkMinutes / 60).toFixed(1)}h
                    </Text>
                    <Text style={styles.chevron}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <RegularizationModal
        visible={showRegModal}
        onClose={() => setShowRegModal(false)}
        onSuccess={() => {
          fetchCalendar();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
  },
  regButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  regButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  monthNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonText: {
    color: '#38bdf8',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  monthLabel: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  kpiContainer: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 10,
  },
  kpiBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 70,
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  kpiTitle: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 12,
  },
  errorText: {
    color: '#f87171',
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  dayList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
  dayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dateCol: {
    width: 44,
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#334155',
    paddingRight: 10,
    marginRight: 12,
  },
  dayNum: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700',
  },
  dayName: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  infoCol: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  regChip: {
    backgroundColor: '#4c1d95',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  regChipText: {
    color: '#c4b5fd',
    fontSize: 9,
    fontWeight: '800',
  },
  timingsText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  hoursCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hoursValue: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  chevron: {
    color: '#64748b',
    fontSize: 20,
    fontWeight: '300',
  },
});
