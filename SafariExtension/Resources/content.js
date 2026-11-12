// LinkTunnel – content script.
// Fanger klik på links, viser hvor linket går hen og advarer om svindel, før siden åbnes.
(() => {
  'use strict';
  if (window.top !== window || window.__linkTunnel) return;
  window.__linkTunnel = true;

  const api = globalThis.browser || globalThis.chrome;
  const core = globalThis.LinkTunnelCore;
  if (!core || !api) return;

  const DEFAULTS = {
    enabled: true,
    mode: 'always',          // 'always' | 'warnings'
    skipSameSite: true,
    followRedirects: 'smart', // 'smart' | 'all' | 'off'
    domainAge: true,
    markMismatch: true,       // rød ramme om links, hvor tekst og adresse ikke passer sammen
    trusted: []
  };
  const DEEP_TIMEOUT_MS = 6000;
  const QUICK_TIMEOUT_MS = 3500; // i "kun ved advarsler"-tilstand

  let settings = Object.assign({}, DEFAULTS);
  try {
    api.storage.local.get(DEFAULTS).then((s) => { settings = Object.assign({}, DEFAULTS, s); scheduleScan(); }, () => {});
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
      scheduleScan();
    });
  } catch (e) { /* bruger standardindstillinger */ }

  // -------------------------------------------------------------------------
  // Klik
  // -------------------------------------------------------------------------

  function findAnchor(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const el of path) {
      if (!el || el.nodeType !== 1) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a' || tag === 'area') {
        const raw = el.getAttribute('href') || el.getAttribute('xlink:href');
        if (raw) return { el, raw };
      }
    }
    return null;
  }

  function linkTextOf(el) {
    let text = (el.innerText || el.textContent || '').trim();
    if (!text) text = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!text) {
      const img = el.querySelector && el.querySelector('img[alt]');
      if (img) text = img.getAttribute('alt') || '';
    }
    return text.replace(/\s+/g, ' ').slice(0, 300);
  }

  // Adressen, hvis linket skal tjekkes – ellers null (mailto, samme side, samme websted, betroet domæne).
  function checkableURL(raw) {
    let url;
    try { url = new URL(raw, document.baseURI); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null; // mailto, tel, javascript osv.

    // Hop på samme side
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return null;

    const reg = core.registrableDomain(url.hostname.toLowerCase());
    if (settings.skipSameSite && reg === core.registrableDomain(location.hostname.toLowerCase())) return null;
    if ((settings.trusted || []).includes(reg)) return null;
    return url;
  }

  function onClick(event) {
    if (!settings.enabled || event.button !== 0 || event.defaultPrevented) return;
    const found = findAnchor(event);
    if (!found || found.el.hasAttribute('download')) return;

    const url = checkableURL(found.raw);
    if (!url) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const target = (found.el.getAttribute('target') || '').toLowerCase();
    const ctx = {
      href: url.href,
      linkText: linkTextOf(found.el),
      newTab: target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey,
      pageHost: location.hostname
    };
    handle(ctx);
  }

  window.addEventListener('click', onClick, true);

  // -------------------------------------------------------------------------
  // Markering på forhånd
  // -------------------------------------------------------------------------
  // Links, hvor teksten viser én adresse, men linket går til en anden, får en rød
  // stiplet ramme, før man trykker. Det dækker også "Åbn i ny fane" fra
  // tryk-og-hold-menuen, som en udvidelse ikke kan stoppe. Kun det lokale tjek
  // bruges her – der laves ingen netværksopslag for links, man ikke har trykket på.

  const MARK = 'data-linktunnel-mismatch';
  const MARK_TITLE = 'data-linktunnel-title';
  const MAX_MARK_LINKS = 3000;
  const LOOKS_LIKE_ADDRESS = /[a-z0-9\u00a1-\uffff]\.[a-z\u00a1-\uffff]{2,}/i;
  let scanTimer = null;
  let observing = false;

  function mismatchDetail(el) {
    const raw = el.getAttribute('href') || el.getAttribute('xlink:href');
    if (!raw || el.hasAttribute('download')) return null;
    if (!LOOKS_LIKE_ADDRESS.test(el.textContent || '')) return null; // billigt forfilter
    const url = checkableURL(raw);
    if (!url) return null;
    const report = core.analyze(url.href, { linkText: linkTextOf(el), pageHost: location.hostname });
    const hit = (report.findings || []).find((f) => f.id === 'text-mismatch');
    return hit ? hit.detail || hit.title : null;
  }

  function unmark(el) {
    el.removeAttribute(MARK);
    if (el.hasAttribute(MARK_TITLE)) {
      el.removeAttribute(MARK_TITLE);
      el.removeAttribute('title');
    }
  }

  function installMarkStyle() {
    if (document.getElementById('linktunnel-mark-style')) return;
    const style = document.createElement('style');
    style.id = 'linktunnel-mark-style';
    style.textContent = 'a[' + MARK + ']{outline:2px dashed #d93025 !important;outline-offset:2px !important;}';
    (document.head || document.documentElement).appendChild(style);
  }

  function scan() {
    scanTimer = null;
    if (!document.documentElement) return;
    const on = settings.enabled && settings.markMismatch;
    if (!on) {
      document.querySelectorAll('a[' + MARK + ']').forEach(unmark);
      return;
    }
    if (!observing) {
      observing = true;
      new MutationObserver(scheduleScan).observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href']
      });
    }
    const anchors = document.querySelectorAll('a[href]');
    if (anchors.length > MAX_MARK_LINKS) return; // tjekket ved klik gælder stadig
    for (const el of anchors) {
      let detail = null;
      try { detail = mismatchDetail(el); } catch (e) { /* ignorer enkelte links */ }
      if (detail) {
        if (!el.hasAttribute(MARK)) {
          installMarkStyle();
          el.setAttribute(MARK, '');
          if (!el.getAttribute('title')) {
            el.setAttribute('title', 'LinkTunnel: ' + detail);
            el.setAttribute(MARK_TITLE, '');
          }
        }
      } else if (el.hasAttribute(MARK)) {
        unmark(el);
      }
    }
  }

  function scheduleScan() {
    if (scanTimer === null) scanTimer = setTimeout(scan, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleScan, { once: true });
  } else {
    scheduleScan();
  }

  // -------------------------------------------------------------------------
  // Analyse
  // -------------------------------------------------------------------------

  function localReport(ctx, deep) {
    const opts = { linkText: ctx.linkText, pageHost: ctx.pageHost };
    if (deep) {
      if (deep.redirectChain && deep.redirectChain.length) opts.redirectChain = deep.redirectChain;
      if (deep.finalURL) opts.finalURL = deep.finalURL;
      if (typeof deep.domainAgeDays === 'number') opts.domainAgeDays = deep.domainAgeDays;
      if (deep.domainCreated) opts.domainCreated = deep.domainCreated;
      if (deep.networkError) opts.networkError = deep.networkError;
    }
    return core.analyze(ctx.href, opts);
  }

  function needsDeep(ctx) {
    const prep = core.prepare(ctx.href);
    if (!prep.ok) return false;
    const follow = settings.followRedirects === 'all' || (settings.followRedirects === 'smart' && prep.shouldFollow);
    return follow || !!settings.domainAge;
  }

  function deepCheck(ctx, timeoutMs) {
    const msg = {
      type: 'deepCheck',
      url: ctx.href,
      followRedirects: settings.followRedirects,
      domainAge: !!settings.domainAge
    };
    const request = Promise.resolve(api.runtime.sendMessage(msg)).catch((e) => ({ networkError: String(e && e.message || e) }));
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ networkError: 'tjekket tog for lang tid', timedOut: true }), timeoutMs));
    return Promise.race([request, timeout]);
  }

  async function handle(ctx) {
    const first = localReport(ctx, null);
    const wantsDeep = needsDeep(ctx);

    if (settings.mode === 'warnings' && first.verdict === 'ok') {
      if (!wantsDeep) return navigate(ctx);
      const toast = showToast('Tjekker link …');
      const deep = await deepCheck(ctx, QUICK_TIMEOUT_MS);
      toast.remove();
      const report = localReport(ctx, deep);
      if (report.verdict === 'ok') return navigate(ctx);
      return openDialog(ctx, report, false);
    }

    const dialog = openDialog(ctx, first, wantsDeep);
    if (!wantsDeep) return;
    const deep = await deepCheck(ctx, DEEP_TIMEOUT_MS);
    if (dialog.closed) return;
    dialog.update(localReport(ctx, deep), false, deep && deep.networkError);
  }

  function navigate(ctx) {
    if (ctx.newTab) {
      window.open(ctx.href, '_blank', 'noopener');
    } else {
      location.assign(ctx.href);
    }
  }

  function trust(domain) {
    const list = Array.from(new Set([...(settings.trusted || []), domain]));
    settings.trusted = list;
    try { api.storage.local.set({ trusted: list }); } catch (e) { /* ignorer */ }
  }

  // -------------------------------------------------------------------------
  // Brugerflade (lukket shadow DOM, så siden hverken kan se eller style den)
  // -------------------------------------------------------------------------

  const CSS = `
    :host { all: initial; }
    .layer { position: absolute; left: 0; top: 0; overflow: hidden; pointer-events: auto;
      -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
      font: 16px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      --bg: #ffffff; --fg: #111418; --muted: #5d6670; --line: #e3e6ea; --chip: #f3f5f7;
      --ok: #1f8a4c; --caution: #b26a00; --danger: #c62828; --accent: #0a64d6; }
    @media (prefers-color-scheme: dark) {
      .layer { --bg: #1c1e21; --fg: #f2f4f6; --muted: #a2abb5; --line: #33373c; --chip: #26292d;
        --ok: #4cc283; --caution: #f0a540; --danger: #ff6b6b; --accent: #4b9bff; }
    }
    .wrap { position: absolute; inset: 0; }
    .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); opacity: 0; transition: opacity .18s; }
    .sheet { position: absolute; left: 50%; bottom: 0; transform: translate(-50%, 100%);
      width: min(100%, 560px); max-height: 88%; overflow: auto; box-sizing: border-box;
      background: var(--bg); color: var(--fg); border-radius: 18px 18px 0 0;
      padding: 10px 18px calc(18px + env(safe-area-inset-bottom)); transition: transform .22s ease-out;
      box-shadow: 0 -8px 30px rgba(0,0,0,.25); }
    .open .backdrop { opacity: 1; }
    .open .sheet { transform: translate(-50%, 0); }
    .grip { width: 38px; height: 5px; border-radius: 3px; background: var(--line); margin: 0 auto 12px; }
    .status { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
    .dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 16px; flex: none; }
    .ok .dot { background: var(--ok); } .ok .status-text { color: var(--ok); }
    .caution .dot { background: var(--caution); } .caution .status-text { color: var(--caution); }
    .danger .dot { background: var(--danger); } .danger .status-text { color: var(--danger); }
    .label { margin: 16px 0 2px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
    .domain { font-size: 26px; font-weight: 700; line-height: 1.2; word-break: break-all; }
    .url { margin-top: 6px; font: 13px/1.45 ui-monospace, "SF Mono", Menlo, monospace; color: var(--muted);
      word-break: break-all; max-height: 4.4em; overflow: hidden; }
    .url b { color: var(--fg); font-weight: 700; }
    .url.expanded { max-height: none; }
    .more { background: none; border: 0; color: var(--accent); font: inherit; font-size: 13px; padding: 4px 0; }
    .summary { margin: 14px 0 4px; font-size: 17px; font-weight: 600; }
    ul { list-style: none; margin: 8px 0 0; padding: 0; }
    li { display: flex; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
    li:first-child { border-top: 0; }
    .ico { flex: none; width: 20px; text-align: center; font-weight: 700; }
    .lv-danger .ico { color: var(--danger); } .lv-warning .ico { color: var(--caution); }
    .lv-info .ico { color: var(--muted); } .lv-good .ico { color: var(--ok); }
    .ft { font-weight: 600; font-size: 15px; } .fd { color: var(--muted); font-size: 14px; word-break: break-word; }
    .pending { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 14px; margin-top: 10px; }
    .spin { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: s .8s linear infinite; }
    @keyframes s { to { transform: rotate(360deg); } }
    details { margin-top: 10px; font-size: 14px; color: var(--muted); }
    details ol { margin: 6px 0 0; padding-left: 20px; font: 12px/1.5 ui-monospace, Menlo, monospace; word-break: break-all; }
    .buttons { display: grid; gap: 10px; margin-top: 18px; }
    button.btn { appearance: none; border: 0; border-radius: 12px; padding: 14px; font: 600 17px -apple-system, sans-serif; }
    .primary { background: var(--accent); color: #fff; }
    .secondary { background: var(--chip); color: var(--fg); }
    .danger-outline { background: transparent; color: var(--danger); border: 1.5px solid var(--danger) !important; }
    .trust { background: none; border: 0; color: var(--muted); font: 14px -apple-system, sans-serif; padding: 6px; text-decoration: underline; }
    .toast { position: absolute; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); transform: translateX(-50%);
      background: rgba(20,22,25,.92); color: #fff; padding: 10px 16px; border-radius: 20px; font-size: 15px;
      display: flex; align-items: center; gap: 8px; pointer-events: none; }
  `;

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function mountLayer() {
    const host = document.createElement('linktunnel-overlay');
    host.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.appendChild(h('style', { text: CSS }));
    const layer = h('div', { class: 'layer' });
    root.appendChild(layer);
    (document.documentElement || document.body).appendChild(host);

    // Læg laget præcist over det synlige område – også på sider uden mobil-layout,
    // hvor siden er zoomet ud, så teksten ikke bliver lillebitte.
    const place = () => {
      const vv = window.visualViewport;
      if (!vv) {
        Object.assign(layer.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh' });
        return;
      }
      const s = vv.scale || 1;
      Object.assign(layer.style, {
        left: vv.pageLeft + 'px', top: vv.pageTop + 'px',
        width: vv.width * s + 'px', height: vv.height * s + 'px',
        transform: 'scale(' + 1 / s + ')', transformOrigin: '0 0'
      });
    };
    place();
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', place); vv.addEventListener('scroll', place); }
    window.addEventListener('scroll', place, { passive: true });

    return {
      layer,
      remove() {
        if (vv) { vv.removeEventListener('resize', place); vv.removeEventListener('scroll', place); }
        window.removeEventListener('scroll', place);
        host.remove();
      }
    };
  }

  function showToast(text) {
    const m = mountLayer();
    m.layer.style.pointerEvents = 'none';
    m.layer.appendChild(h('div', { class: 'toast' }, [h('span', { class: 'spin' }), text]));
    return m;
  }

  const STATUS = {
    ok: { icon: '✓', text: 'Ser i orden ud' },
    caution: { icon: '!', text: 'Vær opmærksom' },
    danger: { icon: '✕', text: 'Advarsel – mulig svindel' }
  };
  const ICONS = { danger: '✕', warning: '!', info: 'i', good: '✓' };

  function urlLine(report) {
    const full = report.finalURL || report.url;
    const host = report.displayHost || '';
    const reg = report.registrableDomain || '';
    const asciiHost = report.host || report.asciiHost || '';
    // Vis værten i læsbar form (æøå) og fremhæv ejeren af domænet.
    let rest = full;
    const idx = full.indexOf(asciiHost);
    if (!host || idx < 0) return h('div', { class: 'url' }, full);
    const before = full.slice(0, idx);
    rest = full.slice(idx + asciiHost.length);
    const sub = host.endsWith(reg) ? host.slice(0, host.length - reg.length) : host;
    return h('div', { class: 'url' }, [before, sub, h('b', { text: host.endsWith(reg) ? reg : '' }), rest]);
  }

  function openDialog(ctx, report, pending) {
    const m = mountLayer();
    const state = { closed: false };
    let lastFocus = document.activeElement;

    const close = () => {
      if (state.closed) return;
      state.closed = true;
      wrap.classList.remove('open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => m.remove(), 220);
      if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* ignorer */ }
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);

    const wrap = h('div', { class: 'wrap' });
    const backdrop = h('div', { class: 'backdrop', onclick: close });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'LinkTunnel' });
    wrap.appendChild(backdrop);
    wrap.appendChild(sheet);
    m.layer.appendChild(wrap);

    function render(r, isPending, networkError) {
      sheet.textContent = '';
      sheet.className = 'sheet ' + r.verdict;
      const st = STATUS[r.verdict] || STATUS.ok;

      sheet.appendChild(h('div', { class: 'grip' }));
      sheet.appendChild(h('div', { class: 'status' }, [
        h('span', { class: 'dot', text: st.icon, 'aria-hidden': 'true' }),
        h('span', { class: 'status-text', text: isPending && r.verdict === 'ok' ? 'Foreløbigt i orden' : st.text })
      ]));

      sheet.appendChild(h('div', { class: 'label', text: 'Linket går til' }));
      sheet.appendChild(h('div', { class: 'domain', text: r.registrableDomain || r.displayHost || r.finalURL }));
      const line = urlLine(r);
      sheet.appendChild(line);
      if ((r.finalURL || '').length > 90) {
        const more = h('button', { class: 'more', text: 'Vis hele adressen' });
        more.addEventListener('click', () => { line.classList.add('expanded'); more.remove(); });
        sheet.appendChild(more);
      }

      sheet.appendChild(h('div', { class: 'summary', text: r.summary }));
      const shown = r.findings.filter((f) => f.level !== 'info' || r.findings.length <= 6);
      if (shown.length) {
        sheet.appendChild(h('ul', null, shown.map((f) =>
          h('li', { class: 'lv-' + f.level }, [
            h('span', { class: 'ico', text: ICONS[f.level] || '•', 'aria-hidden': 'true' }),
            h('div', null, [h('div', { class: 'ft', text: f.title }), f.detail ? h('div', { class: 'fd', text: f.detail }) : null])
          ])
        )));
      }

      if (r.redirectChain && r.redirectChain.length > 1) {
        sheet.appendChild(h('details', null, [
          h('summary', { text: 'Omdirigeringer (' + (r.redirectChain.length - 1) + ')' }),
          h('ol', null, r.redirectChain.map((u) => h('li', { text: u })))
        ]));
      }

      if (isPending) {
        sheet.appendChild(h('div', { class: 'pending' }, [h('span', { class: 'spin' }), 'Tjekker omdirigeringer og domænets alder …']));
      } else if (networkError && !r.findings.some((f) => f.id === 'shortener')) {
        sheet.appendChild(h('div', { class: 'pending', text: 'Det udvidede tjek kunne ikke gennemføres (' + networkError + ').' }));
      }

      const buttons = h('div', { class: 'buttons' });
      const open = () => { close(); navigate(ctx); };
      if (r.verdict === 'danger') {
        buttons.appendChild(h('button', { class: 'btn primary', text: 'Gå tilbage', onclick: close }));
        buttons.appendChild(h('button', { class: 'btn danger-outline', text: 'Åbn alligevel', onclick: open }));
      } else {
        buttons.appendChild(h('button', { class: 'btn primary', text: ctx.newTab ? 'Åbn i ny fane' : 'Åbn link', onclick: open }));
        buttons.appendChild(h('button', { class: 'btn secondary', text: 'Annuller', onclick: close }));
        const reg = core.registrableDomain(core.parseURL(ctx.href).host);
        if (r.verdict === 'ok' && reg) {
          buttons.appendChild(h('button', {
            class: 'trust', text: 'Spørg ikke igen for ' + core.hostToUnicode(reg),
            onclick: () => { trust(reg); open(); }
          }));
        }
      }
      sheet.appendChild(buttons);
    }

    render(report, pending, null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      wrap.classList.add('open');
      const b = sheet.querySelector('button.btn');
      if (b) try { b.focus({ preventScroll: true }); } catch (e) { /* ignorer */ }
    }));

    return {
      get closed() { return state.closed; },
      update(r, isPending, networkError) { if (!state.closed) render(r, isPending, networkError); }
    };
  }
})();
