import { describe, it, expect } from 'vitest';
import { countyFromSnapshot, fetchIllinoisCameras, mapIllinoisRow, type IllinoisAttributes } from './illinois';

/** A row verbatim from IDOT's TrafficCamerasTM_Public layer. */
const row: IllinoisAttributes = {
  OBJECTID: 1,
  ImgPath: 'https://travelmidwest.com/showCamera?id=IL-IDOTD1-IK14B&direction=NONE',
  CameraLocation: 'Hillside Tower Camera 9',
  CameraDirection: 'NONE',
  y: 41.88597,
  x: -87.91483,
  SnapShot: 'https://cctv.travelmidwest.com/snapshots/IL-IDOTD1_1_Cook_WB_Albin_4188597_-8791483_2_NONE.jpg',
  TooOld: 'false',
};

describe('mapIllinoisRow', () => {
  it('maps a camera view to its snapshot', () => {
    expect(mapIllinoisRow(row)).toEqual({
      id: 'ildot-IL-IDOTD1-IK14B-NONE',
      lat: 41.88597,
      lng: -87.91483,
      name: 'Hillside Tower Camera 9',
      city: 'Cook County',
      country: 'US',
      feed_url: 'https://cctv.travelmidwest.com/snapshots/IL-IDOTD1_1_Cook_WB_Albin_4188597_-8791483_2_NONE.jpg',
      external_url: 'https://travelmidwest.com/showCamera?id=IL-IDOTD1-IK14B&direction=NONE',
      source: 'IDOT',
    });
  });

  it('gives each direction of one pole its own id and a direction in the name', () => {
    const west = mapIllinoisRow({ ...row, CameraDirection: 'W', ImgPath: 'https://travelmidwest.com/showCamera?id=IL-DUPAGECOUNTY-58&direction=W' });
    const east = mapIllinoisRow({ ...row, CameraDirection: 'E', ImgPath: 'https://travelmidwest.com/showCamera?id=IL-DUPAGECOUNTY-58&direction=E' });
    expect(west?.id).toBe('ildot-IL-DUPAGECOUNTY-58-W');
    expect(east?.id).toBe('ildot-IL-DUPAGECOUNTY-58-E');
    expect(west?.name).toBe('Hillside Tower Camera 9 (West)');
  });

  it('skips stale, unplaced and imageless rows', () => {
    expect(mapIllinoisRow({ ...row, TooOld: 'true' })).toBeNull();
    expect(mapIllinoisRow({ ...row, SnapShot: '' })).toBeNull();
    expect(mapIllinoisRow({ ...row, x: null, y: null })).toBeNull();
    expect(mapIllinoisRow({ ...row, x: -80, y: 40 })).toBeNull();
  });
});

describe('countyFromSnapshot', () => {
  it('reads the county from the file name', () => {
    expect(countyFromSnapshot('https://cctv.travelmidwest.com/snapshots/IL-DUPAGECOUNTY_1_DuPage_EB_75th_4175070_-8803100_1_W.jpg')).toBe('DuPage');
    expect(countyFromSnapshot('https://cctv.travelmidwest.com/snapshots/IL-IDOTD8_1_St-Clair_EB_I-64.jpg')).toBe('St. Clair');
    expect(countyFromSnapshot('https://cctv.travelmidwest.com/snapshots/IL-IDOTD1_1_Cook_WB_Albin.jpg')).toBe('Cook');
  });

  it('ignores a street where other agencies put one in the county slot', () => {
    expect(countyFromSnapshot('https://cctv.travelmidwest.com/snapshots/IL-LAKECOUNTY_1_Wadsworth_Rd_1.jpg')).toBeUndefined();
    expect(countyFromSnapshot('https://example.com/cam.jpg')).toBeUndefined();
  });
});

const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('live IDOT feed', () => {
  liveIt('returns thousands of uniquely identified Illinois cameras', async () => {
    const cams = await fetchIllinoisCameras();
    expect(cams.length).toBeGreaterThan(3000);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);
  }, 120_000);
});
