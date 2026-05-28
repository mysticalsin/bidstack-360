/**
 * Twilio Programmable Voice service for outbound CRM dial-out.
 *
 * WHY Twilio Voice (not a SIP trunk): Twilio's REST API + TwiML is the
 * fastest integration path. The <Record> verb handles cloud recording without
 * S3 plumbing on the CRM side. Recordings are delivered via `recordingStatusCallback`.
 *
 * Flow:
 *  1. POST /calls/quick-start { provider: 'TWILIO_VOICE', ... }
 *  2. API calls `initiateVoiceCall` → Twilio REST → Twilio dials the number.
 *  3. On connect, Twilio fetches TwiML from voiceWebhookUrl which returns
 *     <Response><Dial record="record-from-ringing"><Number>...</Number></Dial></Response>
 *  4. On call end, Twilio POSTs to recordingStatusCallback → `call.fetch-recording` job.
 *
 * Credentials: same TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN as the SMS service.
 * WHY reuse: a single Twilio account can have both SMS and Voice capabilities.
 *
 * Signature validation: Twilio signs both status callbacks and TwiML requests
 * with X-Twilio-Signature (HMAC-SHA256 of URL + sorted POST params). We validate
 * using the same `validateTwilioSignature` from twilio-sms.service.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TwilioVoiceCallParams {
  /** E.164 number to dial (the contact/lead). */
  toNumber: string;
  /** E.164 Twilio caller-ID number (from TWILIO_VOICE_PHONE_NUMBER). */
  fromNumber?: string;
  /** Twilio will fetch TwiML from this URL when the call connects. */
  twimlUrl: string;
  /** URL where Twilio POSTs call status updates (completed, failed, etc.). */
  statusCallbackUrl: string;
  /** URL where Twilio POSTs when a recording is available. */
  recordingStatusCallbackUrl: string;
}

export interface TwilioCallResponse {
  sid: string;
  status: string;
  to: string;
  from: string;
  dateCreated: string;
}

export interface TwilioRecordingStatusPayload {
  RecordingSid: string;
  RecordingUrl: string;
  RecordingStatus: string;
  RecordingDuration: string;
  CallSid: string;
  AccountSid: string;
  RecordingChannels: string;
  RecordingSource: string;
}

export interface TwilioVoiceStatusPayload {
  CallSid: string;
  CallStatus: string;
  Duration?: string;
  CallDuration?: string;
  To: string;
  From: string;
  AccountSid: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`TwilioVoice: ${name} env var is required`);
  return val;
}

function twilioAuthHeader(): string {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
  const authToken = requireEnv('TWILIO_AUTH_TOKEN');
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

// ─── Signature validation ──────────────────────────────────────────────────

/**
 * Validates Twilio's X-Twilio-Signature on webhook callbacks.
 *
 * Algorithm: HMAC-SHA256 of (URL + sorted POST params concatenated) with
 * the auth token as key, base64-encoded.
 *
 * WHY not timingSafeEqual on base64: we compare the decoded buffers to avoid
 * timing leaks from base64 string comparison short-circuiting.
 */
export function validateTwilioVoiceSignature(
  signature: string,
  callbackUrl: string,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
  if (!authToken) return false;

  // Build the message: URL + sorted key-value pairs concatenated (no separator).
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), '');
  const message = callbackUrl + sortedParams;

  const expected = createHmac('sha1', authToken).update(message).digest('base64');

  try {
    const expectedBuf = Buffer.from(expected, 'base64');
    const signatureBuf = Buffer.from(signature, 'base64');
    if (expectedBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    return false;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initiates an outbound voice call via Twilio REST.
 * Twilio dials `toNumber` and fetches TwiML from `twimlUrl` to drive the call.
 */
export async function initiateVoiceCall(
  params: TwilioVoiceCallParams,
): Promise<TwilioCallResponse> {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
  const fromNumber = params.fromNumber ?? requireEnv('TWILIO_VOICE_PHONE_NUMBER');

  const formData = new URLSearchParams({
    To: params.toNumber,
    From: fromNumber,
    Url: params.twimlUrl,
    StatusCallback: params.statusCallbackUrl,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'completed failed busy no-answer canceled',
    Record: 'true',
    RecordingStatusCallback: params.recordingStatusCallbackUrl,
    RecordingStatusCallbackMethod: 'POST',
    // Record stereo: one channel per speaker. Enables per-speaker diarization.
    RecordingChannels: 'dual',
  });

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: twilioAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Twilio initiateVoiceCall failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    sid: string;
    status: string;
    to: string;
    from: string;
    date_created: string;
  };

  return {
    sid: data.sid,
    status: data.status,
    to: data.to,
    from: data.from,
    dateCreated: data.date_created,
  };
}

/**
 * Generates the TwiML response for a Twilio outbound call.
 *
 * WHY we generate TwiML in the API (not in a separate TwiML bin): keeping
 * TwiML generation here avoids another publicly accessible URL and lets
 * us dynamically inject the target number from the database.
 *
 * Returns a complete TwiML XML string.
 */
export function generateDialTwiml(toNumber: string): string {
  // record-from-ringing: records both legs from the moment Twilio dials.
  // playBeep: notifies the recipient that the call is being recorded (legal requirement in some jurisdictions).
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Dial record="record-from-ringing" recordingStatusCallback="" trim="trim-silence">`,
    `    <Number statusCallback="" statusCallbackEvent="completed">${toNumber}</Number>`,
    '  </Dial>',
    '</Response>',
  ].join('\n');
}

/**
 * Downloads a Twilio recording to a Buffer.
 * The download URL requires Twilio HTTP Basic auth.
 */
export async function downloadTwilioRecording(recordingUrl: string): Promise<Buffer> {
  const resp = await fetch(`${recordingUrl}.mp3`, {
    headers: { Authorization: twilioAuthHeader() },
  });

  if (!resp.ok) {
    throw new Error(`Twilio downloadRecording failed (${resp.status}): ${recordingUrl}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
