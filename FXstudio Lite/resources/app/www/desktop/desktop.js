/* Desktop workspace for the shared FXstudio editor. */
'use strict';

(() => {
  const UI = BFX.ui;
  const { h, ic } = UI;
  const store = BFX.store;
  const native = window.FXDesktopAPI;
  const desktop = BFX.desktop = { exportFolder: '' };
  document.body.classList.add('fx-desktop');

  const labels = {
    fx: 'Эффекты', fox: 'Скины', tpl: 'Шаблоны', studio: 'Студия',
    assets: 'База ассетов', projects: 'Проекты', imp: 'Импорт', history: 'История'
  };
  const keyboard = [
    ['Пробел', 'Запуск или пауза предпросмотра'],
    ['← / →', 'На кадр назад или вперёд'],
    ['Shift + ← / →', 'Перемотка на полсекунды'],
    ['Левый клик', 'Выбрать элемент кадра'],
    ['Колесо / Shift + колесо', 'Масштаб / поворот выбранного объекта'],
    ['Alt + перетаскивание', 'Управление 3D в предпросмотре'],
    ['Ctrl + F', 'Поиск в текущем разделе'],
    ['Ctrl + S', 'Сохранить проект студии'],
    ['Ctrl + E', 'Настройки экспорта'],
    ['Ctrl + O', 'Импортировать файлы'],
    ['Ctrl + Z / Ctrl + Shift + Z', 'Отменить / повторить настройку (любая раскладка)'],
    ['Esc', 'Закрыть окно или вернуться назад']
  ];

  function shortcutSheet() {
    const sheet = UI.sheet({ title: 'Горячие клавиши', cls: 'pc-shortcuts' });
    const rows = keyboard.map(([key, description]) => h('div', { class: 'pc-shortcut' }, h('span', null, description), h('kbd', null, key)));
    sheet.body.append(...rows);
  }

  async function importFiles(files) {
    if (document.body.classList.contains('busy')) return;
    try {
      const selected = files || await UI.pickFiles('*/*', true);
      if (selected.length) await UI.importDesktopFiles(selected);
    } catch (error) {
      UI.toast('Не удалось импортировать файлы. ' + error.message, 3500);
    }
  }

  function openFolder() {
    native?.openExportFolder().catch(error => UI.toast('Не удалось открыть папку. ' + error.message, 3500));
  }

  if (native) {
    native.preferences().then(value => { desktop.exportFolder = value.exportFolder; }).catch(() => {});
    native.onDownload(result => {
      if (result.state === 'completed') UI.toast('Сохранено · ' + result.name, 3000);
      if (result.state === 'interrupted') UI.toast('Не удалось записать файл. Проверьте папку экспорта.', 4200);
    });
    const run = BFX.EX.run;
    let exporting = 0;
    BFX.EX.run = async function (...args) {
      if (++exporting === 1) await native.exportActive(true).catch(() => {});
      try { return await run.apply(this, args); }
      finally { if (--exporting === 0) await native.exportActive(false).catch(() => {}); }
    };
  }

  const sheetFactory = UI.sheet;
  UI.sheet = function (options = {}) {
    const previousFocus = document.activeElement;
    const sheet = sheetFactory({
      ...options,
      onClose(value) {
        options.onClose?.(value);
        requestAnimationFrame(() => {
          const top = UI.stack.at(-1);
          if (previousFocus?.isConnected && (!top || top.panel.contains(previousFocus))) previousFocus.focus({ preventScroll: true });
        });
      }
    });
    sheet.panel.setAttribute('role', 'dialog');
    sheet.panel.setAttribute('aria-modal', 'true');
    sheet.panel.setAttribute('aria-label', options.title || 'Диалог');
    sheet.panel.tabIndex = -1;
    if (options.cls === 'tall' && options.pad === false) sheet.panel.classList.add('pc-picker');
    requestAnimationFrame(() => {
      if (sheet.closed || UI.stack.at(-1) !== sheet || sheet.panel.contains(document.activeElement)) return;
      const search = sheet.body.querySelector('input[type=search]');
      (search || sheet.panel).focus({ preventScroll: true });
    });
    return sheet;
  };

  const settings = UI.settings;
  UI.settings = function (...args) {
    const result = settings.apply(this, args);
    const sheet = result?.body ? result : UI.stack.at(-1);
    const list = sheet?.body.querySelector('.settings-list');
    if (!list) return result;
    const open = async () => {
      const panel = UI.sheet({ title: 'Рабочее место', cls: 'settings-detail' });
      const folderText = h('div', { class: 'pc-folder-path', role: 'status' }, desktop.exportFolder || 'Загрузки');
      const buttons = h('div', { class: 'row gap wrap' });
      if (native) {
        const select = UI.btn('Выбрать папку', async () => {
          select.disabled = true;
          try {
            const value = await native.chooseExportFolder();
            if (value) {
              desktop.exportFolder = value.exportFolder;
              folderText.textContent = value.exportFolder;
            }
          } catch (error) { UI.toast('Не удалось выбрать папку. ' + error.message, 3500); }
          finally { select.disabled = false; }
        }, 'ghost', 'folder');
        buttons.append(select, UI.btn('Открыть папку', openFolder, 'ghost', 'export'));
        panel.body.append(UI.section('Папка экспорта', folderText, buttons));
        try {
          const value = await native.preferences();
          desktop.exportFolder = value.exportFolder;
          folderText.textContent = value.exportFolder;
        } catch {}
      }
      panel.body.append(UI.section('Клавиатура', UI.btn('Горячие клавиши', shortcutSheet, 'ghost wide', 'info')));
    };
    list.prepend(h('button', { class: 'settings-category', type: 'button', onclick: open },
      h('span', { class: 'settings-category-icon' }, ic('studio')),
      h('span', { class: 'settings-category-copy' }, h('b', null, 'Рабочее место'), h('small', null, 'Папка экспорта и клавиатура')),
      h('span', { class: 'settings-arrow', 'aria-hidden': 'true' }, '›')));
    return result;
  };

  function updateNavigation() {
    const title = document.querySelector('.pc-page-title');
    if (title) title.textContent = labels[UI.tab] || 'VoxelMotion';
    for (const button of document.querySelectorAll('.tabbar .tab')) {
      if (button.dataset.t === UI.tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  const go = UI.go;
  UI.go = function (...args) {
    const result = go.apply(this, args);
    updateNavigation();
    return result;
  };

  const mount = UI.mount;
  UI.mount = function (...args) {
    const result = mount.apply(this, args);
    const top = document.querySelector('#app.ready > .top');
    const nav = document.querySelector('#app.ready > .tabbar');
    if (!top || !nav) return result;
    const settingsButton = top.querySelector('button');
    nav.setAttribute('aria-label', 'Разделы VoxelMotion');
    nav.prepend(h('button', { class: 'pc-logo', type: 'button', title: 'Эффекты', onclick: () => UI.go('fx') },
      h('img', { src: 'desktop/voxelmotion.svg', alt: '', width: 34, height: 34 }), h('b', null, 'VoxelMotion')));
    const order = ['fx', 'studio', 'tpl', 'fox', 'assets', 'projects', 'imp', 'history'];
    for (const key of order) {
      const button = nav.querySelector(`[data-t="${key}"]`);
      if (!button) continue;
      button.title = labels[key];
      nav.append(button);
    }
    top.replaceChildren(h('h1', { class: 'pc-page-title' }, labels[UI.tab] || 'Эффекты'), h('div', { class: 'grow' }),
      native ? UI.btn('Папка экспорта', openFolder, 'ghost sm pc-folder-button', 'folder') : null,
      UI.ib('info', shortcutSheet, 'Горячие клавиши', 'ghost'), settingsButton);
    updateNavigation();
    return result;
  };

  const preview = UI.previewBlock;
  UI.previewBlock = function (options = {}) {
    const pv = preview(options);
    if (!options.withProject) return pv;
    const scope = options.key || 'default';
    const key = 'pcPreviewZoom_' + scope;
    const min = 25, max = 100, initial = max, step = 5;
    let size = initial;
    const value = h('output', { class: 'pc-scale-value', 'aria-live': 'polite', 'aria-label': 'Масштаб предпросмотра' });
    const decrease = h('button', {
      type: 'button', class: 'ib pc-scale-step', 'aria-label': 'Уменьшить предпросмотр',
      onclick: () => set(size - step, true)
    }, '−');
    const increase = h('button', {
      type: 'button', class: 'ib pc-scale-step', 'aria-label': 'Увеличить предпросмотр',
      onclick: () => set(size + step, true)
    }, '+');
    const fit = UI.ib('reset', () => set(initial, true), 'Вписать в окно', 'pc-scale-fit');
    function set(number, persist) {
      size = Math.round(BFX.u.clamp(Number(number) || initial, min, max));
      value.textContent = size + '%';
      decrease.disabled = size <= min;
      increase.disabled = size >= max;
      fit.disabled = size === max;
      pv.el.style.setProperty('--pc-preview-factor', String(size / max));
      if (persist) store.set(key, size);
      pv.pl.invalidate();
    }
    pv.el.classList.add('pc-preview');
    const frame = h('div', { class: 'pc-preview-frame' });
    pv.stage.before(frame);
    frame.append(pv.stage);
    pv.el.append(h('div', { class: 'pc-preview-scale', role: 'group', 'aria-label': 'Размер превью' },
      h('span', null, 'Размер превью'), h('div', { class: 'pc-scale-buttons' }, decrease, value, increase, fit)));
    const legacySize = store.get('pcPreviewSize_' + scope, null);
    const migrated = Number(legacySize) > 0 ? Number(legacySize) / 76 * max : initial;
    set(store.get(key, migrated), false);
    return pv;
  };

  function splitter(anchor, key) {
    if (!anchor) return;
    const parent = anchor.parentElement;
    if (parent.querySelector(':scope > .pc-splitter')) return;
    const bar = h('div', {
      class: 'pc-splitter', role: 'separator', tabindex: 0, 'aria-orientation': 'vertical',
      'aria-label': 'Ширина области предпросмотра', 'aria-valuemin': 25, 'aria-valuemax': 68,
      title: 'Перетащите границу. Двойной щелчок возвращает исходную ширину.'
    });
    const storageKey = 'pcPanelWidth_' + key;
    const initial = key === 'studio' ? 48 : 54;
    let ratio = initial;
    let drag;
    function set(next, persist) {
      ratio = BFX.u.clamp(Number(next) || initial, 25, 68);
      parent.style.setProperty('--pc-left-share', ratio + '%');
      bar.setAttribute('aria-valuenow', String(Math.round(ratio)));
      if (persist) store.set(storageKey, ratio);
    }
    parent.classList.add('pc-workspace');
    anchor.after(bar);
    set(store.get(storageKey, initial), false);
    bar.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, ratio: anchor.getBoundingClientRect().width / parent.clientWidth * 100 };
      bar.setPointerCapture(event.pointerId);
      bar.classList.add('dragging');
    });
    bar.addEventListener('pointermove', event => {
      if (drag) set(drag.ratio + (event.clientX - drag.x) / parent.clientWidth * 100, true);
    });
    const end = () => { drag = undefined; bar.classList.remove('dragging'); };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('lostpointercapture', end);
    bar.addEventListener('dblclick', () => set(initial, true));
    bar.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      set(ratio + (event.key === 'ArrowRight' ? 2 : -2), true);
    });
  }

  for (const name of ['openFx', 'openTpl']) {
    const open = UI[name];
    UI[name] = function (...args) {
      const result = open.apply(this, args);
      const sheet = result?.panel ? result : UI.stack.at(-1);
      const stage = sheet?.body.querySelector('.fx-edit > .fx-pv');
      if (!stage) return result;
      sheet.panel.classList.add('pc-editor');
      splitter(stage, 'fx');
      if (name === 'openFx') {
        const add = sheet.body.querySelector('.fx-foot .btn');
        const exportButton = sheet.head.querySelector('.btn.primary');
        if (add && exportButton) sheet.head.insertBefore(UI.btn('В студию', () => add.click(), 'ghost sm', 'studio'), exportButton);
      }
      return result;
    };
  }

  const studio = UI.views.studio;
  UI.views.studio = function (view) {
    const result = studio.call(this, view);
    splitter(view.querySelector('.pc-studio-left'), 'studio');
    return result;
  };

  const exportSheet = UI.exportSheet;
  UI.exportSheet = function (...args) {
    const sheet = exportSheet.apply(this, args);
    if (!sheet) return sheet;
    sheet.panel.classList.add('pc-export-sheet');
    if (native) sheet.head.insertBefore(UI.ib('folder', openFolder, 'Папка экспорта', 'ghost'), sheet.head.lastElementChild);
    return sheet;
  };

  function player() {
    const top = UI.stack.at(-1);
    if (top) return top._historyPreview?.pl;
    return UI.tab === 'studio' ? document.querySelector('[data-v=studio]')?._pcPlayer : undefined;
  }

  function isEditable(target) {
    return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable=true]');
  }

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing) return;
    const top = UI.stack.at(-1);
    if (event.key === 'Tab' && top) {
      const focusable = [...top.panel.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')]
        .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) { event.preventDefault(); return; }
      const active = document.activeElement;
      if (!top.panel.contains(active) || active === top.panel || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
      return;
    }
    if (event.ctrlKey && !event.altKey && !event.metaKey) {
      // event.code follows the physical key, unlike event.key in a Cyrillic layout.
      // Native undo in text editors must stay untouched.
      if ((event.code === 'KeyZ' || ['z','я'].includes((event.key || '').toLowerCase())) && !isEditable(event.target)) {
        const history = player()?.editHistory;
        const done = event.shiftKey ? history?.redo() : history?.undo();
        if (done) { event.preventDefault(); UI.toast(event.shiftKey ? 'Изменение повторено' : 'Изменение отменено', 1250); }
        return;
      }
      const key = event.code;
      if (key === 'KeyF') {
        event.preventDefault();
        const active = top?.body || document.querySelector(`[data-v="${UI.tab}"]`);
        const field = active?.querySelector('input[type=search]');
        field?.focus();
        field?.select();
      }
      if (key === 'KeyO' && !event.repeat) { event.preventDefault(); importFiles(); }
      if (key === 'KeyS' && !top && UI.tab === 'studio' && UI.S.pr && !event.repeat) {
        event.preventDefault();
        UI.saveNow().then(() => UI.toast('Проект сохранён')).catch(() => UI.toast('Не удалось сохранить проект'));
      }
      if (key === 'KeyE' && !event.repeat) {
        const button = top?._historyPreview ? (top.head?.querySelector('.btn.primary') || top.body.querySelector('.fx-foot .btn.primary')) : !top && UI.tab === 'studio' ? document.querySelector('.st-head .btn.primary') : null;
        if (button) { event.preventDefault(); button.click(); }
      }
      return;
    }
    if (event.altKey || event.metaKey || isEditable(event.target) || event.target.closest?.('button,[role=separator]')) return;
    const pl = player();
    if (!pl) return;
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); pl.toggle(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      pl.pause();
      pl.seek(pl.t + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .5 : 1 / 30));
    }
  });

  const dropTarget = h('div', { class: 'pc-drop-overlay', hidden: true }, ic('image'), h('b', null, 'Отпустите файлы для импорта'));
  document.body.append(dropTarget);
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  document.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropTarget.hidden = document.body.classList.contains('busy');
    event.dataTransfer.dropEffect = dropTarget.hidden ? 'none' : 'copy';
  });
  document.addEventListener('dragleave', event => {
    if (!event.relatedTarget && (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight)) dropTarget.hidden = true;
  });
  document.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropTarget.hidden = true;
    importFiles(Array.from(event.dataTransfer.files));
  });
  window.addEventListener('blur', () => { dropTarget.hidden = true; });
})();
