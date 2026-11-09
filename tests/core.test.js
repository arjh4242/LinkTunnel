// Kør med: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../Shared/linktunnel-core.js');

const verdict = (url, opts) => core.analyze(url, opts).verdict;
const ids = (url, opts) => core.analyze(url, opts).findings.map((f) => f.id);

test('punycode tur/retur', () => {
  assert.equal(core.hostToUnicode('xn--mnchen-3ya.de'), 'münchen.de');
  assert.equal(core.hostToASCII('münchen.de'), 'xn--mnchen-3ya.de');
  assert.equal(core.hostToUnicode(core.hostToASCII('blåbær.dk')), 'blåbær.dk');
});

test('registrerbart domæne', () => {
  assert.equal(core.registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(core.registrableDomain('a.b.mitid.dk'), 'mitid.dk');
  assert.equal(core.registrableDomain('evil.github.io'), 'evil.github.io');
  assert.equal(core.registrableDomain('github.io'), 'github.io');
});

test('parser håndterer browser-tricks', () => {
  // Browsere læser \ som / – så værten er apple.com, ikke evil.com
  assert.equal(core.parseURL('https://apple.com\\@evil.com').host, 'apple.com');
  assert.equal(core.parseURL('HTTPS://WWW.DR.DK./nyheder').host, 'www.dr.dk');
  assert.equal(core.parseURL('www.dr.dk').scheme, 'https');
  assert.equal(core.parseURL('https://evil。com').host, 'evil.com');
  assert.equal(core.parseURL('https://x.dk:443/').port, null);
  assert.equal(core.parseURL('hej med dig'), null);
});

test('officielle domæner er ok', () => {
  for (const u of ['https://www.mitid.dk/', 'https://netbank.danskebank.dk/', 'https://www.borger.dk/',
    'https://www.google.de/', 'https://www.amazon.co.uk/', 'https://appleid.apple.com/', 'https://www.dr.dk/',
    'https://login.microsoftonline.com/', 'https://politiken.dk', 'https://norden.org', 'https://skatteguiden.dk']) {
    assert.equal(verdict(u), 'ok', u);
  }
});

test('efterligninger fanges', () => {
  for (const u of ['https://mitid-login.com', 'https://xn--80ak6aa92e.com', 'http://paypa1.com',
    'https://mitid.dk.sikker-login.xyz/', 'https://secure-paypal.github.io/', 'https://amazon-refund.co.uk/',
    'https://danskebank-dk.info', 'https://nordealogin.com', 'https://xn--pypal-4ve.com',
    'https://apple.com@evil.example.com/', 'http://3232235777/', 'javascript:alert(1)']) {
    assert.equal(verdict(u), 'danger', u);
  }
});

test('mistænkelige men ikke sikre', () => {
  for (const u of ['https://paypall.com', 'https://bit.ly/abc', 'http://example.com', 'https://shop.top',
    'https://user.github.io/paypal-login', 'https://example.com/r?url=https%3A%2F%2Fevil.top']) {
    assert.equal(verdict(u), 'caution', u);
  }
});

test('omslag pakkes ud', () => {
  const p = core.prepare('https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.dr.dk%2Fnyheder&data=x');
  assert.equal(p.target, 'https://www.dr.dk/nyheder');
  assert.equal(p.wrappers[0].via, 'Outlook Safe Links');
  assert.equal(core.prepare('https://www.google.com/url?q=https://dr.dk/&sa=D').target, 'https://dr.dk/');
  assert.equal(core.prepare('https://l.facebook.com/l.php?u=https%3A%2F%2Fdr.dk%2F').target, 'https://dr.dk/');
  assert.equal(core.prepare('https://urldefense.com/v3/__https://dr.dk/x__;!!abc').target, 'https://dr.dk/x');
});

test('forkortere og sporing markeres til netværkstjek', () => {
  assert.equal(core.prepare('https://bit.ly/x').shouldFollow, true);
  assert.equal(core.prepare('https://abc.us1.list-manage.com/track/click?u=1').shouldFollow, true);
  assert.equal(core.prepare('https://www.dr.dk/').shouldFollow, false);
});

test('resultat af omdirigering bruges', () => {
  const r = core.analyze('https://bit.ly/x', { redirectChain: ['https://bit.ly/x', 'https://mitid-dk.top/'], finalURL: 'https://mitid-dk.top/' });
  assert.equal(r.verdict, 'danger');
  assert.equal(r.registrableDomain, 'mitid-dk.top');
  const ok = core.analyze('https://bit.ly/x', { redirectChain: ['https://bit.ly/x', 'https://www.dr.dk/'], finalURL: 'https://www.dr.dk/' });
  assert.equal(ok.verdict, 'ok');
});

test('linktekst sammenlignes med destination', () => {
  assert.equal(verdict('https://evil.com/', { linkText: 'www.danskebank.dk' }), 'danger');
  assert.equal(verdict('https://www.danskebank.dk/privat', { linkText: 'danskebank.dk' }), 'ok');
  assert.equal(verdict('https://evil.com/', { linkText: 'Log ind med MitID' }), 'caution');
  assert.equal(verdict('https://www.mitid.dk/', { linkText: 'Log ind med MitID' }), 'ok');
  assert.equal(verdict('https://github.com/x', { linkText: 'README.md' }), 'ok');
  assert.equal(verdict('https://example.com/', { linkText: 'Hr.Hansen' }), 'ok');
  // Forkortet link der viser destinationen i teksten
  assert.equal(verdict('https://bit.ly/x', { linkText: 'dr.dk', redirectChain: ['https://bit.ly/x', 'https://www.dr.dk/'], finalURL: 'https://www.dr.dk/' }), 'ok');
});

test('domænealder', () => {
  assert.equal(verdict('https://helt-ny-butik.dk/', { domainAgeDays: 3 }), 'danger');
  assert.equal(verdict('https://helt-ny-butik.dk/', { domainAgeDays: 40 }), 'caution');
  assert.equal(verdict('https://helt-ny-butik.dk/', { domainAgeDays: 4000 }), 'ok');
  assert.ok(ids('https://helt-ny-butik.dk/', { domainAgeDays: 4000 }).includes('age'));
});

test('danske specialtegn er ikke farlige', () => {
  const r = core.analyze('https://xn--blbr-roah.dk');
  assert.equal(r.verdict, 'ok');
  assert.equal(r.displayHost, 'blåbær.dk');
});

test('falske bogstaver vises i teknisk form', () => {
  const r = core.analyze('https://xn--pypal-4ve.com/login');
  assert.equal(r.registrableDomain, 'xn--pypal-4ve.com');
  assert.equal(r.spoofed, true);
  assert.equal(core.analyze('https://xn--blbr-roah.dk').registrableDomain, 'blåbær.dk');
});

test('JSON-broen til Swift', () => {
  const out = JSON.parse(core.analyzeJSON('https://mitid-login.com', JSON.stringify({ linkText: 'MitID' })));
  assert.equal(out.verdict, 'danger');
  assert.equal(JSON.parse(core.prepareJSON('mailto:a@b.dk')).ok, false);
  // ugyldig JSON må ikke vælte noget
  assert.equal(JSON.parse(core.analyzeJSON('https://dr.dk', '{nope')).verdict, 'ok');
});
