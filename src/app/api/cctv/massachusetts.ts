import { cachedSource } from '@/lib/sourceCache';
import { loadCars511Cameras, type Cars511Source } from './cars511';

/**
 * OSIRIS — Massachusetts CCTV Cameras (MassDOT / mass511.com)
 * Source: https://mass511.com/api/graphql — the CARS 511 platform Iowa runs on
 * ~310 cameras — NO API KEY NEEDED.
 *
 * The API lists a live stream for nearly every camera, but it is a TrafficLand
 * restream with a token that expires a few minutes after the API call, so the
 * cameras come up as stills (public JPEGs on carsprogram.org) instead.
 */
const MASSDOT: Cars511Source = {
  base: 'https://mass511.com',
  idPrefix: 'massdot',
  source: 'MassDOT',
  state: 'Massachusetts',
  snapshotOnly: true,
  bounds: { minLat: 41.2, maxLat: 42.9, minLng: -73.6, maxLng: -69.8 },
};

export const fetchMassachusettsCameras = cachedSource('massachusetts', () => loadCars511Cameras(MASSDOT));
