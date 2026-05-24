/**
 * BiometricGate — blocks the WebView behind a biometric prompt.
 *
 * WHY a separate component: keeps App.tsx lean. The gate owns its own retry
 * state and passcode-fallback messaging so App.tsx only needs to know
 * "locked | unlocked".
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { authenticate, type BiometricType } from '../bridge/biometric';

interface Props {
  biometricType: BiometricType;
  onUnlocked: () => void;
}

export function BiometricGate({ biometricType, onUnlocked }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = biometricType === 'face' ? 'Face ID' : 'Touch ID';
  const icon = biometricType === 'face' ? '󰯄' : ''; // system SF symbols unavailable in RN text; real icons go in W7-5

  async function tryAuthenticate() {
    setLoading(true);
    setError(null);
    const result = await authenticate(`Unlock BidStack 360° with ${label}`);
    setLoading(false);
    if (result.success) {
      onUnlocked();
    } else {
      if (result.error === 'user_cancel') {
        setError('Authentication cancelled.');
      } else if (result.error === 'biometric_unavailable') {
        setError('Biometric authentication is not available on this device.');
      } else {
        setError('Authentication failed. Please try again.');
      }
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>BidStack 360°</Text>
        <Text style={styles.subtitle}>Authenticate to continue</Text>

        {loading ? (
          <ActivityIndicator size="large" color="#3B82F6" style={styles.spinner} />
        ) : (
          <TouchableOpacity
            style={styles.button}
            onPress={tryAuthenticate}
            accessibilityRole="button"
            accessibilityLabel={`Unlock with ${label}`}
            // WHY 44px: WCAG 2.2 AA minimum touch target
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.buttonText}>{`Unlock with ${label}`}</Text>
          </TouchableOpacity>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.hint}>
          {Platform.OS === 'ios'
            ? 'You can also use your passcode as a fallback.'
            : 'You can use your PIN or pattern as a fallback.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 32,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#94A3B8',
    marginBottom: 32,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    minWidth: 200,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  spinner: {
    marginVertical: 16,
  },
  error: {
    color: '#F87171',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
  hint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 20,
    textAlign: 'center',
    lineHeight: 18,
  },
});
