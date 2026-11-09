// LinkTunnel – indstillinger i Safari-udvidelsens pop-up.
(() => {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const DEFAULTS = {
    enabled: true,
    mode: 'always',
    skipSameSite: true,
    followRedirects: 'smart',
    domainAge: true,
    trusted: []
  };

  const $ = (sel) => document.querySelector(sel);
  const save = (patch) => api.storage.local.set(patch);

  function renderTrusted(list) {
    const ul = $('#trusted');
    ul.textContent = '';
    $('#trusted-empty').hidden = list.length > 0;
    list.slice().sort().forEach((domain) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = domain;
      const btn = document.createElement('button');
      btn.textContent = 'Fjern';
      btn.addEventListener('click', async () => {
        const s = await api.storage.local.get({ trusted: [] });
        const next = (s.trusted || []).filter((d) => d !== domain);
        await save({ trusted: next });
        renderTrusted(next);
      });
      li.append(name, btn);
      ul.appendChild(li);
    });
  }

  async function init() {
    const s = Object.assign({}, DEFAULTS, await api.storage.local.get(DEFAULTS));

    for (const id of ['enabled', 'skipSameSite', 'domainAge']) {
      const el = document.getElementById(id);
      el.checked = !!s[id];
      el.addEventListener('change', () => save({ [id]: el.checked }));
    }
    for (const name of ['mode', 'followRedirects']) {
      document.querySelectorAll('input[name="' + name + '"]').forEach((el) => {
        el.checked = el.value === s[name];
        el.addEventListener('change', () => { if (el.checked) save({ [name]: el.value }); });
      });
    }
    renderTrusted(s.trusted || []);
  }

  init();
})();
