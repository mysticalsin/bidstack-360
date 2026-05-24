/**
 * Biometric bridge — wraps expo-local-authentication.
 *
 * WHY a separate module: biometric auth has its own capability detection,
 * fallback ladder, and error messages that must be surfaced to the web layer.
 * Keeping them isolated prevents App.tsx from growing beyond 50 lines.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'bidstack.biometric.enabled';

export type BiometricType = 'face' | 'fingerprint' | 'none';

export interface BiometricCapability {
  available: boolean;
  type: BiometricType;
  enrolled: boolean;
}

export interface AuthResult {
  success: boolean;
  error?: string;
}

/** Probe device capability without prompting the user. */
export async function checkBiometricCapability(): Promise<BiometricCapability> {
  const available = await LocalAuthentication.hasHardwareAsync();
  if (!available) {
    return { available: false, type: 'none', enrolled: false };
  }
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

  let type: BiometricType = 'fingerprint';
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    type = 'face';
  }

  return { available, type, enrolled };
}

/**
 * Prompt the user for biometric auth.
 * Returns success:true on pass, success:false + error on cancel/failure.
 */
export async function authenticate(reason?: string): Promise<AuthResult> {
  const capability = await checkBiometricCapability();
  if (!capability.available || !capability.enrolled) {
    return { success: false, error: 'biometric_unavailable' };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason ?? 'Unlock BidStack 360°',
    fallbackLabel: 'Use Passcode',
    // WHY disableDeviceFallback=false: we allow passcode as last resort
    // so locked-out users are never completely blocked from their data.
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });

  if (result.success) {
    return { success: true };
  }

  const errMsg = 'error' in result ? String(result.error) : 'user_cancel';
  return { success: false, error: errMsg };
}

/** Persist biometric opt-in state in secure storage. */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? '1' : '0');
}

/** Read biometric opt-in state. Defaults to false (opt-in required). */
export async function isBiometricEnabled(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return raw === '1';
}
