import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
  Modal,
  RefreshControl,
} from 'react-native';
import { apiClient } from '../services/api.js';

export interface PendingRegularization {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeCode?: string;
  date: string;
  reasonCategory: string;
  reason: string;
  requestedInTime?: string | null;
  requestedOutTime?: string | null;
  createdAt: string;
}

export interface PendingProfileChange {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeCode?: string;
  fields: Record<string, { old: unknown; new: unknown }>;
  reason?: string | null;
  createdAt: string;
}

export function ManagerApprovalsScreen() {
  const [activeTab, setActiveTab] = useState<'regularizations' | 'profile'>('regularizations');
  const [regularizations, setRegularizations] = useState<PendingRegularization[]>([]);
  const [profileChanges, setProfileChanges] = useState<PendingProfileChange[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Review / Comment modal state
  const [selectedItem, setSelectedItem] = useState<{
    id: string;
    type: 'reg' | 'profile';
    action: 'approve' | 'reject';
  } | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchApprovals = useCallback(async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      // Fetch pending regularizations
      try {
        const regRes = await apiClient<{ items: PendingRegularization[] }>(
          '/api/v1/attendance/regularizations?status=pending&pageSize=50',
        );
        setRegularizations(regRes.items || []);
      } catch {
        setRegularizations([]);
      }

      // Fetch pending profile change requests
      try {
        const profRes = await apiClient<{ items: PendingProfileChange[] }>(
          '/api/v1/employee/change-requests?status=submitted&pageSize=50',
        );
        setProfileChanges(profRes.items || []);
      } catch {
        setProfileChanges([]);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleOpenAction = (id: string, type: 'reg' | 'profile', action: 'approve' | 'reject') => {
    setSelectedItem({ id, type, action });
    setComment('');
  };

  const handleExecuteAction = async () => {
    if (!selectedItem) return;
    setIsSubmitting(true);
    setActionError(null);

    try {
      if (selectedItem.type === 'reg') {
        const endpoint = `/api/v1/attendance/regularizations/${selectedItem.id}/${selectedItem.action}`;
        await apiClient(endpoint, {
          method: 'POST',
          body: JSON.stringify({ comment: comment.trim() || undefined }),
        });
        setRegularizations(prev => prev.filter(r => r.id !== selectedItem.id));
        setActionSuccess(`Regularization successfully ${selectedItem.action}d.`);
      } else {
        const endpoint = `/api/v1/employee/change-requests/${selectedItem.id}/review`;
        await apiClient(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            action: selectedItem.action,
            reviewNotes: comment.trim() || undefined,
          }),
        });
        setProfileChanges(prev => prev.filter(p => p.id !== selectedItem.id));
        setActionSuccess(`Profile change request successfully ${selectedItem.action}d.`);
      }

      setSelectedItem(null);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed.';
      setActionError(msg);
    } finally {
      setIsSubmitting(false);
    }
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

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Approvals Inbox</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'regularizations' && styles.tabActive]}
          onPress={() => setActiveTab('regularizations')}
        >
          <Text style={[styles.tabText, activeTab === 'regularizations' && styles.tabTextActive]}>
            Regularizations ({regularizations.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'profile' && styles.tabActive]}
          onPress={() => setActiveTab('profile')}
        >
          <Text style={[styles.tabText, activeTab === 'profile' && styles.tabTextActive]}>
            Profile Changes ({profileChanges.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Feedback alerts */}
      {actionSuccess && (
        <View style={styles.successBanner}>
          <Text style={styles.successBannerText}>{actionSuccess}</Text>
        </View>
      )}

      {actionError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{actionError}</Text>
        </View>
      )}

      {isLoading && !isRefreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Fetching pending approvals...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                setIsRefreshing(true);
                fetchApprovals();
              }}
              tintColor="#38bdf8"
            />
          }
        >
          {activeTab === 'regularizations' ? (
            regularizations.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>All Caught Up!</Text>
                <Text style={styles.emptySubtitle}>No pending regularizations requiring approval.</Text>
              </View>
            ) : (
              regularizations.map(item => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.employeeName}>
                        {item.employeeName || `Employee ${item.employeeId.slice(0, 8)}`}
                      </Text>
                      {item.employeeCode && (
                        <Text style={styles.employeeCode}>{item.employeeCode}</Text>
                      )}
                    </View>
                    <View style={styles.dateBadge}>
                      <Text style={styles.dateBadgeText}>{item.date}</Text>
                    </View>
                  </View>

                  <View style={styles.cardBody}>
                    <View style={styles.categoryPill}>
                      <Text style={styles.categoryPillText}>
                        {item.reasonCategory.replace('_', ' ').toUpperCase()}
                      </Text>
                    </View>

                    <Text style={styles.timeRange}>
                      Requested: {formatTime(item.requestedInTime)} - {formatTime(item.requestedOutTime)}
                    </Text>

                    <Text style={styles.reasonText}>"{item.reason}"</Text>
                  </View>

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.rejectBtn}
                      onPress={() => handleOpenAction(item.id, 'reg', 'reject')}
                    >
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.approveBtn}
                      onPress={() => handleOpenAction(item.id, 'reg', 'approve')}
                    >
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )
          ) : profileChanges.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>All Caught Up!</Text>
              <Text style={styles.emptySubtitle}>No profile change requests pending review.</Text>
            </View>
          ) : (
            profileChanges.map(item => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.employeeName}>
                      {item.employeeName || `Employee ${item.employeeId.slice(0, 8)}`}
                    </Text>
                    {item.employeeCode && (
                      <Text style={styles.employeeCode}>{item.employeeCode}</Text>
                    )}
                  </View>
                </View>

                <View style={styles.cardBody}>
                  <Text style={styles.fieldSectionTitle}>Requested Modifications:</Text>
                  {Object.entries(item.fields || {}).map(([key, val]) => (
                    <View key={key} style={styles.fieldRow}>
                      <Text style={styles.fieldKey}>{key}:</Text>
                      <Text style={styles.fieldDiff}>
                        {String(val?.old ?? '(empty)')} → {String(val?.new ?? '')}
                      </Text>
                    </View>
                  ))}

                  {item.reason && (
                    <Text style={styles.reasonText}>Reason: "{item.reason}"</Text>
                  )}
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => handleOpenAction(item.id, 'profile', 'reject')}
                  >
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.approveBtn}
                    onPress={() => handleOpenAction(item.id, 'profile', 'approve')}
                  >
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Action / Review Confirmation Modal */}
      <Modal visible={!!selectedItem} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Confirm {selectedItem?.action === 'approve' ? 'Approval' : 'Rejection'}
            </Text>
            <Text style={styles.modalSubtitle}>
              Optionally provide remarks or justification for this decision:
            </Text>

            <TextInput
              style={styles.modalInput}
              value={comment}
              onChangeText={setComment}
              placeholder="Add comments / review remarks..."
              placeholderTextColor="#64748b"
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setSelectedItem(null)}
                disabled={isSubmitting}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  selectedItem?.action === 'approve' ? styles.bgApprove : styles.bgReject,
                  isSubmitting && styles.btnDisabled,
                ]}
                onPress={handleExecuteAction}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    {selectedItem?.action === 'approve' ? 'Approve' : 'Reject'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
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
  header: {
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
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    backgroundColor: '#1e293b',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#38bdf8',
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: 16,
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
  successBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderBottomWidth: 1,
    borderBottomColor: '#10b981',
    padding: 10,
    alignItems: 'center',
  },
  successBannerText: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderBottomWidth: 1,
    borderBottomColor: '#ef4444',
    padding: 10,
    alignItems: 'center',
  },
  errorBannerText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  employeeName: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  employeeCode: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  dateBadge: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dateBadgeText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  cardBody: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 10,
    marginBottom: 14,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#3b82f620',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  categoryPillText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '700',
  },
  timeRange: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  reasonText: {
    color: '#94a3b8',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  fieldSectionTitle: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  fieldKey: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  fieldDiff: {
    color: '#f8fafc',
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  rejectBtnText: {
    color: '#ef4444',
    fontWeight: '700',
    fontSize: 13,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: '#10b981',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 13,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 14,
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  bgApprove: {
    backgroundColor: '#10b981',
  },
  bgReject: {
    backgroundColor: '#ef4444',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  modalConfirmText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
