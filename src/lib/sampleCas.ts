// src/lib/sampleCas.ts
// Loads the bundled synthetic sample statement (US-11). This is the app's one same-origin static asset request after
// the page load: `public/sample-cas.pdf`, listed by the spec (US-20) among the permitted static loads. Nothing is sent;
// the bytes then take the identical path as a dropped file (source: 'sample').

export const SAMPLE_FILE_NAME = 'sample-cas.pdf';

export async function loadSampleCas(): Promise<ArrayBuffer> {
  const url = `${import.meta.env.BASE_URL}${SAMPLE_FILE_NAME}`;
  const response = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error('sample unavailable');
  return response.arrayBuffer();
}
