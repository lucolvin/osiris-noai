import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Illinois CCTV Cameras (IDOT / Illinois Gateway)
 * Source: IDOT's public ArcGIS layer `TrafficCamerasTM_Public`, the one behind
 * gettingaroundillinois.com — ~3,800 camera views statewide — NO API KEY NEEDED.
 *
 * Chicagoland dominates: IDOT District 1, the Tollway, Chicago, and the DuPage,
 * Lake and Will county systems, plus IDOT's downstate districts. Every row is
 * one view of a camera (a pole with four directions is four rows), each with
 * its own refreshing JPEG on cctv.travelmidwest.com. No video.
 *
 * This replaces travelmidwest.com's `cameraReport.json`, which now answers
 * every anonymous request with an empty "no locations selected" report.
 */

const LAYER = 'https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query';
const FIELDS = 'OBJECTID,ImgPath,CameraLocation,CameraDirection,SnapShot,TooOld,x,y';
const PAGE_SIZE = 1000; // the layer's maxRecordCount
const MAX_PAGES = 10;

/** Illinois bounding box — drops any stray or placeholder coordinates. */
const IL_BOUNDS = { minLat: 36.9, maxLat: 42.6, minLng: -91.6, maxLng: -87.0 };

export interface IllinoisAttributes {
  OBJECTID?: number | null;
  ImgPath?: string | null;
  CameraLocation?: string | null;
  CameraDirection?: string | null;
  SnapShot?: string | null;
  TooOld?: string | null;
  x?: number | null;
  y?: number | null;
}

const DIRECTIONS: Record<string, string> = {
  N: 'North', S: 'South', E: 'East', W: 'West',
  NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest',
};

/** Illinois' 102 counties, as travelmidwest spells them in snapshot names. */
const IL_COUNTIES = new Set([
  'Adams', 'Alexander', 'Bond', 'Boone', 'Brown', 'Bureau', 'Calhoun', 'Carroll', 'Cass', 'Champaign',
  'Christian', 'Clark', 'Clay', 'Clinton', 'Coles', 'Cook', 'Crawford', 'Cumberland', 'DeKalb', 'DeWitt',
  'Douglas', 'DuPage', 'Edgar', 'Edwards', 'Effingham', 'Fayette', 'Ford', 'Franklin', 'Fulton', 'Gallatin',
  'Greene', 'Grundy', 'Hamilton', 'Hancock', 'Hardin', 'Henderson', 'Henry', 'Iroquois', 'Jackson', 'Jasper',
  'Jefferson', 'Jersey', 'JoDaviess', 'Johnson', 'Kane', 'Kankakee', 'Kendall', 'Knox', 'Lake', 'LaSalle',
  'Lawrence', 'Lee', 'Livingston', 'Logan', 'McDonough', 'McHenry', 'McLean', 'Macon', 'Macoupin', 'Madison',
  'Marion', 'Marshall', 'Mason', 'Massac', 'Menard', 'Mercer', 'Monroe', 'Montgomery', 'Morgan', 'Moultrie',
  'Ogle', 'Peoria', 'Perry', 'Piatt', 'Pike', 'Pope', 'Pulaski', 'Putnam', 'Randolph', 'Richland',
  'Rock-Island', 'St-Clair', 'Saline', 'Sangamon', 'Schuyler', 'Scott', 'Shelby', 'Stark', 'Stephenson', 'Tazewell',
  'Union', 'Vermilion', 'Wabash', 'Warren', 'Washington', 'Wayne', 'White', 'Whiteside', 'Will', 'Williamson',
  'Winnebago', 'Woodford',
]);

/**
 * The county, from the snapshot's file name. IDOT's districts and DuPage
 * name them `<agency>_<n>_<County>_<…>.jpg` (`IL-IDOTD1_1_Cook_WB_Albin_…`);
 * other agencies put a street in that slot, so only a real county counts.
 */
export function countyFromSnapshot(url: string): string | undefined {
  const token = (url.split('/').pop() ?? '').split('_')[2];
  if (!token || !IL_COUNTIES.has(token)) return undefined;
  return token.replace('St-', 'St. ').replace('-', ' ').replace('JoDaviess', 'Jo Daviess');
}

/** Map one layer row to a camera, or null if unusable. Exported for tests. */
export function mapIllinoisRow(a: IllinoisAttributes): CctvCamera | null {
  if (!a || a.TooOld === 'true') return null;

  const still = a.SnapShot?.trim();
  if (!still || !/^https:\/\//i.test(still)) return null;

  const lat = Number(a.y);
  const lng = Number(a.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < IL_BOUNDS.minLat || lat > IL_BOUNDS.maxLat || lng < IL_BOUNDS.minLng || lng > IL_BOUNDS.maxLng) return null;

  // `showCamera?id=IL-IDOTD1-IK14B&direction=NONE`: one id per view.
  const page = a.ImgPath?.trim();
  const camId = page?.match(/[?&]id=([^&]+)/)?.[1];
  const dirCode = (a.CameraDirection || page?.match(/[?&]direction=([^&]+)/)?.[1] || 'NONE').toUpperCase();
  const viewId = camId ? `${camId}-${dirCode}` : a.OBJECTID != null ? String(a.OBJECTID) : undefined;
  if (!viewId) return null;

  const place = a.CameraLocation?.replace(/\s+/g, ' ').trim() || 'IDOT Camera';
  const dir = DIRECTIONS[dirCode];
  const county = countyFromSnapshot(still);

  return {
    id: `ildot-${viewId}`,
    lat,
    lng,
    name: dir ? `${place} (${dir})` : place,
    city: county ? `${county} County` : 'Illinois',
    country: 'US',
    feed_url: still,
    ...(page && /^https:\/\//i.test(page) ? { external_url: page } : {}),
    source: 'IDOT',
  };
}

async function fetchPage(offset: number): Promise<{ rows: IllinoisAttributes[]; more: boolean }> {
  const url = `${LAYER}?where=1%3D1&outFields=${FIELDS}&orderByFields=OBJECTID`
    + `&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}&f=json`;
  const res = await stealthFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`IDOT HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(`IDOT ${data.error.message || 'query error'}`);
  const features: Array<{ attributes?: IllinoisAttributes }> = Array.isArray(data?.features) ? data.features : [];
  return { rows: features.map(f => f.attributes ?? {}), more: data?.exceededTransferLimit === true };
}

async function loadIllinoisCameras(): Promise<CctvCamera[]> {
  const cams = new Map<string, CctvCamera>();
  /* A failed page throws rather than serving what was read so far: a short
     index would be cached as if Illinois had shrunk, where throwing lets
     sourceCache keep the last good one. */
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, more } = await fetchPage(page * PAGE_SIZE);
    for (const row of rows) {
      const cam = mapIllinoisRow(row);
      if (cam) cams.set(cam.id, cam);
    }
    if (!more) break;
  }
  console.log(`[OSIRIS] Illinois cameras — IDOT: ${cams.size}`);
  return [...cams.values()];
}

export const fetchIllinoisCameras = cachedSource('illinois', loadIllinoisCameras);
