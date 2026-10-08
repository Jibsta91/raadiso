import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { demoListings } from '@raadi/catalog/demo';
import { parseReply } from '../../src/media/clamav.js';
import { jpegDimensions, sniffImageType } from '../../src/media/imaging.js';
import { demoSvg } from '../../src/demo-art.js';

describe('content sniffing', () => {
  it('trusts magic bytes, not names or headers', () => {
    assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
    assert.equal(sniffImageType(Buffer.from('89504e470d0a1a0a0000', 'hex')), 'image/png');
    assert.equal(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp');
    assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(sniffImageType(Buffer.from('GIF89a')), null);
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
  });

  it('reads JPEG dimensions from the SOF segment', () => {
    // SOI, APP0 (len 16), SOF0 (len 17): precision 8, height 480, width 640
    const jpeg = Buffer.concat([
      Buffer.from('ffd8', 'hex'),
      Buffer.from('ffe00010', 'hex'),
      Buffer.alloc(14),
      Buffer.from('ffc0001108', 'hex'),
      Buffer.from([0x01, 0xe0, 0x02, 0x80]),
      Buffer.alloc(12),
    ]);
    assert.deepEqual(jpegDimensions(jpeg), { width: 640, height: 480 });
    assert.equal(jpegDimensions(Buffer.from('ffd8ff', 'hex')), null);
  });
});

describe('clamd replies', () => {
  it('maps OK and FOUND, and treats anything else as an error (never clean)', () => {
    assert.deepEqual(parseReply('stream: OK\0'), { clean: true });
    assert.deepEqual(parseReply('stream: Eicar-Signature FOUND\0'), {
      clean: false,
      signature: 'Eicar-Signature',
    });
    assert.throws(() => parseReply('INSTREAM size limit exceeded. ERROR\0'));
  });
});

describe('demo art', () => {
  it('renders a self-contained SVG with an icon for every demo image, in both countries', () => {
    for (const listing of demoListings()) {
      const svg = demoSvg(listing.images[0]!);
      assert.match(svg, /^<svg [^>]*width="1280" height="960"/);
      assert.ok(!/href=|<script|<image/i.test(svg), 'no external references');
      assert.ok(!svg.includes('undefined'), `${listing.category} has a drawing`);
    }
  });
});
