import { describe, it, expect } from 'vitest';
import { cleanCarsTitle, mapCars511Feature, type Cars511Feature, type Cars511Source } from './cars511';
import { fetchKansasCameras, kcScoutCaption } from './kansas';
import { fetchMassachusettsCameras } from './massachusetts';
import { fetchNebraskaCameras } from './nebraska';

const KDOT: Cars511Source = {
  base: 'https://www.kandrive.gov',
  idPrefix: 'kdot',
  source: 'KDOT',
  state: 'Kansas',
  captionFor: kcScoutCaption,
  bounds: { minLat: 36.9, maxLat: 40.1, minLng: -102.1, maxLng: -94.1 },
};

/** A KDOT video camera, in the shape kandrive.gov's MapFeatures returns. */
const videoCamera: Cars511Feature = {
  title: 'I-70 at Topeka Blvd',
  uri: 'camera/2001',
  features: [{ geometry: { coordinates: [-95.67, 39.05] } }],
  __typename: 'Camera',
  active: true,
  views: [{
    category: 'VIDEO',
    url: 'https://kscam.carsprogram.org/2001.jpg?1794000180000',
    sources: [{ type: 'application/x-mpegURL', src: 'https://kdot-sfs2.us-east-1.skyvdn.com/rtplive/KS2001/playlist.m3u8' }],
  }],
};

/** A KC Scout still on the Missouri side, verbatim from kandrive.gov. */
const kcScout: Cars511Feature = {
  title: 'I-29 NB @ 152 HWY',
  uri: 'camera/3774',
  features: [{ geometry: { coordinates: [-94.65767, 39.25482] } }],
  __typename: 'Camera',
  active: true,
  views: [{ category: 'IMAGE', url: 'https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/M029NBC-16.jpg?1794000180000', sources: null }],
};

describe('cleanCarsTitle', () => {
  it('drops a route prefix the rest of the title repeats', () => {
    expect(cleanCarsTitle('I-90: I-90-WB-MM79.4-Charlton-@ MSP C10 West side')).toBe('I-90-WB-MM79.4-Charlton-@ MSP C10 West side');
    expect(cleanCarsTitle('RT-3: Rt3-SB-MM36.8-Weymouth')).toBe('Rt3-SB-MM36.8-Weymouth');
  });

  it('keeps the prefix when the rest does not name the road', () => {
    expect(cleanCarsTitle('US 77: S of Cortland')).toBe('US 77: S of Cortland');
    expect(cleanCarsTitle('K-39 at Neosho River, Chanute MP 27')).toBe('K-39 at Neosho River, Chanute MP 27');
  });
});

describe('mapCars511Feature', () => {
  it('maps a video camera to its HLS stream and keeps its still', () => {
    expect(mapCars511Feature(videoCamera, KDOT)).toEqual({
      id: 'kdot-2001',
      lat: 39.05,
      lng: -95.67,
      name: 'I-70 at Topeka Blvd',
      city: 'Kansas',
      country: 'US',
      feed_url: 'https://kscam.carsprogram.org/2001.jpg',
      stream_url: 'https://kdot-sfs2.us-east-1.skyvdn.com/rtplive/KS2001/playlist.m3u8',
      stream_type: 'hls',
      external_url: 'https://www.kandrive.gov/@39.05,-95.67,14?show=camera%2F2001',
      source: 'KDOT',
    });
  });

  it('captions KC Scout cameras by the state in their snapshot name', () => {
    const still = (code: string) => ({ ...kcScout, views: [{ category: 'IMAGE', url: `https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/${code}.jpg`, sources: null }] });
    expect(mapCars511Feature(still('K035SBC-07'), KDOT)?.city).toBe('Kansas City, KS');
    expect(mapCars511Feature(still('P435NBC-02'), KDOT)?.city).toBe('Kansas City, MO');
  });

  it('captions a camera across the state line by the override', () => {
    const cam = mapCars511Feature(kcScout, KDOT);
    expect(cam?.city).toBe('Kansas City, MO');
    expect(cam?.feed_url).toBe('https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/M029NBC-16.jpg');
    expect(cam?.stream_url).toBeUndefined();
  });

  it('keeps only the still when the source is snapshot-only', () => {
    const cam = mapCars511Feature(videoCamera, { ...KDOT, snapshotOnly: true });
    expect(cam?.feed_url).toBe('https://kscam.carsprogram.org/2001.jpg');
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.stream_type).toBeUndefined();
  });

  it('skips a camera with neither a still nor a stream', () => {
    expect(mapCars511Feature({ ...videoCamera, views: [{ category: 'IMAGE', url: null, sources: null }] }, KDOT)).toBeNull();
  });

  it('skips inactive cameras, other feature types and out-of-bounds positions', () => {
    expect(mapCars511Feature({ ...videoCamera, active: false }, KDOT)).toBeNull();
    expect(mapCars511Feature({ ...videoCamera, __typename: 'Sign' }, KDOT)).toBeNull();
    expect(mapCars511Feature({ ...videoCamera, features: [{ geometry: { coordinates: [-80, 39] } }] }, KDOT)).toBeNull();
  });
});

const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('live CARS 511 feeds', () => {
  const cases: Array<[string, () => Promise<unknown[]>, number, number]> = [
    ['Kansas', fetchKansasCameras, 450, 150],
    ['Massachusetts', fetchMassachusettsCameras, 250, 0],
    ['Nebraska', fetchNebraskaCameras, 250, 0],
  ];

  for (const [name, fetcher, atLeast, liveAtLeast] of cases) {
    liveIt(`${name} returns uniquely identified cameras`, async () => {
      const cams = (await fetcher()) as Array<{ id: string; name: string; stream_url?: string }>;
      expect(cams.length).toBeGreaterThan(atLeast);
      expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);
      expect(cams.filter(c => c.stream_url).length).toBeGreaterThanOrEqual(liveAtLeast);
      for (const c of cams) expect(c.name.trim()).not.toBe('');
    }, 60_000);
  }
});
