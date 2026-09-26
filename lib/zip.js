'use strict';

// A small streaming ZIP writer (no compression: "stored" entries). Each file is read twice:
// once for its CRC-32 and size, so its header is complete before its data is streamed, and
// the total length is known up front (Content-Length). No ZIP64: entries and the whole
// archive stay under 4 GB (checked), far above the data disk.
//
//   const zip = await planZip([{ name: 'worship.db', path: '/tmp/x.db' }, { name: 'meta.json', data: Buffer }])
//   zip.size                 // bytes of the archive
//   await zip.writeTo(stream) // honours backpressure

const fs = require('fs');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crcUpdate(crc, buf) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function fileCrc(file) {
  let crc = 0;
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    crc = crcUpdate(crc, chunk);
    size += chunk.length;
  }
  return { crc, size };
}

// DOS date / time of a Date.
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const LIMIT = 0xffffffff;

async function planZip(entries, now = new Date()) {
  const { time, date } = dosTime(now);
  const planned = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const { crc, size } = entry.data ? { crc: crcUpdate(0, entry.data), size: entry.data.length } : await fileCrc(entry.path);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    planned.push({ entry, name, crc, size, time, date, offset, header });
    offset += header.length + name.length + size;
    if (size > LIMIT || offset > LIMIT) throw new Error('zip: over 4 GB');
  }
  const central = planned.map((p) => {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4); // made by
    c.writeUInt16LE(20, 6); // needed
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(p.time, 12);
    c.writeUInt16LE(p.date, 14);
    c.writeUInt32LE(p.crc, 16);
    c.writeUInt32LE(p.size, 20);
    c.writeUInt32LE(p.size, 24);
    c.writeUInt16LE(p.name.length, 28);
    c.writeUInt32LE(p.offset, 42);
    return Buffer.concat([c, p.name]);
  });
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(planned.length, 8);
  end.writeUInt16LE(planned.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  const size = offset + centralSize + end.length;
  if (size > LIMIT || planned.length > 0xffff) throw new Error('zip: too large');

  async function writeTo(out) {
    const write = (buf) => (out.write(buf) ? null : new Promise((resolve, reject) => {
      out.once('drain', resolve);
      out.once('error', reject);
    }));
    for (const p of planned) {
      await write(Buffer.concat([p.header, p.name]));
      if (p.entry.data) await write(p.entry.data);
      else {
        let written = 0;
        for await (const chunk of fs.createReadStream(p.entry.path)) {
          written += chunk.length;
          if (written > p.size) break;
          await write(chunk);
        }
        // Changed meanwhile (e.g. a file deleted during the backup): never a corrupt archive.
        if (written !== p.size) throw new Error(`zip: ${p.entry.name} changed while writing`);
      }
    }
    for (const c of central) await write(c);
    await write(end);
  }

  return { size, count: planned.length, writeTo };
}

module.exports = { planZip, crcUpdate };
