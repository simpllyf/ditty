/**
 * WAV encoding — turn rendered samples into a mono 16-bit PCM WAV. Pure (no Web
 * Audio), returns universal `Uint8Array` bytes (wrap in a Blob in the browser, or
 * write to a file in Node). Lives apart from the audio shell so `/core` stays pure.
 */

/** Encode mono float samples (`[-1, 1]`) as a 16-bit PCM WAV. */
export function encodeWav(channelData: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`encodeWav sampleRate must be a positive integer, got ${sampleRate}`);
  }
  const n = channelData.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk length
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * blockAlign)
  dv.setUint16(32, 2, true); // block align (channels * bytesPerSample)
  dv.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  dv.setUint32(40, n * 2, true);

  for (let i = 0; i < n; i++) {
    const sample = channelData[i] as number;
    const safe = Number.isNaN(sample) ? 0 : Math.max(-1, Math.min(1, sample));
    dv.setInt16(44 + i * 2, Math.round(safe * 32767), true);
  }
  return new Uint8Array(buffer);
}
