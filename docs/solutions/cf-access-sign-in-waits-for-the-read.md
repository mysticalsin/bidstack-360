# Access sign-in waits for the read

## Problem

The Cloudflare Access sign-in card used the startup failure whenever `failure` was null. A first paint and an in-flight `/me` read have no session yet, so the card said the box could not be reached and offered Try again. A signed-in session and a settled sign-out hit the same branch.

## Correction

`cfAccessSignInPhase` reports unread, failed, signed-in, or signed-out. Unread says the session has not arrived. It does not say the box could not be reached, and it does not say the visitor is signed out. A failed read stays on 403, 401, or the startup failure, with Try again. A loaded session with no failure says signed in. A settled sign-out says signed out.

## Verification

`CfAccessSignIn.read.test.tsx`. The unread, in-flight, signed-in, and sign-out cases failed before the phase check.
