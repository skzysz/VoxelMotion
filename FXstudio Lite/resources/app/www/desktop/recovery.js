/* Durable recovery for the ordinary effect editor and existing projects. */
(() => {
  'use strict';
  const UI = BFX.ui, native = window.FXDesktopAPI;
  if (!native?.recoveryLoad) return;
  const writerId = crypto.randomUUID();
  let sequence = 0, active = null, draft = null, warning = '', hidden = false;
  let timer, openingTemplate = false, unloading = false, queue = Promise.resolve();
  let unsaved = null;
  const clock = date => new Date(date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  function serialize(project) {
    const {thumb, ...snapshot} = project;
    return JSON.stringify(snapshot);
  }

  function status(session, text, failed = false) {
    if (!session?.status) return;
    session.status.dataset.state = failed ? 'error' : 'saved';
    session.status.querySelector('span').textContent = text;
    session.status.querySelector('button').hidden = !failed;
  }

  function snapshot(session) {
    const pv = session.owner?._historyPreview;
    const player = pv?.pl || session.view?._pcPlayer;
    return {
      version: 1, writerId, sequence: ++sequence,
      project: JSON.parse(serialize(session.project)),
      context: { kind: session.kind, effectId: session.effectId,
        time: Number(player?.t) || 0, mode: pv?.mode || 'project', selectedLayer: UI.S.sel || null }
    };
  }

  function accepted(session, record, fingerprint) {
    fingerprint = serialize(record.project);
    session.saved = fingerprint;
    session.touched = true;
    session.savedAt = record.savedAt;
    if (!draft || draft.writerId !== record.writerId || draft.sequence <= record.sequence) draft = record;
    if (unsaved?.sequence <= record.sequence) unsaved = null;
    warning = '';
    if (serialize(session.project) === fingerprint) status(session, 'Сохранено в ' + clock(record.savedAt));
    renderBanners();
  }

  function failed(session, record, error) {
    if (draft?.writerId === record.writerId && draft.sequence >= record.sequence) return;
    if (!unsaved || unsaved.sequence < record.sequence) unsaved = record;
    status(session, 'Не удалось сохранить', true);
    warning = 'Последние изменения не записаны. Повторите сохранение перед выходом.';
    console.error('Autosave:', error);
    renderBanners();
  }

  function save(session = active, force = false) {
    if (!session) return Promise.resolve(true);
    let record, fingerprint;
    try {
      fingerprint = serialize(session.project);
      if (!force && fingerprint === session.saved) return Promise.resolve(true);
      record = snapshot(session);
    } catch (error) { status(session, 'Не удалось подготовить черновик', true); return Promise.resolve(false); }
    status(session, 'Сохранение…');
    const task = queue.catch(() => {}).then(async () => {
      if (unloading) return true;
      try {
        const saved = await native.recoverySave(record);
        accepted(session, saved, fingerprint);
        return true;
      } catch (error) { failed(session, record, error); return false; }
    });
    queue = task;
    return task;
  }

  function flushSync(session = active) {
    clearTimeout(timer);
    if (!session && !unsaved) return true;
    try {
      const fingerprint = session && serialize(session.project);
      if (session && !session.touched && fingerprint === session.saved) {
        if (!unsaved) return true;
        session = null;
      }
      const record = session ? snapshot(session) : { ...unsaved, sequence: ++sequence };
      const result = native.recoverySaveSync(record);
      if (!result.ok) throw Error(result.error);
      if (session) accepted(session, result.draft, fingerprint);
      else { draft = result.draft; unsaved = null; warning = ''; renderBanners(); }
      return true;
    } catch (error) {
      if (session) failed(session, snapshot(session), error);
      return false;
    }
  }

  function observe() {
    const session = active;
    if (!session || session.owner?.closed || (session.view && UI.tab !== 'studio')) return;
    let next;
    try { next = serialize(session.project); } catch { status(session, 'Ошибка черновика', true); return; }
    if (next === session.observed) return;
    session.observed = next;
    session.touched = true;
    status(session, 'Есть изменения…');
    clearTimeout(timer);
    timer = setTimeout(() => save(session), 650);
  }

  function track(project, owner, kind, effectId, view) {
    if (!project || active?.project === project) return;
    if (active) { save(active); active.unsubscribe?.(); }
    clearTimeout(timer);
    const fingerprint = serialize(project);
    const session = active = { project, owner, kind, effectId, view,
      saved: fingerprint, observed: fingerprint, touched: false };
    const label = document.createElement('div');
    label.className = 'fx-autosave-status';
    label.setAttribute('role', 'status');
    label.setAttribute('aria-live', 'polite');
    label.append(UI.h('span', null, 'Автосохранение включено'),
      UI.btn('Повторить', () => save(session, true), 'ghost sm'));
    label.querySelector('button').hidden = true;
    const head = owner?.head || view?.querySelector('.st-head');
    if (head) head.insertBefore(label, head.querySelector(':scope > .btn.primary'));
    session.status = label;
    session.unsubscribe = BFX.EditHistory?.attach(project).listen(observe);
    if (owner) {
      const close = owner.close;
      owner.close = function (...args) {
        if (owner.closed) return;
        if (active === session) {
          flushSync(session);
          session.unsubscribe?.();
          // Retain a failed snapshot in memory so it can be retried from the catalog.
          active = null;
        }
        return close.apply(this, args);
      };
    }
  }

  const openFx = UI.openFx;
  UI.openFx = function (id, ...args) {
    const sheet = openFx.call(this, id, ...args);
    if (!openingTemplate && sheet?._historyProject) track(sheet._historyProject, sheet, 'effect', id);
    return sheet;
  };
  const openTpl = UI.openTpl;
  UI.openTpl = function (...args) {
    openingTemplate = true;
    let sheet;
    try { sheet = openTpl.apply(this, args); } finally { openingTemplate = false; }
    if (sheet?._historyProject) track(sheet._historyProject, sheet, 'effect', sheet._historyProject.layers[0].fx);
    return sheet;
  };

  function trackStudio() {
    const view = document.querySelector('[data-v="studio"]');
    if (UI.tab === 'studio' && UI.S.pr && view?._pcPlayer) track(UI.S.pr, null, 'project', null, view);
  }

  async function restore() {
    const record = unsaved || draft;
    if (!record) return;
    const project = structuredClone(record.project);
    if (project.layers.some(layer => !BFX.FX.map[layer.fx])) {
      UI.toast('В черновике есть недоступный эффект. Файл сохранён для восстановления.', 4500);
      return;
    }
    while (UI.stack.length) UI.stack.at(-1).close();
    const context = record.context;
    if (context.kind === 'effect') {
      const sheet = UI.openFx(context.effectId, null, { historyProject: project });
      if (!sheet) return;
      const pv = sheet._historyPreview;
      if (context.mode) pv.setMode(context.mode);
      pv.pl.pause();
      pv.pl.seek(context.time || 0);
      // openFx normally starts playback after 350 ms; recovery should stay paused.
      setTimeout(() => { if (!sheet.closed) { pv.pl.pause(); pv.pl.seek(context.time || 0); } }, 400);
    } else {
      UI.openProject(project);
      trackStudio();
      UI.S.sel = context.selectedLayer;
      const player = document.querySelector('[data-v="studio"]')?._pcPlayer;
      player?.pause(); player?.seek(context.time || 0);
    }
    if (active) {
      active.touched = true;
      status(active, 'Черновик восстановлен · ' + clock(record.savedAt || Date.now()));
    }
    UI.toast('Работа восстановлена. Изменения сохраняются автоматически.', 3000);
  }

  async function retry() {
    if (!unsaved) return save(active, true);
    try {
      const record = await native.recoverySave({ ...unsaved, sequence: ++sequence });
      draft = record; unsaved = null; warning = '';
      renderBanners();
      UI.toast('Черновик сохранён');
    } catch { UI.toast('Сохранение не удалось. Проверьте доступ к папке профиля.', 4000); }
  }

  function renderBanners() {
    for (const view of document.querySelectorAll('#views > [data-v="fx"],#views > [data-v="projects"]')) {
      view.querySelector(':scope > .fx-recovery-banner')?.remove();
      const record = unsaved || draft;
      if (!record && !warning) continue;
      if (hidden && view.dataset.v === 'fx' && !warning) continue;
      const box = UI.h('section', { class: 'fx-recovery-banner', 'aria-label': 'Черновик проекта' });
      const info = UI.h('div', { class: 'fx-recovery-info' }, UI.h('strong', null, warning ? 'Проверьте автосохранение' : 'Продолжить работу'),
        UI.h('p', null, warning || 'Ваш последний черновик сохранён на этом компьютере.'));
      if (record) info.append(UI.h('small', null, (record.project.name || 'Без названия') + ' · ' + record.project.layers.length + ' ' +
        (BFX.layerWord55?.(record.project.layers.length) || 'слоёв') + (record.savedAt ? ' · ' + new Date(record.savedAt).toLocaleString('ru-RU') : '')));
      const actions = UI.h('div', { class: 'fx-recovery-actions' });
      if (record) actions.append(UI.btn('Продолжить', restore, 'primary sm', 'play'));
      if (unsaved) actions.append(UI.btn('Повторить сохранение', retry, 'ghost sm'));
      if (record && view.dataset.v === 'projects') actions.append(UI.btn('Удалить черновик', async () => {
        if (!await UI.confirm('Удалить черновик? Сохранённые проекты останутся.', 'Удалить', true)) return;
        try {
          await queue;
          await native.recoveryClear(); draft = null; unsaved = null; warning = '';
          renderBanners();
        } catch { UI.toast('Не удалось удалить черновик'); }
      }, 'ghost sm'));
      else if (!warning) actions.append(UI.btn('Скрыть', () => { hidden = true; renderBanners(); }, 'ghost sm'));
      box.append(info, actions); view.prepend(box);
    }
  }

  const go = UI.go;
  UI.go = function (...args) {
    if (active?.view && args[0] !== 'studio') { flushSync(); active.unsubscribe?.(); active = null; }
    const result = go.apply(this, args);
    trackStudio(); renderBanners();
    return result;
  };
  const mount = UI.mount;
  UI.mount = function (...args) { const result = mount.apply(this, args); renderBanners(); return result; };
  for (const type of ['input', 'change', 'pointerup']) document.addEventListener(type, () => setTimeout(observe, 0), true);
  // Also cover edits made by nested tools, undo/redo and direct object manipulation.
  setInterval(observe, 800);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'KeyS' && (active || unsaved)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (unsaved && !active) retry(); else save(active, true).then(ok => { if (ok) UI.toast('Черновик сохранён'); });
    }
  }, true);
  window.addEventListener('beforeunload', event => {
    unloading = true;
    if (!flushSync()) {
      unloading = false;
      event.preventDefault(); event.returnValue = '';
      UI.toast('Черновик не сохранён. Повторите сохранение перед выходом.', 5000);
    }
  });
  native.recoveryLoad().then(result => {
    // A late initial read must not replace a draft already saved in this session.
    if (!draft) draft = result.draft;
    if (result.fromBackup) warning = 'Последний файл повреждён. Доступна предыдущая резервная копия.';
    else if (result.damaged && !draft) warning = 'Не удалось прочитать черновик. Существующие файлы сохранены.';
    renderBanners();
  }).catch(() => { warning = 'Не удалось прочитать черновик. Проверьте доступ к папке профиля.'; renderBanners(); });
  BFX.autosave = { save: () => save(active, true), restore, get current() { return active?.project; } };
})();
