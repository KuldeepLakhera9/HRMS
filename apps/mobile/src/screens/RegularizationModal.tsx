import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { apiClient } from '../services/api.js';

export interface RegularizationModalProps {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  onSuccess?: () => void;
}

export type RegularizationReasonCategory =
  | 'missing_punch'
  | 'incorrect_time'
  | 'on_duty'
  | 'work_from_home'
  | 'technical_issue'
  | 'other';

const CATEGORIES: { label: string; value: RegularizationReasonCategory }[] = [
  { label: 'Missing Punch', value: 'missing_punch' },
  { label: 'Incorrect Time', value: 'incorrect_time' },
  { label: 'On Duty / Client Visit', value: 'on_duty' },
  { label: 'Work From Home', value: 'work_from_home' },
  { label: 'Device / App Issue', value: 'technical_issue' },
  { label: 'Other', value: 'other' },
];

export function RegularizationModal({
  visible,
  onClose,
  initialDate,
  onSuccess,
}: RegularizationModalProps) {
  const [date, setDate] = useState(initialDate || new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<RegularizationReasonCategory>('missing_punch');
  const [inTime, setInTime] = useState('09:00');
  const [outTime, setOutTime] = useState('18:00');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!date.trim()) {
      setErrorMessage('Please provide an attendance date (YYYY-MM-DD).');
      return;
    }
    if (!reason.trim()) {
      setErrorMessage('Please state the justification/reason for regularization.');
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      // Map category to backend RegularizationRequestTypeEnum
      let requestType: 'punch_missing' | 'in_time_change' | 'out_time_change' | 'on_duty' | 'work_from_home' = 'punch_missing';
      if (category === 'on_duty') requestType = 'on_duty';
      else if (category === 'work_from_home') requestType = 'work_from_home';
      else if (category === 'incorrect_time') requestType = 'in_time_change';
      else requestType = 'punch_missing';

      await apiClient('/api/v1/attendance/regularizations', {
        method: 'POST',
        body: JSON.stringify({
          date: date.trim(),
          requestType,
          reason: reason.trim(),
          inTime: inTime.trim() || undefined,
          outTime: outTime.trim() || undefined,
        }),
      });

      setSuccessMessage('Regularization request submitted successfully for approval.');
      setTimeout(() => {
        onSuccess?.();
        onClose();
        setSuccessMessage(null);
        setReason('');
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit regularization request.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheetContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>Request Regularization</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {successMessage ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{successMessage}</Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Attendance Date</Text>
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#64748b"
            />

            <Text style={styles.fieldLabel}>Reason Category</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.value}
                  style={[
                    styles.categoryChip,
                    category === cat.value && styles.categoryChipActive,
                  ]}
                  onPress={() => setCategory(cat.value)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === cat.value && styles.categoryChipTextActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.timeRow}>
              <View style={styles.timeCol}>
                <Text style={styles.fieldLabel}>Requested IN (HH:mm)</Text>
                <TextInput
                  style={styles.input}
                  value={inTime}
                  onChangeText={setInTime}
                  placeholder="09:00"
                  placeholderTextColor="#64748b"
                />
              </View>
              <View style={styles.timeCol}>
                <Text style={styles.fieldLabel}>Requested OUT (HH:mm)</Text>
                <TextInput
                  style={styles.input}
                  value={outTime}
                  onChangeText={setOutTime}
                  placeholder="18:00"
                  placeholderTextColor="#64748b"
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Reason / Justification</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={4}
              placeholder="Explain the reason for regularization (e.g. client meeting offsite, punch sensor failed)..."
              placeholderTextColor="#64748b"
            />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.submitBtn, isSubmitting && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Request</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  closeButton: {
    fontSize: 18,
    color: '#94a3b8',
    padding: 4,
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
  successBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10b981',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    color: '#6ee7b7',
    fontSize: 13,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#cbd5e1',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 4,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  categoryChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#3b82f6',
  },
  categoryChipText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  categoryChipTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timeCol: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 14,
  },
  submitBtn: {
    flex: 2,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
