import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen.js';
import { ClockScreen } from './src/screens/ClockScreen.js';
import { AttendanceHistoryScreen } from './src/screens/AttendanceHistoryScreen.js';
import { ManagerApprovalsScreen } from './src/screens/ManagerApprovalsScreen.js';
import { DiagnosticsScreen } from './src/screens/DiagnosticsScreen.js';
import { authService, type LoginResult } from './src/services/auth.js';
import { storage } from './src/services/storage.js';

type TabType = 'clock' | 'calendar' | 'approvals' | 'diagnostics';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('clock');
  const [versionTapCount, setVersionTapCount] = useState(0);

  useEffect(() => {
    async function bootstrap() {
      try {
        const isAuth = await authService.isAuthenticated();
        if (isAuth) {
          const userData = await storage.getUserData();
          setUser(userData);
        }
      } catch {
        // Fallback to unauthenticated on error
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  const handleLoginSuccess = (result: LoginResult) => {
    if (result.user) {
      setUser(result.user as unknown as Record<string, unknown>);
    } else {
      setUser({ authenticated: true });
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await authService.logout();
    setUser(null);
    setLoading(false);
  };

  const handleVersionTap = () => {
    const nextCount = versionTapCount + 1;
    if (nextCount >= 7) {
      setVersionTapCount(0);
      setActiveTab('diagnostics');
    } else {
      setVersionTapCount(nextCount);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Initializing HRMS...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.appTitle}>HRMS Mobile</Text>
          <TouchableOpacity onPress={handleVersionTap} activeOpacity={0.8}>
            <Text style={styles.appSubtitle}>
              v0.1.0-p2.4 {(user.firstName as string) ? `• ${user.firstName}` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Screen View */}
      <View style={styles.body}>
        {activeTab === 'clock' && <ClockScreen />}
        {activeTab === 'calendar' && <AttendanceHistoryScreen />}
        {activeTab === 'approvals' && <ManagerApprovalsScreen />}
        {activeTab === 'diagnostics' && (
          <DiagnosticsScreen onBack={() => setActiveTab('clock')} />
        )}
      </View>

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navItem, activeTab === 'clock' && styles.navItemActive]}
          onPress={() => setActiveTab('clock')}
        >
          <Text style={[styles.navIcon, activeTab === 'clock' && styles.navIconActive]}>⏰</Text>
          <Text style={[styles.navLabel, activeTab === 'clock' && styles.navLabelActive]}>Clock</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'calendar' && styles.navItemActive]}
          onPress={() => setActiveTab('calendar')}
        >
          <Text style={[styles.navIcon, activeTab === 'calendar' && styles.navIconActive]}>📅</Text>
          <Text style={[styles.navLabel, activeTab === 'calendar' && styles.navLabelActive]}>Calendar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'approvals' && styles.navItemActive]}
          onPress={() => setActiveTab('approvals')}
        >
          <Text style={[styles.navIcon, activeTab === 'approvals' && styles.navIconActive]}>✅</Text>
          <Text style={[styles.navLabel, activeTab === 'approvals' && styles.navLabelActive]}>Approvals</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'diagnostics' && styles.navItemActive]}
          onPress={() => setActiveTab('diagnostics')}
        >
          <Text style={[styles.navIcon, activeTab === 'diagnostics' && styles.navIconActive]}>🛠️</Text>
          <Text style={[styles.navLabel, activeTab === 'diagnostics' && styles.navLabelActive]}>Diagnostics</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  appTitle: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  logoutBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  logoutBtnText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: '#0f172a',
  },
  navIcon: {
    fontSize: 18,
    opacity: 0.6,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
});
