/**
 * NetworkBanner — shows a non-dismissible pill when device is offline.
 * Uses @react-native-community/netinfo to react to connectivity changes.
 *
 * WHY non-dismissible: the WebView will silently fail on API calls when
 * offline. Making the banner sticky removes user confusion about why actions
 * aren't working.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

export function NetworkBanner() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [anim] = useState(new Animated.Value(0));

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected ?? true;
      setIsConnected(connected);
      Animated.timing(anim, {
        toValue: connected ? 0 : 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    });
    return () => unsubscribe();
  }, [anim]);

  // Don't render anything while online
  if (isConnected !== false) return null;

  return (
    <Animated.View
      style={[styles.banner, { opacity: anim }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel="You are offline. Some features are unavailable."
    >
      <Text style={styles.text}>No internet connection</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#EF4444',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
