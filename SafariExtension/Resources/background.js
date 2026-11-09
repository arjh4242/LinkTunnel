// LinkTunnel – baggrundsscript.
// Videresender "dybe" tjek (omdirigeringer og domænealder) til appens native kode,
// fordi netværksopslag uden om siden kun kan laves der.

const api = globalThis.browser || globalThis.chrome;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

async function deepCheck(msg) {
  const key = [msg.url, msg.followRedirects, msg.domainAge].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.value;

  const value = await api.runtime.sendNativeMessage('application.id', {
    type: 'inspect',
    url: msg.url,
    followRedirects: msg.followRedirects,
    domainAge: !!msg.domainAge
  });

  if (value && !value.networkError) {
    cache.set(key, { time: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return value;
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'deepCheck') return false;
  deepCheck(msg).then(
    (value) => sendResponse(value || {}),
    (err) => sendResponse({ networkError: String((err && err.message) || err || 'ukendt fejl') })
  );
  return true; // svaret kommer asynkront
});
