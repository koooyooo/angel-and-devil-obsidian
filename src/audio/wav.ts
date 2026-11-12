/**
 * Audio payload handling (design doc §5.10). Gemini TTS returns base64 audio with a mimeType;
 * WAV is used as-is, raw PCM (audio/L16, audio/pcm) gets a 44-byte RIFF header.
 */

export const DEFAULT_SAMPLE_RATE = 24_000;

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface AudioFormat {
  kind: "wav" | "pcm";
  sampleRate: number;
  channels: number;
}

export function parseAudioMime(mimeType: string | undefined): AudioFormat {
  const mime = (mimeType ?? "").toLowerCase();
  const param = (name: string): number | undefined => {
    const m = mime.match(new RegExp(`(?:^|;)\\s*${name}=(\\d+)`));
    return m ? Number(m[1]) : undefined;
  };
  const isWav = /audio\/(?:wav|x-wav|wave|vnd\.wave)/.test(mime);
  return {
    kind: isWav ? "wav" : "pcm",
    sampleRate: param("rate") ?? DEFAULT_SAMPLE_RATE,
    channels: param("channels") ?? 1,
  };
}

/** Wraps 16-bit little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Returns WAV bytes for whatever Gemini sent. */
export function toWavBytes(data: Uint8Array, mimeType: string | undefined): Uint8Array {
  const format = parseAudioMime(mimeType);
  // Some responses label WAV loosely; trust the RIFF magic over the mime type.
  const hasRiff = data.length >= 4 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46;
  if (format.kind === "wav" || hasRiff) return data;
  return pcmToWav(data, format.sampleRate, format.channels);
}

export interface PcmClip {
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
}

/**
 * Extracts raw 16-bit PCM bytes and format metadata from a Gemini audio payload (WAV or raw PCM).
 */
export function extractPcm(data: Uint8Array, mimeType: string | undefined): PcmClip {
  const format = parseAudioMime(mimeType);
  const hasRiff =
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x41 &&
    data[10] === 0x56 &&
    data[11] === 0x45;
  if (hasRiff) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let sampleRate = format.sampleRate;
    let channels = format.channels;
    let offset = 12;
    while (offset + 8 <= data.length) {
      const id = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      const size = view.getUint32(offset + 4, true);
      const bodyStart = offset + 8;
      if (id === "fmt " && bodyStart + 8 <= data.length) {
        channels = view.getUint16(bodyStart + 2, true) || channels;
        sampleRate = view.getUint32(bodyStart + 4, true) || sampleRate;
      } else if (id === "data") {
        const end = Math.min(data.length, bodyStart + size);
        return { pcm: data.subarray(bodyStart, end), sampleRate, channels };
      }
      offset = bodyStart + size + (size & 1);
    }
    return { pcm: data.subarray(Math.min(44, data.length)), sampleRate, channels };
  }
  return { pcm: data, sampleRate: format.sampleRate, channels: format.channels };
}

/**
 * Concatenates multiple PCM clips into a single WAV container, inserting `gapMs` of silence between clips.
 */
export function concatPcmToWav(clips: PcmClip[], gapMs = 0): Uint8Array {
  if (clips.length === 0) return pcmToWav(new Uint8Array(0), DEFAULT_SAMPLE_RATE);
  const sampleRate = clips[0].sampleRate || DEFAULT_SAMPLE_RATE;
  const channels = clips[0].channels || 1;
  const bytesPerSample = 2 * channels;
  const gapBytes = gapMs > 0 ? Math.round((sampleRate * gapMs) / 1000) * bytesPerSample : 0;
  // Align each clip to a sample frame boundary so 16-bit little-endian samples never shift phase.
  const alignedLengths = clips.map((c) => c.pcm.length - (c.pcm.length % bytesPerSample));
  const totalPcmBytes =
    alignedLengths.reduce((sum, len) => sum + len, 0) + Math.max(0, clips.length - 1) * gapBytes;
  const merged = new Uint8Array(totalPcmBytes);
  let pos = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = alignedLengths[i];
    merged.set(clips[i].pcm.subarray(0, len), pos);
    pos += len + gapBytes; // gap region is already zero-filled (silence)
  }
  return pcmToWav(merged, sampleRate, channels);
}

/** A short silent clip, played inside a user gesture to unlock audio on iOS. */
export function silentWav(ms = 50, sampleRate = 8_000): Uint8Array {
  return pcmToWav(new Uint8Array(Math.round((sampleRate * ms) / 1000) * 2), sampleRate);
}
