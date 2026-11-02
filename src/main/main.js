'use strict';
// Processus principal : fenêtre de régie, fenêtre de sortie (projecteur), écrans, fichiers.
const { app, BrowserWindow, ipcMain, screen, dialog, powerSaveBlocker, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { registerMediaScheme, handleMediaProtocol } = require('./media-protocol');
const settings = require('./settings');
const project = require('./project');

const isMac = process.platform === 'darwin';
const SELFTEST = process.argv.includes('--selftest');
const selftestMediaArg = process.argv.find((a) => a.startsWith('--selftest-media='));

registerMediaScheme();

// Une seule instance : deux Projee ne doivent jamais se disputer le projecteur.
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
}

let control = null;
let output = null;
let outputReady = false;
let outputStatus = { kind: 'none' };
let allowClose = false;
let pendingOpen = process.argv.find((a) => a.toLowerCase().endsWith('.projee')) || null;

// Pendant un spectacle, une erreur inattendue ne doit pas faire apparaître de fenêtre système.
process.on('uncaughtException', (err) => logError(err));
process.on('unhandledRejection', (err) => logError(err));

function logError(err) {
  try {
    const line = `[${new Date().toISOString()}] ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'projee.log'), line);
  } catch { /* rien à faire */ }
  console.error(err);
}

// ---------- Écrans ----------

function displayList() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: d.label || `Écran ${i + 1}`,
    primary: d.id === primary.id,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  }));
}

function findDisplay(target) {
  if (!target || target.kind !== 'display') return null;
  const all = screen.getAllDisplays();
  // L'identifiant d'un écran peut changer quand on le rebranche : on retombe alors sur son nom.
  return all.find((d) => String(d.id) === target.id) || all.find((d) => d.label && d.label === target.label) || null;
}

function defaultOutput() {
  const primary = screen.getPrimaryDisplay();
  const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
  return other ? { kind: 'display', id: String(other.id), label: other.label || '' } : { kind: 'window' };
}

// ---------- Fenêtre de sortie ----------

function createOutputWindow() {
  outputReady = false;
  output = new BrowserWindow({
    show: false,
    frame: false,
    backgroundColor: '#000000',
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    enableLargerThanScreen: true,
    title: 'Projee — Sortie',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'output.js'),
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  output.setMenu(null);
  output.loadFile(path.join(__dirname, '..', 'renderer', 'output', 'output.html'));
  output.webContents.on('render-process-gone', (_e, details) => {
    logError(new Error(`Sortie vidéo : processus arrêté (${details.reason})`));
    const old = output;
    output = null;
    old.destroy();
    createOutputWindow();
  });
  output.on('closed', () => {
    if (output && output.isDestroyed()) output = null;
  });
}

function placeOutput() {
  if (!output || output.isDestroyed()) return;
  const target = SELFTEST
    ? (process.argv.includes('--selftest-display') ? defaultOutput() : { kind: 'window' })
    : settings.get().output || defaultOutput();
  if (target.kind === 'window') {
    if (output.isFullScreen()) output.setFullScreen(false);
    output.setAlwaysOnTop(false);
    output.setFocusable(true);
    output.setResizable(true);
    const wa = screen.getPrimaryDisplay().workArea;
    const w = 640;
    const h = 360;
    output.setBounds({ x: wa.x + wa.width - w - 40, y: wa.y + 40, width: w, height: h });
    output.setAspectRatio(16 / 9);
    output.showInactive();
    outputStatus = { kind: 'window' };
  } else {
    const display = findDisplay(target);
    if (!display) {
      // Projecteur débranché : la sortie continue de tourner (le son aussi), cachée,
      // et revient d'elle-même au rebranchement.
      output.hide();
      outputStatus = { kind: 'absent', label: target.label };
    } else {
      output.setAspectRatio(0);
      output.setFocusable(false);
      if (output.isFullScreen()) output.setFullScreen(false);
      output.setBounds(display.bounds);
      output.setAlwaysOnTop(true, 'screen-saver');
      if (isMac) {
        output.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } else {
        output.setFullScreen(true);
      }
      output.showInactive();
      outputStatus = { kind: 'display', id: String(display.id), label: display.label || '' };
    }
  }
  sendOutputCmd({ type: 'windowMode', on: outputStatus.kind === 'window' });
  control?.webContents.send('output:status', outputStatus);
  control?.focus();
}

function sendOutputCmd(cmd) {
  if (output && !output.isDestroyed() && outputReady) output.webContents.send('cmd', cmd);
}

// ---------- Fenêtre de régie ----------

function createControlWindow() {
  const saved = settings.get().controlBounds;
  control = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    ...(saved && !SELFTEST ? saved : {}),
    // Le test automatique se place sur un petit écran (portable) pour vérifier que tout reste accessible.
    ...(SELFTEST ? { width: 1280, height: 700 } : {}),
    backgroundColor: '#15171c',
    title: 'Projee',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'control.js'),
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  control.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));
  control.once('ready-to-show', () => control.show());
  control.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') control.webContents.toggleDevTools();
  });
  const saveBounds = () => {
    if (!control.isMaximized() && !control.isMinimized() && !SELFTEST) settings.set({ controlBounds: control.getBounds() });
  };
  control.on('resize', saveBounds);
  control.on('move', saveBounds);
  control.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    control.webContents.send('app:closeRequest');
  });
  control.on('closed', () => {
    control = null;
    if (output && !output.isDestroyed()) output.destroy();
    app.quit();
  });
}

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Affichage', submenu: [{ role: 'toggleDevTools', label: 'Outils de développement' }] },
    { role: 'windowMenu' },
  ]));
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.on('out:cmd', (_e, cmd) => sendOutputCmd(cmd));
  ipcMain.on('out:event', (_e, ev) => {
    if (ev.type === 'ready') {
      outputReady = true;
      placeOutput();
    }
    control?.webContents.send('out:event', ev);
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    selftest: SELFTEST,
    selftestFiles: selftestMediaArg ? listMedia(selftestMediaArg.split('=').slice(1).join('=')) : [],
    displays: displayList(),
    pendingOpen,
    userData: app.getPath('userData'),
  }));
  ipcMain.handle('output:isReady', () => outputReady);
  ipcMain.handle('app:quit', () => {
    allowClose = true;
    settings.flush();
    control?.close();
  });
  ipcMain.handle('dialog:message', (_e, opts) => dialog.showMessageBox(control, opts));

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));

  ipcMain.handle('displays:list', () => ({ displays: displayList(), status: outputStatus, target: settings.get().output || defaultOutput() }));
  ipcMain.handle('output:set', (_e, target) => {
    settings.set({ output: target });
    placeOutput();
    return outputStatus;
  });

  ipcMain.handle('media:pick', async () => {
    const r = await dialog.showOpenDialog(control, {
      title: 'Ajouter des vidéos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Vidéos', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'] },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('media:exists', (_e, paths) => paths.map((p) => project.exists(p)));
  ipcMain.handle('media:relink', async (_e, oldPath) => {
    const r = await dialog.showOpenDialog(control, {
      title: `Retrouver « ${path.basename(oldPath)} »`,
      defaultPath: path.basename(oldPath),
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  // Après avoir relié un fichier, cherche les autres fichiers manquants dans le même dossier.
  ipcMain.handle('media:findInDir', (_e, dir, names) => names.map((n) => {
    const p = path.join(dir, n);
    return project.exists(p) ? p : null;
  }));
  ipcMain.handle('path:info', (_e, p) => ({ dir: path.dirname(p), base: path.basename(p), name: path.basename(p, path.extname(p)) }));

  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(control, {
      title: 'Ouvrir un projet',
      properties: ['openFile'],
      filters: [{ name: 'Projet Projee', extensions: ['projee'] }],
    });
    if (r.canceled) return null;
    return openProject(r.filePaths[0]);
  });
  ipcMain.handle('project:openPath', (_e, filePath) => openProject(filePath));
  ipcMain.handle('project:save', async (_e, data, filePath, saveAs) => {
    let target = filePath;
    if (!target || saveAs) {
      const r = await dialog.showSaveDialog(control, {
        title: 'Enregistrer le projet',
        defaultPath: target || `${data.name || 'Spectacle'}.projee`,
        filters: [{ name: 'Projet Projee', extensions: ['projee'] }],
      });
      if (r.canceled) return null;
      target = r.filePath;
    }
    project.write(target, data);
    settings.set({ lastProject: target });
    return target;
  });
  ipcMain.handle('project:export', async (_e, data) => {
    const r = await dialog.showOpenDialog(control, {
      title: 'Choisir un dossier pour exporter le projet et ses vidéos',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled) return null;
    const dest = path.join(r.filePaths[0], (data.name || 'Projet').replace(/[\\/:*?"<>|]/g, '_'));
    return project.exportFolder(data, dest, (p) => control?.webContents.send('project:exportProgress', p));
  });

  ipcMain.handle('selftest:capture', async (_e, name) => {
    const dir = path.join(app.getAppPath(), 'selftest-out');
    fs.mkdirSync(dir, { recursive: true });
    const shots = [];
    for (const [win, suffix] of [[output, 'sortie'], [control, 'regie']]) {
      if (!win || win.isDestroyed()) continue;
      const img = await win.webContents.capturePage();
      const file = path.join(dir, `${name}-${suffix}.png`);
      fs.writeFileSync(file, img.toPNG());
      // Luminosité moyenne (0 = noir) pour vérifier automatiquement le noir de la sortie.
      const bmp = img.toBitmap();
      let sum = 0;
      let n = 0;
      for (let i = 0; i < bmp.length; i += 4 * 16) {
        sum += 0.0722 * bmp[i] + 0.7152 * bmp[i + 1] + 0.2126 * bmp[i + 2];
        n++;
      }
      shots.push({ window: suffix, file, mean: n ? sum / n : 0 });
    }
    return shots;
  });
  ipcMain.handle('selftest:outputInfo', () => ({
    status: outputStatus,
    bounds: output?.getBounds(),
    fullscreen: output?.isFullScreen(),
    visible: output?.isVisible(),
    displays: screen.getAllDisplays().map((d) => ({ label: d.label, bounds: d.bounds })),
  }));
  ipcMain.handle('selftest:log', (_e, line) => {
    const dir = path.join(app.getAppPath(), 'selftest-out');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'selftest.log'), line + '\n');
  });
}

function listMedia(dir) {
  return fs.readdirSync(dir).filter((f) => /\.(mp4|mov|webm|mkv|m4v)$/i.test(f)).sort().map((f) => path.join(dir, f));
}

function openProject(filePath) {
  const r = project.read(filePath);
  settings.set({ lastProject: filePath });
  return r;
}

// ---------- Démarrage ----------

app.on('second-instance', (_e, argv) => {
  const file = argv.find((a) => a.toLowerCase().endsWith('.projee'));
  if (control) {
    if (control.isMinimized()) control.restore();
    control.focus();
    if (file) control.webContents.send('project:openRequest', file);
  }
});

app.on('open-file', (e, file) => {
  e.preventDefault();
  if (control) control.webContents.send('project:openRequest', file);
  else pendingOpen = file;
});

app.whenReady().then(() => {
  settings.load();
  handleMediaProtocol();
  // Application locale : autorise l'accès aux sorties son (avec leurs noms).
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
  powerSaveBlocker.start('prevent-display-sleep');
  buildMenu();
  registerIpc();
  createOutputWindow();
  createControlWindow();

  const onDisplaysChanged = () => {
    placeOutput();
    control?.webContents.send('displays:changed');
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);
});

app.on('window-all-closed', () => app.quit());
