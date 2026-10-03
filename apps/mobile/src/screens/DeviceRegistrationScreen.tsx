import React, { useState, useEffect, useCallback } from 'react';
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

interface DeviceData {
  id: string;
  hardwareId: string;
  deviceModel: string;
  platform: 'android' | 'ios' | 'web';
  status: 'active' | 'pending_approval' | 'revoked';
  attestationStatus: string;
  lastSeenAt: string;
  workflowRequestId?: string | null;
}

interface DeviceRegistrationScreenProps {
  onDeviceReady: (device: DeviceData) => void;
}

export function DeviceRegistrationScreen({ onDeviceReady }: DeviceRegistrationScreenProps) {
  const [device, setDevice] = useState<DeviceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Simulated hardware telemetry on device
  const currentHardwareId = 'hw-fingerprint-px8-9941a8';
  const currentModel = 'Google Pixel 8 (Android 14)';
  const currentPlatform = 'android' as const;

  const fetchCurrentDevice = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiClient<DeviceData | null>('/api/v1/attendance/devices/my');
      setDevice(res);
      if (res && res.status === 'active') {
        onDeviceReady(res);
      }
    } catch {
      // 404 or no device registered yet
      setDevice(null);
    } finally {
      setIsLoading(false);
    }
  }, [onDeviceReady]);

  useEffect(() => {
    fetchCurrentDevice();
  }, [fetchCurrentDevice]);

  const handleRegister = async () => {
    setIsRegistering(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await apiClient<{
        device: DeviceData;
        requiresApproval: boolean;
        workflowRequestId?: string;
      }>('/api/v1/attendance/devices/register', {
        method: 'POST',
        body: JSON.stringify({
          hardwareId: currentHardwareId,
          deviceModel: currentModel,
          platform: currentPlatform,
          appVersion: '1.4.0',
          osVersion: 'Android 14 (API 34)',
          attestationPayload: 'dev-token-stub-verified',
        }),
      });

      setDevice(result.device);

      if (result.requiresApproval) {
        setStatusMessage(
          'Device change approval request submitted to your manager. You can clock in once approved.',
        );
      } else {
        setStatusMessage('Device registered and activated successfully!');
        onDeviceReady(result.device);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Device Registration</Text>
          <Text style={styles.subtitle}>
            Enforcing 1-active-device security policy. Attendance can only be recorded from your verified primary device.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text style={styles.loadingText}>Checking device binding status...</Text>
          </View>
        ) : (
          <>
            {/* Status Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Current Device Telemetry</Text>
                <View
                  style={[
                    styles.statusBadge,
                    device?.status === 'active'
                      ? styles.statusActive
                      : device?.status === 'pending_approval'
                      ? styles.statusPending
                      : styles.statusUnregistered,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      device?.status === 'active'
                        ? styles.textActive
                        : device?.status === 'pending_approval'
                        ? styles.textPending
                        : styles.textUnregistered,
                    ]}
                  >
                    {device?.status ? device.status.replace('_', ' ').toUpperCase() : 'NOT REGISTERED'}
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Hardware Fingerprint:</Text>
                <Text style={styles.infoValueMono}>{currentHardwareId}</Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Device Model:</Text>
                <Text style={styles.infoValue}>{currentModel}</Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Platform:</Text>
                <Text style={styles.infoValue}>Android 14</Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Attestation Security:</Text>
                <Text style={styles.infoValue}>Hardware Keystore (Play Integrity)</Text>
              </View>
            </View>

            {/* Workflow Notice if another device active */}
            {device && device.hardwareId !== currentHardwareId && device.status === 'active' && (
              <View style={styles.warningCard}>
                <Text style={styles.warningTitle}>⚠️ Active Device Conflict</Text>
                <Text style={styles.warningText}>
                  Another device ({device.deviceModel}) is currently bound to your account. Registering this new device will automatically submit an approval workflow to your manager.
                </Text>
              </View>
            )}

            {/* Pending Workflow Banner */}
            {device?.status === 'pending_approval' && (
              <View style={styles.pendingCard}>
                <Text style={styles.pendingTitle}>⏳ Awaiting Manager Approval</Text>
                <Text style={styles.pendingText}>
                  Your device replacement request is currently under review by your reporting manager. Once approved, this device will become active for clocking in.
                </Text>
              </View>
            )}

            {/* Status / Error feedback */}
            {statusMessage && (
              <View style={styles.feedbackSuccess}>
                <Text style={styles.feedbackSuccessText}>{statusMessage}</Text>
              </View>
            )}

            {errorMessage && (
              <View style={styles.feedbackError}>
                <Text style={styles.feedbackErrorText}>{errorMessage}</Text>
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {(!device || device.hardwareId !== currentHardwareId || device.status !== 'active') && (
                <TouchableOpacity
                  style={[styles.registerButton, isRegistering && styles.buttonDisabled]}
                  disabled={isRegistering}
                  onPress={handleRegister}
                >
                  <Text style={styles.registerButtonText}>
                    {isRegistering ? 'Registering Device...' : 'Register & Bind Device'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.refreshButton} onPress={fetchCurrentDevice}>
                <Text style={styles.refreshButtonText}>Refresh Device Status</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  loadingContainer: {
    paddingVertical: 50,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusActive: {
    backgroundColor: '#ECFDF5',
  },
  statusPending: {
    backgroundColor: '#FFFBEB',
  },
  statusUnregistered: {
    backgroundColor: '#F1F5F9',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textActive: {
    color: '#059669',
  },
  textPending: {
    color: '#D97706',
  },
  textUnregistered: {
    color: '#64748B',
  },
  infoRow: {
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  infoValueMono: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
    fontFamily: 'monospace',
  },
  warningCard: {
    backgroundColor: '#FFFBEB',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 16,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  pendingCard: {
    backgroundColor: '#EFF6FF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 16,
  },
  pendingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D4ED8',
    marginBottom: 4,
  },
  pendingText: {
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 18,
  },
  feedbackSuccess: {
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  feedbackSuccessText: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackError: {
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  feedbackErrorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    marginTop: 10,
  },
  registerButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonDisabled: {
    backgroundColor: '#94A3B8',
  },
  registerButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  refreshButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  refreshButtonText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
});
