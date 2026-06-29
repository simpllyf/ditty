/**
 * WAV encoding — turn rendered samples into a 16-bit PCM WAV. Pure (no Web Audio),
 * returns universal `Uint8Array` bytes (wrap in a Blob in the browser, or write to a
 * file in Node). Lives apart from the audio shell so `/core` stays pure.
 */

/**
 * Encode one or more channels of float samples (`[-1, 1]`) as a 16-bit PCM WAV.
 * Channels are interleaved; all must share a length (the first channel's wins).
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`encodeWav sampleRate must be a positive integer, got ${sampleRate}`);
  }
  if (channels.length === 0) {
    throw new RangeError("encodeWav requires at least one channel");
  }
  const numChannels = channels.length;
  const frames = channels[0]!.length;
  const blockAlign = numChannels * 2; // 16-bit samples
  const dataLength = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const dv = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  dv.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk length
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true); // byte rate
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  dv.setUint32(40, dataLength, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = channels[ch]![frame] ?? 0;
      const safe = Number.isNaN(sample) ? 0 : Math.max(-1, Math.min(1, sample));
      dv.setInt16(offset, Math.round(safe * 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}
