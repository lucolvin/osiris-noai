import { cachedSource } from '@/lib/sourceCache';
import { loadCars511Cameras, type Cars511Source } from './cars511';

/**
 * OSIRIS — Kansas CCTV Cameras (KDOT / kandrive.gov)
 * Source: https://www.kandrive.gov/api/graphql — the CARS 511 platform Iowa runs on
 * ~580 cameras — NO API KEY NEEDED.
 *
 * About 200 are live video from KDOT's own SkyVDN servers, which answer
 * Access-Control-Allow-Origin: *, so they play straight from the source. The
 * rest are stills, including KC Scout's Kansas City metro network on both
 * sides of the state line.
 */
const KDOT: Cars511Source = {
  base: 'https://www.kandrive.gov',
  idPrefix: 'kdot',
  source: 'KDOT',
  state: 'Kansas',
  captionFor: kcScoutCaption,
  bounds: { minLat: 36.9, maxLat: 40.1, minLng: -102.1, maxLng: -94.1 },
};

/**
 * KC Scout names each snapshot by state: `K035SBC-07` is Kansas, `M029NBC-01`
 * Missouri and `P…` Platte County, Missouri. A longitude cut at State Line
 * Road would not do: north of the river, Missouri reaches well west of it.
 */
export function kcScoutCaption(still: string | undefined): string | undefined {
  const code = still?.match(/kcscout\.net\/.*\/([KMP])\d/i)?.[1]?.toUpperCase();
  if (code === 'K') return 'Kansas City, KS';
  if (code === 'M' || code === 'P') return 'Kansas City, MO';
  return undefined;
}

export const fetchKansasCameras = cachedSource('kansas', () => loadCars511Cameras(KDOT));
