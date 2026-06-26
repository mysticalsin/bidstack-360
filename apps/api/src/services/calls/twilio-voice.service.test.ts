import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadTwilioRecording,
  validateTwilioVoiceSignature,
} from './twilio-voice.service.js';

/** Builds a Response whose body streams `chunkCount` chunks of `chunkBytes` each. */
function streamingResponse(
  chunkBytes: number,
  chunkCount: number,
  headers: Record<string, string> = {},
): Response {
  let emitted = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) {
        controller.close();
        return;
      }
      emitted += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
  });
  return new Response(body, { status: 200, headers });
}

describe('validateTwilioVoiceSignature', () => {
  it('accepts a valid SHA-1 signature', () => {
    const authToken = 'test-auth-token';
    const callbackUrl = 'https://example.com/webhook';
    const params = { CallSid: 'CA123', CallStatus: 'completed' };

    // Compute expected signature with SHA-1
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key as keyof typeof params], '');
    const message = callbackUrl + sortedParams;
    const expectedSignature = createHmac('sha1', authToken).update(message).digest('base64');

    process.env.TWILIO_AUTH_TOKEN = authToken;
    const result = validateTwilioVoiceSignature(expectedSignature, callbackUrl, params);
    expect(result).toBe(true);
  });

  it('rejects an invalid signature', () => {
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    const result = validateTwilioVoiceSignature(
      'invalid-signature',
      'https://example.com/webhook',
      { CallSid: 'CA123' },
    );
    expect(result).toBe(false);
  });

  it('returns false when TWILIO_AUTH_TOKEN is missing', () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const result = validateTwilioVoiceSignature(
      'some-signature',
      'https://example.com/webhook',
      {},
    );
    expect(result).toBe(false);
  });
});

describe('downloadTwilioRecording — size cap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });

  it('rejects up-front when Content-Length exceeds the cap (no body read)', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    const oversized = 60 * 1024 * 1024; // > 50 MB cap
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamingResponse(1024, 1, { 'content-length': String(oversized) }),
    );

    await expect(downloadTwilioRecording('https://api.twilio.com/rec')).rejects.toThrow(
      /too large/i,
    );
  });

  it('aborts mid-stream when bytes exceed the cap despite a missing/lying header', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    // 11 chunks × 5 MB = 55 MB > 50 MB cap, with NO content-length header.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamingResponse(5 * 1024 * 1024, 11),
    );

    await expect(downloadTwilioRecording('https://api.twilio.com/rec')).rejects.toThrow(
      /too large/i,
    );
  });

  it('returns the buffer for a recording within the cap', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamingResponse(1024, 4));

    const buf = await downloadTwilioRecording('https://api.twilio.com/rec');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(4 * 1024);
  });
});
