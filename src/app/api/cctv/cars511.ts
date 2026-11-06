import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';

/**
 * OSIRIS — helpers for the CARS 511 traveler-information platform.
 *
 * CARS (Castle Rock's 511 stack) runs Iowa, Indiana, Kansas, Massachusetts and
 * Nebraska, among others, and every deployment answers the same GraphQL map
 * query at `/api/graphql` with no key. Iowa and Indiana have their own modules
 * (./iowa, ./indiana); the states added after them share this loader, since
 * all that differs between them is the domain, the bounding box and whether
 * their streams can be played from here.
 */

export interface Cars511Source {
  /** Origin, e.g. `https://www.kandrive.gov`. */
  base: string;
  /** Prefix for camera ids, so they stay unique across sources. */
  idPrefix: string;
  /** The agency shown on the camera card. */
  source: string;
  /** Caption under the camera name. */
  state: string;
  /**
   * A caption for cameras that fall outside the state proper, given the
   * camera's still. Kansas's feed carries KC Scout's whole metro network,
   * Missouri side included.
   */
  captionFor?: (still: string | undefined) => string | undefined;
  /**
   * Ignore the HLS playlists the API hands out. Massachusetts' come from a
   * TrafficLand restream whose token is only good for a few minutes, far
   * shorter than the camera index is cached, so they would all be dead by the
   * time anyone clicked one. The stills are public and stay fresh.
   */
  snapshotOnly?: boolean;
  /** Drops mis-geocoded rows, and is the area the map query asks for. */
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

/**
 * `url` and `sources` live on CameraView, not on the interface `views`
 * returns, so they come through an inline fragment.
 */
const QUERY = `query MapFeatures($input: MapFeaturesArgs!) {
  mapFeaturesQuery(input: $input) {
    mapFeatures {
      title
      uri
      features { geometry }
      __typename
      ... on Camera { active views(limit: 1) { category ... on CameraView { url sources { type src } } } }
    }
    error { message }
  }
}`;

export interface Cars511Feature {
  title?: string | null;
  uri?: string | null;
  features?: Array<{ geometry?: { coordinates?: [number, number] } | null }> | null;
  __typename?: string | null;
  active?: boolean | null;
  views?: Array<{
    category?: string | null;
    url?: string | null;
    sources?: Array<{ type?: string | null; src?: string | null }> | null;
  }> | null;
}

/**
 * Titles often lead with the route and repeat it (`I-90: I-90-WB-MM79.4-…`,
 * `US 77: S of Cortland`). The route prefix is dropped when the rest already
 * names the road; otherwise the title is kept whole.
 */
export function cleanCarsTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  const m = /^([^:]{1,20}):\s*(.+)$/.exec(t);
  if (!m) return t;
  const route = m[1].trim();
  const rest = m[2].trim();
  const squash = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
  return squash(rest).startsWith(squash(route)) ? rest : t;
}

/** A still, when the view has a real one rather than the "camera closed" icon. */
function stillUrl(url?: string | null): string | undefined {
  const trimmed = url?.trim();
  // The query is a cache-buster frozen at the time of the API call.
  return trimmed && /^https:\/\//i.test(trimmed) ? trimmed.split('?')[0] : undefined;
}

/** The HLS playlist, when the view publishes one over https. */
function hlsUrl(sources: NonNullable<Cars511Feature['views']>[number]['sources']): string | undefined {
  for (const s of sources ?? []) {
    const src = s?.src?.trim();
    if (src && /^https:\/\//i.test(src) && /\.m3u8(\?|$)/i.test(src)) return src;
  }
  return undefined;
}

/** Map one map feature to a camera, or null if unusable. Exported for tests. */
export function mapCars511Feature(f: Cars511Feature, cfg: Cars511Source): CctvCamera | null {
  if (f?.__typename !== 'Camera' || f.active === false) return null;

  const view = f.views?.[0];
  const still = stillUrl(view?.url);
  const video = cfg.snapshotOnly ? undefined : hlsUrl(view?.sources);
  if (!still && !video) return null;

  const coords = f.features?.[0]?.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const b = cfg.bounds;
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return null;

  const id = f.uri?.match(/camera\/(\d+)/)?.[1];
  if (!id) return null;

  return {
    id: `${cfg.idPrefix}-${id}`,
    lat,
    lng,
    name: cleanCarsTitle(f.title || '') || `${cfg.source} Camera ${id}`,
    city: cfg.captionFor?.(still) ?? cfg.state,
    country: 'US',
    ...(still ? { feed_url: still } : {}),
    ...(video ? { stream_url: video, stream_type: 'hls' as const } : {}),
    external_url: `${cfg.base}/@${lat},${lng},14?show=${encodeURIComponent(f.uri || '')}`,
    source: cfg.source,
  };
}

/** Every camera one CARS deployment publishes inside its bounding box. */
export async function loadCars511Cameras(cfg: Cars511Source): Promise<CctvCamera[]> {
  const res = await stealthFetch(`${cfg.base}/api/graphql`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: `${cfg.base}/` },
    body: JSON.stringify({
      query: QUERY,
      /* One query for the whole state; `zoom` 16 makes the server return
         cameras rather than clusters. */
      variables: {
        input: {
          north: cfg.bounds.maxLat,
          south: cfg.bounds.minLat,
          east: cfg.bounds.maxLng,
          west: cfg.bounds.minLng,
          zoom: 16,
          layerSlugs: ['normalCameras'],
          nonClusterableUris: null,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`${cfg.source} HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(feats)) throw new Error(`${cfg.source} returned no mapFeatures`);

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const cam = mapCars511Feature(f, cfg);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] ${cfg.source} cameras: ${cams.length} (${cams.filter(c => c.stream_url).length} live)`);
  return cams;
}
