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
import { authService, type LoginResult } from './src/services/auth.js';
import { storage } from './src/services/storage.js';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);

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
      <View style={styles.homeContainer}>
        <View style={styles.card}>
          <Text style={styles.cardGreeting}>HRMS Mobile</Text>
          <Text style={styles.cardTitle}>
            Hello, {(user.firstName as string) || 'Employee'}
          </Text>
          <Text style={styles.cardSubtitle}>
            {(user.email as string) || 'Authenticated Session'}
          </Text>

          <View style={styles.badgeContainer}>
            <View style={styles.statusIndicator} />
            <Text style={styles.badgeText}>Ready for Geofence Punch</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Log Out</Text>
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
  homeContainer: {
    flex: 1,
    padding: 24,
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: 20,
  },
  cardGreeting: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 16,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  badgeText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '500',
  },
  logoutButton: {
    backgroundColor: '#334155',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
});
