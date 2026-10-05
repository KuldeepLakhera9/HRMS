import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { apiClient } from '../services/api.js';
import { RegularizationModal } from './RegularizationModal.js';

export interface PunchTimelineItem {
  id: string;
  punchTime: string;
  punchType: 'in' | 'out' | 'auto_out';
  source: 'mobile' | 'biometric' | 'web' | 'system' | 'manual';
  isSynthetic: boolean;
  syntheticReason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceMeters?: number | null;
  isInsideGeofence?: boolean | null;
}

export interface DayDetailData {
  date: string;
  summary: {
    status: 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'weekly_off';
    firstIn: string | null;
    lastOut: string | null;
    totalWorkMinutes: number;
    totalBreakMinutes: number;
    isRegularized: boolean;
  } | null;
  shift: {
    code: string;
    name: string;
    plannedStartTime: string;
    plannedEndTime: string;
  } | null;
  punches: PunchTimelineItem[];
}

export interface AttendanceDayDetailScreenProps {
  date: string;
  onBack: () => void;
  onRequestRegularize?: () => void;
}

export function AttendanceDayDetailScreen({
  date,
  onBack,
}: AttendanceDayDetailScreenProps) {
  const [data, setData] = useState<DayDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRegModal, setShowRegModal] = useState(false);

  const fetchDayDetail = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiClient<DayDetailData>(`/api/v1/attendance/calendar/${date}`);
      setData(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load attendance details.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchDayDetail();
  }, [fetchDayDetail]);

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

  const formatHours = (minutes: number) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hrs}h ${mins}m`;
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{date}</Text>
        <View style={{ width: 60 }} />
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading day record...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchDayDetail}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : data ? (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Status & Work Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(data.summary?.status) + '22' },
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: getStatusColor(data.summary?.status) },
                  ]}
                />
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: getStatusColor(data.summary?.status) },
                  ]}
                >
                  {(data.summary?.status || 'Unknown').toUpperCase()}
                </Text>
              </View>

              {data.summary?.isRegularized ? (
                <View style={styles.regBadge}>
                  <Text style={styles.regBadgeText}>REGULARIZED</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>First In</Text>
                <Text style={styles.metricValue}>
                  {formatTime(data.summary?.firstIn)}
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Last Out</Text>
                <Text style={styles.metricValue}>
                  {formatTime(data.summary?.lastOut)}
                </Text>
              </View>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Work Hours</Text>
                <Text style={styles.metricValue}>
                  {formatHours(data.summary?.totalWorkMinutes || 0)}
                </Text>
              </View>
            </View>
          </View>

          {/* Shift Details */}
          {data.shift ? (
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Shift Schedule</Text>
              <View style={styles.shiftRow}>
                <Text style={styles.shiftName}>{data.shift.name} ({data.shift.code})</Text>
                <Text style={styles.shiftTime}>
                  {data.shift.plannedStartTime} - {data.shift.plannedEndTime}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Punches Timeline */}
          <View style={styles.card}>
            <Text style={styles.cardHeader}>
              Punches Timeline ({data.punches?.length || 0})
            </Text>

            {(!data.punches || data.punches.length === 0) ? (
              <Text style={styles.emptyPunchesText}>No punches recorded on this date.</Text>
            ) : (
              <View style={styles.timeline}>
                {data.punches.map((p, idx) => (
                  <View key={p.id || idx} style={styles.timelineItem}>
                    <View style={styles.timelineLeft}>
                      <View
                        style={[
                          styles.punchDot,
                          p.punchType === 'in' ? styles.punchDotIn : styles.punchDotOut,
                        ]}
                      />
                      {idx < data.punches.length - 1 && <View style={styles.timelineLine} />}
                    </View>

                    <View style={styles.punchDetails}>
                      <View style={styles.punchHeader}>
                        <Text style={styles.punchType}>
                          {p.punchType.toUpperCase()}
                        </Text>
                        <Text style={styles.punchTime}>{formatTime(p.punchTime)}</Text>
                      </View>

                      <View style={styles.tagRow}>
                        <View style={styles.sourceBadge}>
                          <Text style={styles.sourceBadgeText}>{p.source.toUpperCase()}</Text>
                        </View>

                        {p.isSynthetic ? (
                          <View style={styles.syntheticBadge}>
                            <Text style={styles.syntheticBadgeText}>
                              SYNTHETIC {p.syntheticReason ? `(${p.syntheticReason})` : ''}
                            </Text>
                          </View>
                        ) : null}

                        {p.isInsideGeofence !== null && p.isInsideGeofence !== undefined ? (
                          <View
                            style={[
                              styles.geoBadge,
                              p.isInsideGeofence ? styles.geoInside : styles.geoOutside,
                            ]}
                          >
                            <Text
                              style={[
                                styles.geoBadgeText,
                                p.isInsideGeofence ? styles.geoInsideText : styles.geoOutsideText,
                              ]}
                            >
                              {p.isInsideGeofence
                                ? `Inside (${p.distanceMeters ?? 0}m)`
                                : `Outside (${p.distanceMeters ?? 0}m)`}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {p.latitude && p.longitude ? (
                        <Text style={styles.coordsText}>
                          GPS: {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={styles.regularizeButton}
            onPress={() => setShowRegModal(true)}
          >
            <Text style={styles.regularizeButtonText}>Request Regularization</Text>
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>
      ) : null}

      <RegularizationModal
        visible={showRegModal}
        initialDate={date}
        onClose={() => setShowRegModal(false)}
        onSuccess={() => {
          fetchDayDetail();
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#1e293b',
  },
  backButtonText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  errorText: {
    color: '#f87171',
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  summaryCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  regBadge: {
    backgroundColor: '#4c1d95',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  regBadgeText: {
    color: '#c4b5fd',
    fontSize: 11,
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14,
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 4,
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  cardHeader: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  shiftRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shiftName: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  shiftTime: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyPunchesText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  timeline: {
    marginTop: 6,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  timelineLeft: {
    alignItems: 'center',
    width: 24,
    marginRight: 10,
  },
  punchDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: 4,
  },
  punchDotIn: {
    backgroundColor: '#10b981',
  },
  punchDotOut: {
    backgroundColor: '#f59e0b',
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#334155',
    marginTop: 4,
  },
  punchDetails: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  punchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  punchType: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 13,
  },
  punchTime: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  sourceBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  sourceBadgeText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '700',
  },
  syntheticBadge: {
    backgroundColor: '#4c1d95',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  syntheticBadgeText: {
    color: '#ddd6fe',
    fontSize: 10,
    fontWeight: '700',
  },
  geoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  geoInside: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  geoInsideText: {
    color: '#10b981',
  },
  geoOutside: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  geoOutsideText: {
    color: '#ef4444',
  },
  geoBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  coordsText: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  regularizeButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginVertical: 10,
  },
  regularizeButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
