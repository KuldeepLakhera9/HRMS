import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';

const CURRENT_CONSENT_VERSION = 'v2.3-2026-03';

interface ConsentScreenProps {
  onConsentAccepted: (version: string) => void;
  onConsentDeclined: () => void;
}

export function ConsentScreen({ onConsentAccepted, onConsentDeclined }: ConsentScreenProps) {
  const [agreedLocation, setAgreedLocation] = useState(false);
  const [agreedCamera, setAgreedCamera] = useState(false);
  const [agreedDevice, setAgreedDevice] = useState(false);

  const canProceed = agreedLocation && agreedCamera && agreedDevice;

  const handleAccept = () => {
    if (typeof globalThis !== 'undefined') {
      (globalThis as Record<string, unknown>)['hrms_consent_version'] = CURRENT_CONSENT_VERSION;
      (globalThis as Record<string, unknown>)['hrms_consent_timestamp'] = new Date().toISOString();
    }
    onConsentAccepted(CURRENT_CONSENT_VERSION);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.versionBadge}>Consent Policy {CURRENT_CONSENT_VERSION}</Text>
          <Text style={styles.title}>Privacy & Device Permissions</Text>
          <Text style={styles.subtitle}>
            To ensure secure, transparent, and accurate attendance verification, the HRMS mobile app requires your consent for the following device telemetry.
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>📍</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.sectionTitle}>1. Geofence & Location Data</Text>
            <Text style={styles.sectionDesc}>
              Precise GPS coordinates are captured <Text style={styles.bold}>only at the exact moment</Text> you tap Clock In or Clock Out to verify that you are within your assigned workplace geofence. The app <Text style={styles.bold}>never</Text> tracks your location continuously or in the background.
            </Text>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setAgreedLocation(!agreedLocation)}
            >
              <View style={[styles.checkbox, agreedLocation && styles.checkboxActive]}>
                {agreedLocation && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>I consent to one-shot location capture on punch</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>📸</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.sectionTitle}>2. Front Camera & Selfie Verification</Text>
            <Text style={styles.sectionDesc}>
              When mandated by company attendance policy, a single selfie photo is captured at punch time to deter proxy attendance. Images are encrypted at rest and automatically purged per data retention policy.
            </Text>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setAgreedCamera(!agreedCamera)}
            >
              <View style={[styles.checkbox, agreedCamera && styles.checkboxActive]}>
                {agreedCamera && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>I consent to camera access for attendance selfies</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>📱</Text>
          </View>
          <View style={styles.sectionBody}>
            <Text style={styles.sectionTitle}>3. Device Fingerprint & Attestation</Text>
            <Text style={styles.sectionDesc}>
              A hardware identifier and cryptographic device attestation (Play Integrity / App Attest) are bound to your employee account to enforce one-active-device policy and block emulator spoofing.
            </Text>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setAgreedDevice(!agreedDevice)}
            >
              <View style={[styles.checkbox, agreedDevice && styles.checkboxActive]}>
                {agreedDevice && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>I consent to device binding and integrity attestation</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, !canProceed && styles.acceptButtonDisabled]}
            disabled={!canProceed}
            onPress={handleAccept}
          >
            <Text style={styles.acceptButtonText}>Accept & Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.declineButton} onPress={onConsentDeclined}>
            <Text style={styles.declineButtonText}>Decline & Log Out</Text>
          </TouchableOpacity>
        </View>
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
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  versionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8,
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
  sectionCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 18,
  },
  sectionBody: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 10,
  },
  bold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkboxActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
  },
  actions: {
    marginTop: 10,
  },
  acceptButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  acceptButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  declineButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  declineButtonText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
});
