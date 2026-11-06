import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Wisconsin CCTV Cameras (WisDOT / 511wi.gov)
 * Source: https://511wi.gov — the same IBI 511 stack Florida and Georgia run
 * ~500 cameras statewide — NO API KEY NEEDED.
 *
 * Live video: WisDOT serves an open HLS playlist for its cameras from
 * cctv*.dot.wi.gov, which answers Access-Control-Allow-Origin: *, so the
 * streams play straight from the source. Milwaukee and Madison freeways plus
 * the I-94, I-90, I-41 and I-39 corridors.
 */
const WISDOT: Ibi511Source = {
  base: 'https://511wi.gov',
  idPrefix: 'wisdot',
  source: 'WisDOT',
  state: 'Wisconsin',
  bounds: { minLat: 42.4, maxLat: 47.4, minLng: -93.0, maxLng: -86.2 },
};

export const fetchWisconsinCameras = cachedSource('wisconsin', () => loadIbi511Cameras(WISDOT));
