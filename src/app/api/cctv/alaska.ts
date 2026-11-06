import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Alaska CCTV Cameras (Alaska DOT&PF / 511.alaska.gov)
 * Source: https://511.alaska.gov — the same IBI 511 stack Florida and Georgia run
 * ~130 camera sites — NO API KEY NEEDED.
 *
 * Stills only: the Seward, Glenn, Parks and Richardson highways and the
 * Anchorage and Fairbanks areas. Most sites carry several views; the map shows
 * the first one.
 */
const AKDOT: Ibi511Source = {
  base: 'https://511.alaska.gov',
  idPrefix: 'akdot',
  source: 'Alaska DOT&PF',
  state: 'Alaska',
  bounds: { minLat: 51.0, maxLat: 71.5, minLng: -180.0, maxLng: -129.9 },
};

export const fetchAlaskaCameras = cachedSource('alaska', () => loadIbi511Cameras(AKDOT));
