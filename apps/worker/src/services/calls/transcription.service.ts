/**
 * Audio transcription service — Deepgram Nova-3 with speaker diarization.
 *
 * WHY Deepgram over OpenAI Whisper:
 *  1. Native speaker diarization at word level — no post-processing needed.
 *  2. Streaming API for live call transcription (future: real-time captions).
 *  3. Better accuracy on non-native English and French (Mantu global teams).
 *  4. Async file transcription returns structured JSON (not just text).
 *  5. Price competitive at scale (per-minute billing vs per-request).
 *
 * This service handles batch (post-call) transcription. Transcribed output is
 * stored as both flat text (transcriptText) and structured speaker segments
 * (transcriptStructured) in CallSession.
 *
 * PII note: Deepgram processes audio data. The `redact` and `pii` Deepgram
 * options are enabled by default to reduce PII in the returned transcript.
 * If PII_FIELD_ENCRYPTION=true, the transcriptText field is additionally
 * encrypted client-side before storage.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TranscriptWord {
  word: string;
  start: number; // seconds from call start
  end: number;
  confidence: number;
  speaker?: number; // Deepgram speaker index (0, 1, 2, ...)
  punctuated_word?: string;
}

export interface TranscriptSegment {
  /** Speaker display label (e.g. "Speaker 0", "Speaker 1"). */
  speaker: string;
  /** Start of segment in milliseconds. */
  startMs: number;
  /** End of segment in milliseconds. */
  endMs: number;
  /** Full text of this segment. */
  text: string;
}

export interface TranscriptionResult {
  /** Concatenated full transcript text. */
  text: string;
  /** Speaker-tagged segments with millisecond timestamps. */
  segments: TranscriptSegment[];
  /** Raw Deepgram word-level output (for seek-to-timestamp in the UI). */
  words: TranscriptWord[];
  /** Confidence score 0.0–1.0 averaged across all words. */
  confidence: number;
}

// ─── Deepgram response types ───────────────────────────────────────────────

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  punctuated_word?: string;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

interface DeepgramUtterance {
  start: number;
  end: number;
  confidence: number;
  channel: number;
  transcript: string;
  words: DeepgramWord[];
  speaker: number;
  id: string;
}

interface DeepgramResponse {
  results: {
    channels: Array<{
      alternatives: DeepgramAlternative[];
    }>;
    utterances?: DeepgramUtterance[];
  };
  metadata: {
    duration: number;
    channels: number;
    models: string[];
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireDeepgramKey(): string {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('Transcription: DEEPGRAM_API_KEY env var is required');
  return key;
}

/**
 * Collapses Deepgram utterances into transcript segments.
 * Groups consecutive words by speaker into readable chunks.
 */
function utterancesToSegments(utterances: DeepgramUtterance[]): TranscriptSegment[] {
  return utterances.map((u) => ({
    speaker: `Speaker ${u.speaker}`,
    startMs: Math.round(u.start * 1_000),
    endMs: Math.round(u.end * 1_000),
    text: u.transcript,
  }));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Transcribes an audio file from a URL using Deepgram Nova-3.
 *
 * The URL must be publicly accessible (e.g. a short-lived signed S3 URL)
 * OR an authenticated Twilio recording URL.
 *
 * @param audioUrl - Publicly accessible URL to the audio file (MP3/MP4/WebM/Opus).
 * @param dualChannel - Whether the recording has separate channels per speaker.
 *   True for Twilio dual-channel recordings; false for Zoom/Teams (mono).
 */
export async function transcribeAudioUrl(
  audioUrl: string,
  dualChannel = false,
): Promise<TranscriptionResult> {
  const apiKey = requireDeepgramKey();

  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
    smart_format: 'true',
    punctuate: 'true',
    diarize: dualChannel ? 'false' : 'true', // use diarize for mono; multichannel for dual
    utterances: 'true',
    // PII redaction — masks PII in the transcript before returning
    redact: 'pci,numbers',
    ...(dualChannel ? { multichannel: 'true' } : {}),
  });

  const resp = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Deepgram transcription failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as DeepgramResponse;

  const primary = data.results.channels[0]?.alternatives[0];
  if (!primary) throw new Error('Deepgram returned no transcription alternatives');

  const text = primary.transcript;
  const confidence =
    primary.words.length > 0
      ? primary.words.reduce((sum, w) => sum + w.confidence, 0) / primary.words.length
      : primary.confidence;

  const words: TranscriptWord[] = primary.words.map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
    speaker: w.speaker,
    punctuated_word: w.punctuated_word,
  }));

  const segments =
    data.results.utterances && data.results.utterances.length > 0
      ? utterancesToSegments(data.results.utterances)
      : [];

  return { text, segments, words, confidence };
}

/**
 * Transcribes audio from a raw Buffer (e.g. a downloaded Twilio MP3).
 * Uploads the buffer directly to Deepgram rather than via a URL.
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType: 'audio/mp3' | 'audio/mpeg' | 'audio/webm' | 'audio/mp4' = 'audio/mp3',
  dualChannel = false,
): Promise<TranscriptionResult> {
  const apiKey = requireDeepgramKey();

  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
    smart_format: 'true',
    punctuate: 'true',
    diarize: dualChannel ? 'false' : 'true',
    utterances: 'true',
    redact: 'pci,numbers',
    ...(dualChannel ? { multichannel: 'true' } : {}),
  });

  const resp = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': mimeType,
    },
    body: audioBuffer,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Deepgram buffer transcription failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as DeepgramResponse;

  const primary = data.results.channels[0]?.alternatives[0];
  if (!primary) throw new Error('Deepgram returned no transcription alternatives');

  const words: TranscriptWord[] = primary.words.map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
    speaker: w.speaker,
    punctuated_word: w.punctuated_word,
  }));

  const segments =
    data.results.utterances && data.results.utterances.length > 0
      ? utterancesToSegments(data.results.utterances)
      : [];

  return {
    text: primary.transcript,
    segments,
    words,
    confidence:
      primary.words.length > 0
        ? primary.words.reduce((sum, w) => sum + w.confidence, 0) / primary.words.length
        : primary.confidence,
  };
}
