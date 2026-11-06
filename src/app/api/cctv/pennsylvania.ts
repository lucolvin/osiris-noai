import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Pennsylvania CCTV Cameras (PennDOT / 511pa.com)
 * Source: https://www.511pa.com — the same IBI 511 stack Florida and Georgia run
 * ~1,560 cameras statewide — NO API KEY NEEDED.
 *
 * Philadelphia and Pittsburgh metro freeways, the Turnpike, I-80, I-81 and the
 * rest of the interstates. Every row flags its video as needing authorization,
 * so these come up as public snapshot cameras; ./ibi511 drops the gated
 * playlists on its own.
 */
const PENNDOT: Ibi511Source = {
  base: 'https://www.511pa.com',
  idPrefix: 'penndot',
  source: 'PennDOT',
  state: 'Pennsylvania',
  bounds: { minLat: 39.6, maxLat: 42.4, minLng: -80.6, maxLng: -74.6 },
};

export const fetchPennsylvaniaCameras = cachedSource('pennsylvania', () => loadIbi511Cameras(PENNDOT));
