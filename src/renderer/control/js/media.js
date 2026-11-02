// Analyse d'une vidéo dès son import : durée, résolution, vignette, et surtout
// vérification qu'elle se lit bien (mieux vaut le savoir avant le spectacle).

const queue = [];
let busy = false;

export function probe(path) {
  return new Promise((resolve) => {
    queue.push({ path, resolve });
    next();
  });
}

async function next() {
  if (busy || !queue.length) return;
  busy = true;
  const { path, resolve } = queue.shift();
  try {
    resolve(await probeNow(path));
  } catch (err) {
    resolve({ ok: false, error: err.message });
  }
  busy = false;
  next();
}

function probeNow(path) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'La vidéo ne se charge pas (délai dépassé)' }), 15000);
    v.addEventListener('error', () => {
      const code = v.error && v.error.code;
      finish({ ok: false, error: code === 4 ? 'Format ou codec non pris en charge' : code === 2 ? 'Fichier illisible' : 'Vidéo illisible' });
    });
    v.addEventListener('loadedmetadata', () => {
      if (!v.videoWidth) {
        finish({ ok: false, duration: v.duration, error: "Pas d'image lisible (codec vidéo non pris en charge ?)" });
        return;
      }
      v.currentTime = Math.min(1, v.duration * 0.1 || 0);
    });
    v.addEventListener('seeked', () => {
      let thumb = null;
      try {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 90;
        const g = c.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, 160, 90);
        const r = Math.min(160 / v.videoWidth, 90 / v.videoHeight);
        const w = v.videoWidth * r;
        const h = v.videoHeight * r;
        g.drawImage(v, (160 - w) / 2, (90 - h) / 2, w, h);
        thumb = c.toDataURL('image/jpeg', 0.7);
      } catch { /* vignette facultative */ }
      finish({ ok: true, duration: v.duration, width: v.videoWidth, height: v.videoHeight, thumb });
    });
    v.src = window.projee.mediaUrl(path);
  });
}
