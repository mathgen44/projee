'use strict';
// Protocole projee-media:// : sert les vidéos locales avec prise en charge des requêtes
// partielles (Range), indispensables pour se déplacer dans une vidéo, et l'en-tête CORS
// qui permet de faire passer le son par Web Audio (fondus, vumètre, choix de la sortie).
const { protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const SCHEME = 'projee-media';

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4',
  '.webm': 'video/webm', '.mkv': 'video/webm', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
  }]);
}

function toStream(filePath, opts) {
  const nodeStream = fs.createReadStream(filePath, opts);
  // Une lecture interrompue par le lecteur (déplacement dans la vidéo) ne doit jamais remonter en erreur.
  nodeStream.on('error', () => {});
  return Readable.toWeb(nodeStream);
}

function handleMediaProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let filePath;
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const size = stat.size;
    const headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    };
    const range = request.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = 0;
      let end = size - 1;
      if (m && m[1] !== '') {
        start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
      } else if (m && m[2] !== '') {
        start = Math.max(0, size - parseInt(m[2], 10));
      }
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      }
      return new Response(toStream(filePath, { start, end }), {
        status: 206,
        headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
      });
    }
    return new Response(toStream(filePath), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  });
}

module.exports = { SCHEME, registerMediaScheme, handleMediaProtocol };
