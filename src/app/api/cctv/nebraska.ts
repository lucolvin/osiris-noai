import { cachedSource } from '@/lib/sourceCache';
import { loadCars511Cameras, type Cars511Source } from './cars511';

/**
 * OSIRIS — Nebraska CCTV Cameras (NDOT / 511.nebraska.gov)
 * Source: https://511.nebraska.gov/api/graphql — the CARS 511 platform Iowa runs on
 * ~340 cameras — NO API KEY NEEDED.
 *
 * Stills only: Omaha and Lincoln metro freeways, I-80 end to end, and the
 * rural highways out to the panhandle.
 */
const NDOT: Cars511Source = {
  base: 'https://511.nebraska.gov',
  idPrefix: 'ndot',
  source: 'Nebraska DOT',
  state: 'Nebraska',
  bounds: { minLat: 39.9, maxLat: 43.1, minLng: -104.1, maxLng: -95.3 },
};

export const fetchNebraskaCameras = cachedSource('nebraska', () => loadCars511Cameras(NDOT));
