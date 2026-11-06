import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Connecticut CCTV Cameras (CTDOT / ctroads.org)
 * Source: https://ctroads.org — the same IBI 511 stack Florida and Georgia run
 * ~350 cameras statewide — NO API KEY NEEDED.
 *
 * The I-95, I-91, I-84 and Merritt Parkway corridors. The cameras are
 * TrafficLand's, whose video needs a session, so they come up as public
 * snapshots served through ctroads.org.
 */
const CTDOT: Ibi511Source = {
  base: 'https://ctroads.org',
  idPrefix: 'ctdot',
  source: 'CTDOT',
  snapshotOnly: true,
  state: 'Connecticut',
  bounds: { minLat: 40.9, maxLat: 42.1, minLng: -73.8, maxLng: -71.7 },
};

export const fetchConnecticutCameras = cachedSource('connecticut', () => loadIbi511Cameras(CTDOT));
