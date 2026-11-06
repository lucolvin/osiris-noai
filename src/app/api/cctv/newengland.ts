import { cachedSource } from '@/lib/sourceCache';
import { loadIbi511Cameras, type Ibi511Source } from './ibi511';

/**
 * OSIRIS — Maine, New Hampshire and Vermont CCTV Cameras (New England 511)
 * Source: https://newengland511.org — the same IBI 511 stack Florida and Georgia run
 * ~360 cameras across the three states — NO API KEY NEEDED.
 *
 * Stills only. One deployment serves all three DOTs and tags each row with its
 * state in the `source` column, which is what the caption falls back to: the
 * rows name neither a city nor a county.
 */
const NE511: Ibi511Source = {
  base: 'https://newengland511.org',
  idPrefix: 'ne511',
  source: 'New England 511',
  state: 'New England',
  stateByAgency: { Maine: 'Maine', NewHampshire: 'New Hampshire', Vermont: 'Vermont' },
  bounds: { minLat: 42.6, maxLat: 47.5, minLng: -73.5, maxLng: -66.9 },
};

export const fetchNewEnglandCameras = cachedSource('newengland', () => loadIbi511Cameras(NE511));
