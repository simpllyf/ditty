/**
 * Voice & drum names — the foundational vocabulary shared by the composition
 * layer and the audio shell. Kept here (not in `compose/arranger`) so lower-level
 * modules (instruments, styles, synth) reference it without importing upward from
 * the top of the compose layer. Pure types, no runtime code.
 */

/** A pitched arrangement part. */
export type ScoreVoice = "lead" | "bass" | "pad" | "arp";

/** A drum-kit piece. */
export type DrumName = "kick" | "snare" | "hat";
