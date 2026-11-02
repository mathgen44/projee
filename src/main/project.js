'use strict';
// Lecture, écriture et export des fichiers projet .projee (JSON).
// Chaque vidéo est référencée par son chemin absolu et par un chemin relatif au projet :
// un dossier copié d'un PC à un Mac (ou sur une clé USB) retrouve ainsi ses vidéos.
const fs = require('node:fs');
const path = require('node:path');

const FORMAT = 'projee';
const VERSION = 1;

function exists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveCue(cue, dir) {
  if (cue.type !== 'video') return cue;
  const candidates = [cue.path];
  if (cue.rel) candidates.push(path.resolve(dir, ...cue.rel.split('/')));
  const found = candidates.find((p) => p && exists(p));
  return { ...cue, path: found || cue.path, missing: !found };
}

function read(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (raw.format !== FORMAT) throw new Error("Ce fichier n'est pas un projet Projee.");
  const dir = path.dirname(filePath);
  return {
    filePath,
    project: {
      name: raw.name || path.basename(filePath, '.projee'),
      cues: (raw.cues || []).map((c) => resolveCue(c, dir)),
    },
  };
}

function serialize(project, filePath) {
  const dir = path.dirname(filePath);
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    name: project.name,
    cues: project.cues.map((c) => {
      const { missing, ...cue } = c;
      if (cue.type === 'video' && cue.path) cue.rel = path.relative(dir, cue.path).split(path.sep).join('/');
      return cue;
    }),
  }, null, 2);
}

function write(filePath, project) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, serialize(project, filePath));
  fs.renameSync(tmp, filePath);
}

// Copie le projet et toutes ses vidéos dans un dossier autonome.
async function exportFolder(project, destDir, onProgress) {
  const videosDir = path.join(destDir, 'videos');
  await fs.promises.mkdir(videosDir, { recursive: true });
  const used = new Map();
  const videos = project.cues.filter((c) => c.type === 'video' && !c.missing);
  const cues = [];
  let done = 0;
  for (const cue of project.cues) {
    if (cue.type !== 'video' || cue.missing) {
      cues.push(cue);
      continue;
    }
    let target = used.get(cue.path);
    if (!target) {
      const ext = path.extname(cue.path);
      const base = path.basename(cue.path, ext);
      let name = base + ext;
      for (let i = 2; [...used.values()].includes(path.join(videosDir, name)); i++) name = `${base} (${i})${ext}`;
      target = path.join(videosDir, name);
      used.set(cue.path, target);
      onProgress?.({ done, total: videos.length, name });
      await fs.promises.copyFile(cue.path, target);
    }
    done++;
    cues.push({ ...cue, path: target });
  }
  onProgress?.({ done, total: videos.length, name: '' });
  const filePath = path.join(destDir, `${(project.name || 'Projet').replace(/[\\/:*?"<>|]/g, '_')}.projee`);
  write(filePath, { ...project, cues });
  return filePath;
}

module.exports = { read, write, exportFolder, exists };
