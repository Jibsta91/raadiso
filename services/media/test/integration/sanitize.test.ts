// Uploaded photos are stored without their metadata: no GPS position, no camera details (GDPR). The
// re-encoding happens in imgproxy (sm:1), so this runs the same imgproxy image. Run: ./raadi test-integration
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { imgproxySigner } from '@raadi/service-kit';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { ImageSanitizer } from '../../src/media/imaging.js';

const KEY = 'aa'.repeat(32);
const SALT = 'bb'.repeat(32);
const fixture = fileURLToPath(
  new URL('../../../../../tests/fixtures/images/listing-gps.jpg', import.meta.url),
);

let imgproxy: StartedTestContainer;

before(async () => {
  // The platform's imgproxy image without its entrypoint (which reads secrets from the volume): the
  // same upstream image, taken from deploy/imgproxy/Dockerfile so the two never differ.
  const dockerfile = readFileSync(
    new URL('../../../../../deploy/imgproxy/Dockerfile', import.meta.url),
    'utf8',
  );
  const upstream = /^FROM (\S+)/m.exec(dockerfile)![1]!;
  // The metadata settings the platform runs with (deploy/compose/storage.yaml).
  const compose = readFileSync(
    new URL('../../../../../deploy/compose/storage.yaml', import.meta.url),
    'utf8',
  );
  const setting = (name: string) => new RegExp(`${name}: '([^']*)'`).exec(compose)![1]!;
  imgproxy = await new GenericContainer(upstream)
    .withEnvironment({
      IMGPROXY_KEY: KEY,
      IMGPROXY_SALT: SALT,
      IMGPROXY_LOCAL_FILESYSTEM_ROOT: '/fixtures',
      IMGPROXY_ALLOWED_SOURCES: 'local://',
      IMGPROXY_STRIP_METADATA: setting('IMGPROXY_STRIP_METADATA'),
      IMGPROXY_KEEP_COPYRIGHT: setting('IMGPROXY_KEEP_COPYRIGHT'),
    })
    .withCopyFilesToContainer([{ source: fixture, target: '/fixtures/listing-gps.jpg' }])
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp('/health', 8080))
    .start();
});

after(async () => {
  await imgproxy?.stop();
});

/** The APP1 "Exif" segment of a JPEG, or an empty buffer. */
function exifSegment(jpeg: Buffer): Buffer {
  for (let i = 2; i + 4 < jpeg.length;) {
    if (jpeg[i] !== 0xff) break;
    const marker = jpeg[i + 1]!;
    const length = jpeg.readUInt16BE(i + 2);
    if (marker === 0xe1 && jpeg.subarray(i + 4, i + 10).equals(Buffer.from('Exif\0\0'))) {
      return jpeg.subarray(i + 4, i + 2 + length);
    }
    if (marker === 0xda) break; // start of scan: no more metadata segments
    i += 2 + length;
  }
  return Buffer.alloc(0);
}

it('a photo with a GPS position and camera details is stored without them', async () => {
  const original = readFileSync(fixture);
  // The fixture really carries them (the test would prove nothing otherwise).
  const before = exifSegment(original);
  assert.ok(
    before.includes(Buffer.from([0x25, 0x88])) || before.includes(Buffer.from([0x88, 0x25])),
  );
  assert.ok(original.includes(Buffer.from('RaadiTestCam')));

  const sanitizer = new ImageSanitizer(
    `http://${imgproxy.getHost()}:${imgproxy.getMappedPort(8080)}`,
    imgproxySigner(KEY, SALT),
  );
  const { data, width } = await sanitizer.sanitize('local:///listing-gps.jpg');
  assert.equal(width, 320);
  // The encoder writes a small technical EXIF block (resolution, colour space). It must not hold a GPS
  // section (tag 0x8825), the camera or the copyright.
  const exif = exifSegment(data);
  assert.ok(
    !exif.includes(Buffer.from([0x25, 0x88])) && !exif.includes(Buffer.from([0x88, 0x25])),
    'no GPS',
  );
  assert.ok(!data.includes(Buffer.from('RaadiTestCam')), 'no camera make');
  assert.ok(!data.includes(Buffer.from('raadi-test')), 'no copyright (it often names a person)');
  assert.ok(!data.includes(Buffer.from('http://ns.adobe.com/xap/')), 'no XMP');
});
