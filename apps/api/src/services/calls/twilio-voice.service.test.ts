import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTwilioVoiceSignature } from './twilio-voice.service.js';

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
