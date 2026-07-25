let sequenceCounter = 0;

/**
 * Generates a collision-resistant, privacy-safe job session ID.
 * Does not include customer private data (phone, name, email).
 * Uses crypto.randomUUID() when available, or a high-resolution deterministic entropy fallback.
 * Strictly avoids Math.random() per architecture directives.
 */
export function createJobSessionId(): string {
  const timestamp = Date.now();

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    return `session_${timestamp}_${uuid}`;
  }

  // Fallback without Math.random()
  sequenceCounter = (sequenceCounter + 1) % 1000000;
  const highResTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? Math.floor(performance.now() * 1000)
    : 0;

  const entropy = ((timestamp ^ highResTime ^ sequenceCounter) >>> 0).toString(36);
  const padSeq = sequenceCounter.toString(36).padStart(4, '0');

  return `session_${timestamp}_${entropy}${padSeq}`;
}
