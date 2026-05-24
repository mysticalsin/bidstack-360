# BidStack 360° — Mobile App Setup Guide

> **Scope**: Wave 7 native mobile shell (`apps/mobile/`). Expo SDK 51, EAS Build, App Store + Google Play.
> **Estimated time**: 4–6 hours for first end-to-end build. Store submission review: 1–7 days.

---

## 1. Developer Account Setup

### Apple Developer Program ($99/year)
1. Enroll at [developer.apple.com/programs](https://developer.apple.com/programs/).
2. Agree to the Apple Developer Agreement in App Store Connect.
3. Note your **Team ID** (10-character alphanumeric, visible in Membership tab).
4. Create an App ID: Certificates, IDs & Profiles → App IDs → `+`
   - Bundle ID: `io.bidstack.crm`
   - Enable: Push Notifications, Associated Domains, Sign In with Apple (optional)
5. Generate an **APNs Authentication Key** (.p8):
   - Keys → `+` → "Apple Push Notifications service (APNs)"
   - Download the `.p8` file **once** — Apple won't show it again.
   - Note the **Key ID** (10-char string visible in the list after creation).

### Google Play Developer Account ($25 one-time)
1. Enroll at [play.google.com/console/signup](https://play.google.com/console/signup).
2. Create an app: All Apps → Create App → `io.bidstack.crm`.
3. Complete "App content" policy questionnaire before submission.
4. Create a **service account** for EAS automated submission:
   - Google Play Console → Setup → API access → Create new service account
   - Grant the service account **"Release Manager"** role in Play Console.
   - Download the **JSON key** (keep secret — do not commit).
   - Place it at `apps/mobile/google-service-account.json` (gitignored).

---

## 2. Firebase / FCM Setup (Android push via Expo)

Expo's push service currently supports both FCM Legacy and FCM v1. The worker
is configured with `useFcmV1: true`.

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Register Android app with package `io.bidstack.crm`.
3. Download `google-services.json` — place in `apps/mobile/` (gitignored).
4. In Project Settings → Cloud Messaging → Server key — copy the **FCM Server Key**.
5. Upload to EAS:
   ```bash
   eas credentials --platform android
   # Select: "Set up FCM V1 service account key"
   # Provide the path to your Firebase service account JSON
   ```

---

## 3. EAS CLI Setup

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Authenticate
eas login  # uses Expo account credentials

# Link project (creates EAS project, sets projectId in app.json)
cd apps/mobile
eas init --id REPLACE_WITH_EAS_PROJECT_ID

# Verify
eas whoami
```

Update `apps/mobile/app.json` → `expo.extra.eas.projectId` with the UUID returned by `eas init`.

---

## 4. Code Signing (managed by EAS)

EAS Managed credentials handles certificate generation for both platforms.
You do **not** need to manually create provisioning profiles or APNs certs
for most workflows.

### iOS
```bash
eas credentials --platform ios
# Select "Set up credentials" → EAS will generate:
#   - Distribution certificate (p12)
#   - Provisioning profile (AppStore + AdHoc for TestFlight)
#   - APNs key (upload the .p8 from Step 1)
```

### Android
```bash
eas credentials --platform android
# Select "Set up credentials" → EAS generates a keystore and uploads it.
# The keystore is stored in EAS — download and back up the JKS file.
```

---

## 5. APNs Push Credential Setup

After Step 2 above (Apple Developer), upload your APNs key to EAS:

```bash
eas credentials --platform ios
# → Push Notifications: Upload APNs Key
# Provide:
#   - Path to .p8 file
#   - Key ID (10-char)
#   - Team ID (10-char)
```

EAS stores these securely. The mobile app itself does not touch the APNs key at runtime.

---

## 6. Build Profiles

`apps/mobile/eas.json` defines three profiles:

| Profile | Target | Distribution | URL |
|---------|--------|-------------|-----|
| `development` | iOS Simulator + Android APK | Internal | `http://localhost:5173` |
| `preview` | TestFlight + APK | Internal | `https://app.bidstack.io` |
| `production` | App Store + Play Store bundle | Store | `https://app.bidstack.io` |

### Build commands

```bash
cd apps/mobile

# Simulator (iOS only)
eas build --profile development --platform ios

# TestFlight (preview)
eas build --profile preview --platform ios

# Both platforms, production
eas build --profile production --platform all
```

Builds run on EAS Build cloud infrastructure. Build time: ~10–15 minutes.

---

## 7. TestFlight Beta Distribution

1. Complete a `preview` or `production` build.
2. EAS will upload the `.ipa` to App Store Connect automatically (if `distribution: store`).
3. In App Store Connect → TestFlight → select the build.
4. Add internal testers (must be in your Apple Developer team) immediately.
5. For external testers (design partners), create an **External Testing Group**:
   - Add tester emails or generate a **public TestFlight link**.
   - External TestFlight requires beta review (~24–48h first time, usually faster on re-uploads).
6. Copy the invite URL into `apps/web/src/components/settings/MobileSection.tsx`:
   ```ts
   const TESTFLIGHT_URL = 'https://testflight.apple.com/join/YOUR_INVITE_CODE';
   ```

---

## 8. Google Play Internal Testing

1. Complete a `production` build (`--platform android`).
2. EAS will output a signed `.aab` file.
3. Submit via `eas submit --platform android` or manually upload in Play Console.
4. Play Console → Testing → Internal testing → Create release → upload `.aab`.
5. Add tester emails under "Testers".
6. Copy the internal testing link into `MobileSection.tsx`:
   ```ts
   const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=io.bidstack.crm';
   ```

---

## 9. EAS Submit (Automated Submission)

After configuring `eas.json` submit block with your Apple ID and App Store Connect App ID:

```bash
# iOS
eas submit --platform ios --profile production

# Android
eas submit --platform android --profile production
```

`eas.json` submit block (replace placeholders):
```json
"submit": {
  "production": {
    "ios": {
      "appleId": "your@email.com",
      "ascAppId": "1234567890",
      "appleTeamId": "XXXXXXXXXX"
    },
    "android": {
      "serviceAccountKeyPath": "./google-service-account.json",
      "track": "internal"
    }
  }
}
```

---

## 10. Over-the-Air Updates (EAS Update)

For JS-only changes (no native module changes), push updates without a full build:

```bash
eas update --branch production --message "Fix deal card rendering"
```

Users receive the update silently on next app launch (Expo Updates runtime).

---

## 11. Release Notes Template

Use this template when submitting updates to App Store / Play Store:

```
Version X.Y.Z — BidStack 360°

What's new:
• [Feature]: Brief description
• [Fix]: Brief description

Known issues:
• [Issue]: Status

Support: support@bidstack.io
```

---

## 12. Environment Variables

| Variable | Where set | Description |
|----------|-----------|-------------|
| `EXPO_PUBLIC_APP_URL` | EAS Build env / local `.env` | PWA URL the WebView loads |
| `EXPO_PUBLIC_SENTRY_DSN` | EAS Build env | Sentry DSN (wired in W7-5) |

Set secrets in EAS:
```bash
eas secret:create --scope project --name EXPO_PUBLIC_APP_URL --value https://app.bidstack.io
```

---

## 13. Sentry Integration (W7-5)

The notifications bridge has a Sentry stub. Wire it in W7-5:

```bash
cd apps/mobile
npx expo install @sentry/react-native
npx @sentry/wizard -i reactNative
```

Replace `// TODO(W7-5)` stubs in `src/bridge/notifications.ts` with real calls.

---

## Checklist

- [ ] Apple Developer Program enrolled + App ID created
- [ ] APNs .p8 key generated + uploaded to EAS
- [ ] Google Play Developer account + service account JSON
- [ ] Firebase project + google-services.json
- [ ] `eas init` run, `projectId` updated in `app.json`
- [ ] EAS managed credentials configured for iOS + Android
- [ ] `icon.png`, `adaptive-icon.png`, `splash.png` placed in `apps/mobile/assets/`
- [ ] `TESTFLIGHT_URL` + `PLAY_STORE_URL` updated in `MobileSection.tsx`
- [ ] `EXPO_PUBLIC_APP_URL` set as EAS secret
- [ ] `google-service-account.json` added to `.gitignore` ✓ (already included)
- [ ] First `preview` build triggered and TestFlight link shared with design partners
