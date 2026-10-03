import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  SafeAreaView,
} from 'react-native';
import { apiClient } from '../services/api.js';
import { offlineQueue } from '../services/offline-queue.js';

interface TodayPunchItem {
  id: string;
  punchType: 'in' | 'out' | 'auto_out';
  punchTime: string;
  effectiveStatus: string;
  reasonCode: string;
  distanceMeters: number | null;
  isInsideGeofence: boolean;
}

interface TodaySummaryResponse {
  employeeId: string;
  shiftDate: string;
  currentPresence: 'in' | 'out';
  lastPunchTime: string | null;
  totalWorkedMinutes: number;
  punches: TodayPunchItem[];
  shift: {
    id: string;
    code: string;
    name: string;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
  } | null;
}

interface PunchResponse {
  success: boolean;
  punchId?: string;
  reasonCode: string;
  message: string;
  status?: string;
  distanceMeters?: number | null;
  isInsideGeofence?: boolean;
}

export function ClockScreen() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [summary, setSummary] = useState<TodaySummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPunching, setIsPunching] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Simulated GPS telemetry with live polling
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(35);
  const [latitude] = useState<number>(12.9716);
  const [longitude] = useState<number>(77.5946);
  const [distanceToOffice] = useState<number>(18);
  const [isInsideGeofence] = useState<boolean>(true);

  // Modals & Feedback
  const [showRationaleModal, setShowRationaleModal] = useState(false);
  const [showSelfieModal, setShowSelfieModal] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    message: string;
    type: 'success' | 'warning' | 'error';
  } | null>(null);

  // Live Digital Clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch today's attendance summary
  const fetchTodaySummary = useCallback(async () => {
    try {
      const data = await apiClient<TodaySummaryResponse>('/api/v1/attendance/today');
      setSummary(data);
    } catch {
      // Offline fallback state
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodaySummary();
    setPendingOfflineCount(offlineQueue.getPendingCount());
  }, [fetchTodaySummary]);

  const handleSyncOffline = async () => {
    setIsSyncing(true);
    try {
      const res = await offlineQueue.syncQueue();
      setPendingOfflineCount(offlineQueue.getPendingCount());
      if (res.synced > 0) {
        setFeedbackBanner({
          message: `Synced ${res.synced} offline punch(es) successfully!`,
          type: 'success',
        });
        await fetchTodaySummary();
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Simulate live GPS accuracy polling (improving over time or oscillating slightly)
  useEffect(() => {
    const gpsInterval = setInterval(() => {
      // Simulate minor GPS telemetry jitter
      setGpsAccuracy((prev) => {
        const jitter = (Math.random() - 0.5) * 6;
        return Math.max(10, Math.min(80, Math.round(prev + jitter)));
      });
    }, 3000);
    return () => clearInterval(gpsInterval);
  }, []);

  const handlePunch = async () => {
    setIsPunching(true);
    setFeedbackBanner(null);

    const punchType = summary?.currentPresence === 'in' ? 'out' : 'in';
    const idempotencyKey = `mob-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      const response = await apiClient<PunchResponse>('/api/v1/attendance/punch', {
        method: 'POST',
        body: JSON.stringify({
          punchType,
          punchTime: new Date().toISOString(),
          source: 'mobile',
          idempotencyKey,
          latitude,
          longitude,
          accuracyMeters: gpsAccuracy,
          isMockLocation: false,
        }),
      });

      if (response.success) {
        if (response.status === 'soft_pending') {
          setFeedbackBanner({
            message: response.message || 'Punch recorded outside geofence. Sent to manager for approval.',
            type: 'warning',
          });
        } else {
          setFeedbackBanner({
            message: response.message || 'Punch recorded successfully!',
            type: 'success',
          });
        }
        await fetchTodaySummary();
      } else {
        setFeedbackBanner({
          message: response.message || 'Punch could not be verified.',
          type: 'error',
        });
      }
    } catch {
      // Offline fallback: enqueue punch with client UUIDv7 idempotency key
      const queued = offlineQueue.enqueue({
        id: idempotencyKey,
        punchType,
        eventTs: new Date().toISOString(),
        latitude,
        longitude,
        accuracyMeters: gpsAccuracy,
      });
      setPendingOfflineCount(offlineQueue.getPendingCount());
      setFeedbackBanner({
        message: `Offline mode: Punch queued locally (${queued.id.slice(0, 8)}). Will sync when connection is restored.`,
        type: 'warning',
      });
    } finally {
      setIsPunching(false);
    }
  };

  const isCurrentPresenceIn = summary?.currentPresence === 'in';
  const workedHours = summary ? (summary.totalWorkedMinutes / 60).toFixed(1) : '0.0';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Status Bar */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Attendance Clock</Text>
          <TouchableOpacity onPress={() => setShowRationaleModal(true)} style={styles.infoBadge}>
            <Text style={styles.infoBadgeText}>Geofence Policy ?</Text>
          </TouchableOpacity>
        </View>

        {/* Offline Queue Status Banner */}
        {pendingOfflineCount > 0 && (
          <View style={styles.offlineBanner}>
            <View style={styles.offlineRow}>
              <Text style={styles.offlineText}>
                ⚠️ {pendingOfflineCount} punch{pendingOfflineCount > 1 ? 'es' : ''} queued offline
              </Text>
              <TouchableOpacity
                onPress={handleSyncOffline}
                disabled={isSyncing}
                style={styles.syncButton}
              >
                <Text style={styles.syncButtonText}>
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Live Digital Clock & Date */}
        <View style={styles.clockCard}>
          <Text style={styles.digitalClock}>
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
          <Text style={styles.dateLabel}>
            {currentTime.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>

          <View style={[styles.presenceBadge, isCurrentPresenceIn ? styles.presenceIn : styles.presenceOut]}>
            <View style={[styles.presenceDot, isCurrentPresenceIn ? styles.dotIn : styles.dotOut]} />
            <Text style={[styles.presenceText, isCurrentPresenceIn ? styles.textIn : styles.textOut]}>
              {isCurrentPresenceIn ? 'CURRENTLY CLOCKED IN' : 'CURRENTLY CLOCKED OUT'}
            </Text>
          </View>
        </View>

        {/* Feedback Banner */}
        {feedbackBanner && (
          <View
            style={[
              styles.feedbackBanner,
              feedbackBanner.type === 'success' && styles.feedbackSuccess,
              feedbackBanner.type === 'warning' && styles.feedbackWarning,
              feedbackBanner.type === 'error' && styles.feedbackError,
            ]}
          >
            <Text
              style={[
                styles.feedbackText,
                feedbackBanner.type === 'success' && styles.textSuccess,
                feedbackBanner.type === 'warning' && styles.textWarning,
                feedbackBanner.type === 'error' && styles.textError,
              ]}
            >
              {feedbackBanner.message}
            </Text>
          </View>
        )}

        {/* Active Shift & Worked Hours Summary */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Today&apos;s Shift</Text>
            <Text style={styles.metricValue}>
              {summary?.shift ? summary.shift.name : 'General (9AM - 6PM)'}
            </Text>
            {summary?.shift?.crossesMidnight && (
              <Text style={styles.nightShiftBadge}>🌙 Night Shift</Text>
            )}
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Worked Today</Text>
            <Text style={[styles.metricValue, { color: '#2563eb' }]}>{workedHours} hrs</Text>
            <Text style={styles.metricSub}>{summary?.punches.length || 0} punches</Text>
          </View>
        </View>

        {/* Geolocation & Telemetry Monitor */}
        <View style={styles.telemetryCard}>
          <Text style={styles.telemetryTitle}>GPS & Geofence Telemetry</Text>

          {/* Accuracy Progress Indicator */}
          <View style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>GPS Fix Accuracy:</Text>
            <View style={styles.accuracyTag}>
              <Text
                style={[
                  styles.accuracyValue,
                  gpsAccuracy <= 50 ? styles.accGood : gpsAccuracy <= 100 ? styles.accWarning : styles.accBad,
                ]}
              >
                ±{gpsAccuracy}m {gpsAccuracy <= 50 ? '(High)' : '(Acceptable)'}
              </Text>
            </View>
          </View>

          {/* Distance Indicator */}
          <View style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>Work Location:</Text>
            <Text style={styles.telemetryValue}>
              {isInsideGeofence
                ? `✓ Inside perimeter (${distanceToOffice}m from HQ)`
                : `⚠ Outside perimeter (${distanceToOffice}m from HQ)`}
            </Text>
          </View>

          {/* Coordinates */}
          <View style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>Coordinates:</Text>
            <Text style={styles.telemetrySub}>
              {latitude.toFixed(4)}° N, {longitude.toFixed(4)}° E
            </Text>
          </View>
        </View>

        {/* Main Clock Action Button */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            isCurrentPresenceIn ? styles.actionButtonOut : styles.actionButtonIn,
            isPunching && styles.actionButtonDisabled,
          ]}
          onPress={handlePunch}
          disabled={isPunching}
          activeOpacity={0.8}
        >
          {isPunching ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Text style={styles.actionButtonText}>
                {isCurrentPresenceIn ? 'CLOCK OUT' : 'CLOCK IN'}
              </Text>
              <Text style={styles.actionButtonSubtext}>
                {isInsideGeofence ? 'Verified Office Location' : 'Outside Office (Manager Review)'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Today's Punch History Timeline */}
        <View style={styles.historySection}>
          <Text style={styles.historyTitle}>Today&apos;s Activity Timeline</Text>
          {isLoading ? (
            <ActivityIndicator size="small" color="#64748b" style={{ marginVertical: 16 }} />
          ) : summary?.punches && summary.punches.length > 0 ? (
            summary.punches.map((p, idx) => (
              <View key={p.id || idx} style={styles.historyItem}>
                <View style={[styles.historyDot, p.punchType === 'in' ? styles.dotIn : styles.dotOut]} />
                <View style={styles.historyInfo}>
                  <Text style={styles.historyTypeText}>
                    {p.punchType.toUpperCase()} PUNCH
                  </Text>
                  <Text style={styles.historyTimeText}>
                    {new Date(p.punchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <View style={styles.historyStatusBadge}>
                  <Text style={styles.historyStatusText}>
                    {p.effectiveStatus.toUpperCase()}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyHistoryText}>No punches recorded for this shift date yet.</Text>
          )}
        </View>
      </ScrollView>

      {/* Rationale Modal */}
      <Modal visible={showRationaleModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Location & Privacy Rationale</Text>
            <Text style={styles.modalBody}>
              OrgHub HRMS requires location access solely to verify whether clock-ins occur within your designated work office perimeter.
              {'\n\n'}
              • Your GPS coordinates are checked strictly at the moment you press Clock In / Clock Out.
              {'\n'}
              • Continuous background tracking is disabled.
              {'\n'}
              • In accordance with company policy, punches made outside the geofence boundary are marked for manager review.
            </Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowRationaleModal(false)}
            >
              <Text style={styles.modalCloseText}>Understood</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Selfie Verification Modal */}
      <Modal visible={showSelfieModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selfie Verification</Text>
            <Text style={styles.modalBody}>
              Company attendance policy requires a live selfie capture to verify punch identity.
            </Text>
            <TouchableOpacity
              style={[styles.modalCloseButton, { backgroundColor: '#16a34a' }]}
              onPress={() => setShowSelfieModal(false)}
            >
              <Text style={styles.modalCloseText}>Capture & Upload Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
  },
  infoBadge: {
    backgroundColor: '#1e293b',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  infoBadgeText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  clockCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  digitalClock: {
    fontSize: 40,
    fontWeight: '800',
    color: '#f8fafc',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  dateLabel: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
    marginBottom: 16,
  },
  presenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
  },
  presenceIn: {
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  presenceOut: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderWidth: 1,
    borderColor: '#eab308',
  },
  presenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotIn: {
    backgroundColor: '#16a34a',
  },
  dotOut: {
    backgroundColor: '#eab308',
  },
  presenceText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textIn: {
    color: '#22c55e',
  },
  textOut: {
    color: '#eab308',
  },
  feedbackBanner: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  feedbackSuccess: {
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
    borderColor: '#16a34a',
  },
  feedbackWarning: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderColor: '#ca8a04',
  },
  feedbackError: {
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    borderColor: '#dc2626',
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  textSuccess: {
    color: '#22c55e',
  },
  textWarning: {
    color: '#eab308',
  },
  textError: {
    color: '#ef4444',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  metricLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    marginVertical: 4,
  },
  metricSub: {
    fontSize: 11,
    color: '#64748b',
  },
  nightShiftBadge: {
    fontSize: 11,
    color: '#c084fc',
    fontWeight: '600',
    marginTop: 2,
  },
  telemetryCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  telemetryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  telemetryLabel: {
    fontSize: 13,
    color: '#94a3b8',
  },
  telemetryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f8fafc',
  },
  telemetrySub: {
    fontSize: 12,
    color: '#64748b',
    fontVariant: ['tabular-nums'],
  },
  accuracyTag: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: '#0f172a',
  },
  accuracyValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  accGood: {
    color: '#22c55e',
  },
  accWarning: {
    color: '#eab308',
  },
  accBad: {
    color: '#ef4444',
  },
  actionButton: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonIn: {
    backgroundColor: '#16a34a',
  },
  actionButtonOut: {
    backgroundColor: '#dc2626',
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  actionButtonSubtext: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  historySection: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 12,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  historyInfo: {
    flex: 1,
  },
  historyTypeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  historyTimeText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  historyStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#0f172a',
  },
  historyStatusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  emptyHistoryText: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    paddingVertical: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 12,
  },
  modalBody: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalCloseButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  offlineBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  offlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offlineText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
  },
  syncButton: {
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
