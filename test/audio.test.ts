import { describe, expect, it } from "vitest";
import { TurnTimeline, rmsLevel } from "../src/audio/timeline";
import { concatPcmToWav, extractPcm, parseAudioMime, pcmToWav, silentWav, toWavBytes } from "../src/audio/wav";

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

describe("parseAudioMime", () => {
  it("reads rate and channels from L16 / pcm mime types", () => {
    expect(parseAudioMime("audio/L16;codec=pcm;rate=24000")).toEqual({ kind: "pcm", sampleRate: 24000, channels: 1 });
    expect(parseAudioMime("audio/pcm; rate=16000; channels=2")).toEqual({ kind: "pcm", sampleRate: 16000, channels: 2 });
  });
  it("recognises wav and defaults to 24 kHz mono", () => {
    expect(parseAudioMime("audio/wav").kind).toBe("wav");
    expect(parseAudioMime(undefined)).toEqual({ kind: "pcm", sampleRate: 24000, channels: 1 });
  });
});

describe("pcmToWav", () => {
  it("writes a valid 44-byte RIFF/WAVE header", () => {
    const wav = pcmToWav(new Uint8Array(480), 24000);
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + 480);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 480);
    expect(ascii(wav, 8, 8)).toBe("WAVEfmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(48000); // byte rate
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(480);
  });
});

describe("toWavBytes", () => {
  it("passes WAV through and wraps PCM", () => {
    const wav = pcmToWav(new Uint8Array(4), 24000);
    expect(toWavBytes(wav, "audio/wav")).toBe(wav);
    expect(toWavBytes(wav, "audio/L16;rate=24000")).toBe(wav); // RIFF magic wins over a loose mime type
    expect(toWavBytes(new Uint8Array(4), "audio/L16;rate=24000").length).toBe(48);
  });
  it("makes a short silent clip", () => {
    expect(ascii(silentWav(), 0, 4)).toBe("RIFF");
  });
});

describe("extractPcm", () => {
  it("returns raw PCM with the mime type's format", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    expect(extractPcm(pcm, "audio/L16;rate=16000")).toEqual({ pcm, sampleRate: 16000, channels: 1 });
  });
  it("reads the data chunk and format out of a WAV", () => {
    const clip = extractPcm(pcmToWav(new Uint8Array([5, 6, 7, 8]), 22050, 2), "audio/wav");
    expect(Array.from(clip.pcm)).toEqual([5, 6, 7, 8]);
    expect(clip.sampleRate).toBe(22050);
    expect(clip.channels).toBe(2);
  });
});

describe("concatPcmToWav", () => {
  it("joins clips with silence in between", () => {
    const a = { pcm: new Uint8Array([1, 1]), sampleRate: 1000, channels: 1 };
    const b = { pcm: new Uint8Array([2, 2]), sampleRate: 1000, channels: 1 };
    const wav = concatPcmToWav([a, b], 2); // 2 ms at 1 kHz = 2 samples = 4 bytes
    expect(Array.from(wav.slice(44))).toEqual([1, 1, 0, 0, 0, 0, 2, 2]);
  });
  it("drops a dangling odd byte so samples stay aligned", () => {
    const a = { pcm: new Uint8Array([1, 1, 9]), sampleRate: 1000, channels: 1 };
    const b = { pcm: new Uint8Array([2, 2]), sampleRate: 1000, channels: 1 };
    expect(Array.from(concatPcmToWav([a, b]).slice(44))).toEqual([1, 1, 2, 2]);
  });
});

describe("TurnTimeline", () => {
  const turns = [
    { speaker: "angel" as const, text: "a".repeat(10) },
    { speaker: "devil" as const, text: "d".repeat(30) },
    { speaker: "angel" as const, text: "a".repeat(10) },
  ];
  it("splits the clip by character share", () => {
    const tl = new TurnTimeline(turns);
    expect(tl.indexAt(0, 10)).toBe(0);
    expect(tl.indexAt(1.9, 10)).toBe(0);
    expect(tl.indexAt(2.1, 10)).toBe(1);
    expect(tl.indexAt(7.9, 10)).toBe(1);
    expect(tl.indexAt(8.1, 10)).toBe(2);
    expect(tl.indexAt(10, 10)).toBe(2);
  });
  it("is safe before the duration is known", () => {
    expect(new TurnTimeline(turns).indexAt(3, Number.NaN)).toBe(0);
  });
});

describe("rmsLevel", () => {
  it("is 0 for silence and capped at 1", () => {
    expect(rmsLevel(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsLevel(new Uint8Array(64).fill(255))).toBe(1);
  });
});
