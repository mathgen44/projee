// Test automatique (npm run selftest -- --selftest-media=<dossier>) : enchaîne les cas
// importants et capture les deux fenêtres, avec la luminosité moyenne de la sortie,
// pour vérifier que le projecteur reste noir quand il le doit.

export async function runSelftest({ state, engine, actions, addVideos, rt }) {
  const api = window.projee;
  const t0 = performance.now();
  const log = (m) => api.invoke('selftest:log', `${((performance.now() - t0) / 1000).toFixed(2)}s ${m}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const r = await api.invoke('selftest:capture', name);
    log(`capture ${name}: ${r.map((x) => `${x.window} lum=${x.mean.toFixed(1)}`).join(' ')}`);
  };
  const waitFor = async (what, pred, ms = 20000) => {
    const s = performance.now();
    while (!pred()) {
      if (performance.now() - s > ms) throw new Error(`délai dépassé : ${what}`);
      await sleep(20);
    }
  };
  const armed = (cue) => Object.entries(engine.slots).some(([n, s]) => n !== engine.current && s.cueId === cue.id && s.state === 'armed');

  (async () => {
    try {
      log(`écrans ${JSON.stringify(state.info.displays)}`);
      const devices = await navigator.mediaDevices.enumerateDevices();
      log(`sorties son : ${devices.filter((d) => d.kind === 'audiooutput').map((d) => d.label || '(sans nom)').join(' | ')}`);
      await sleep(800);
      log(`sortie : ${JSON.stringify(await api.invoke('selftest:outputInfo'))}`);
      await shot('01-demarrage');

      await addVideos(state.info.selftestFiles);
      await waitFor('analyse', () => state.cues.every((c) => rt(c.id).status && rt(c.id).status !== 'loading'));
      log(`conduite : ${state.cues.map((c) => `${c.name}=${rt(c.id).status}/${rt(c.id).duration?.toFixed(2)}`).join(', ')}`);
      const [c1, c2, c3] = state.cues;
      await waitFor('vidéo 1 prête', () => armed(c1));
      await shot('02-prete-mais-noir');

      actions.go();
      log('GO vidéo 1');
      await sleep(120);
      await shot('03-fondu-entree');
      await sleep(1300);
      await shot('04-lecture');
      actions.pause();
      await sleep(400);
      await shot('05-pause');
      actions.pause();
      await waitFor('fin vidéo 1', () => engine.current === null);
      await sleep(60);
      await shot('06-fin-retour-noir');

      c2.endAction = 'next';
      c2.fadeIn = 0;
      engine.cueUpdated(c2);
      await waitFor('vidéo 2 prête', () => armed(c2));
      actions.go();
      log('GO vidéo 2 (enchaîne sur 3)');
      await waitFor('enchaînement sur 3', () => engine.currentCue === c3);
      await sleep(400);
      await shot('07-enchainement-video-3');
      await waitFor('fin vidéo 3', () => engine.current === null);
      await sleep(60);
      await shot('08-fin-noir');

      engine.setStandby(c1.id);
      await waitFor('vidéo 1 prête', () => armed(c1));
      actions.go();
      await sleep(1500);
      actions.black();
      log('NOIR');
      await sleep(40);
      await shot('09-noir-immediat');

      c3.endAction = 'hold';
      engine.cueUpdated(c3);
      engine.setStandby(c3.id);
      await waitFor('vidéo 3 prête', () => armed(c3));
      actions.go();
      await waitFor('image figée', () => engine.currentState === 'held');
      await sleep(200);
      await shot('10-image-figee');
      actions.fade();
      await waitFor('fondu au noir', () => engine.current === null);
      await sleep(60);
      await shot('11-apres-fondu-au-noir');
      log('TERMINÉ');
    } catch (err) {
      log(`ÉCHEC ${err.stack || err}`);
    }
    await sleep(300);
    api.invoke('app:quit');
  })();

  return (ev) => {
    if (ev.type !== 'level' && ev.type !== 'time') log(`événement ${JSON.stringify(ev)}`);
  };
}
