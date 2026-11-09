/*
 * LinkTunnel – fælles analysemotor.
 *
 * Denne ene fil bruges tre steder:
 *   1. Safari-udvidelsens content script (lokal analyse med det samme ved klik)
 *   2. Swift-koden i appen, Del-menuen og Safari-udvidelsens native handler (via JavaScriptCore)
 *   3. Node-testene i tests/
 *
 * Filen må derfor IKKE bruge browser-API'er (URL, window, document) eller Node-API'er.
 * Den eksponerer et globalt objekt `LinkTunnelCore`.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  root.LinkTunnelCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  // Udsnit af Public Suffix List: endelser med flere niveauer, hvor
  // "registrerbart domæne" ellers ville blive beregnet forkert.
  var MULTI_SUFFIXES = [
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
    'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
    'co.nz', 'org.nz', 'govt.nz',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp',
    'com.br', 'net.br', 'org.br', 'gov.br',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn',
    'com.tr', 'com.mx', 'com.ar', 'com.co', 'com.sg', 'com.my', 'com.hk', 'com.tw',
    'co.za', 'co.in', 'co.kr', 'co.id', 'co.il', 'co.th',
    'com.pl', 'com.ua', 'com.ru', 'com.es', 'com.pt', 'com.gr',
    'gv.at', 'co.at', 'or.at'
  ];

  // Gratis hosting/platforme, hvor hvert underdomæne ejes af en ny person.
  // Behandles som "endelse", så fx evil.github.io bliver det registrerbare domæne.
  var HOSTING_SUFFIXES = [
    'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
    'netlify.app', 'vercel.app', 'herokuapp.com', 'onrender.com', 'fly.dev',
    'blogspot.com', 'wixsite.com', 'weebly.com', 'square.site', 'webflow.io',
    'glitch.me', 'replit.app', 'repl.co', 'azurewebsites.net', 'cloudfront.net',
    'appspot.com', 'ngrok.io', 'ngrok-free.app', 'ngrok.app', 'r2.dev',
    's3.amazonaws.com', 'framer.website', 'framer.app', 'carrd.co', 'godaddysites.com',
    'wordpress.com', 'myshopify.com', 'surge.sh', 'trycloudflare.com', 'ipfs.io',
    'dweb.link', 'web.core.windows.net', 'sharepoint.com', 'my.canva.site', 'canva.site'
  ];

  var SHORTENERS = [
    'bit.ly', 'bitly.com', 'bit.do', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd',
    'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 't.ly', 'rb.gy', 'tiny.cc', 'lnkd.in',
    's.id', 'bl.ink', 'qrco.de', 'x.co', 'adf.ly', 'shorte.st', 'urlz.fr', 'trib.al',
    'dlvr.it', 'fb.me', 'amzn.to', 'amzn.eu', 'youtu.be', 'tny.im', 'shorturl.com',
    'clck.ru', 'u.to', 'qr.net', 'surl.li', 'urlr.me', 'linkin.bio', 'spoti.fi',
    'apple.co', 'msft.it', 'aka.ms', '1url.dk', 'kortlink.dk', 'kortl.ink', 'href.li',
    'l.ead.me', 'did.li', 'hyperurl.co', 'short.gy', 'shrtco.de', 'gg.gg', 'cli.re'
  ];

  // Kendte klik-sporings-domæner (nyhedsbreve mv.), som må følges som standard.
  var TRACKER_SUFFIXES = [
    'list-manage.com', 'sendgrid.net', 'mandrillapp.com', 'mailchi.mp', 'hubspotlinks.com',
    'hs-sites.com', 'mlsend.com', 'mailerlite.com', 'rs6.net', 'exacttarget.com',
    'sfmc-content.com', 'klaviyo.com', 'cmail19.com', 'cmail20.com', 'createsend1.com',
    'mailjet.com', 'mjt.lu', 'awstrack.me', 'sparkpostmail.com', 'e.linkedin.com',
    'heyloyalty.com', 'peytz.dk', 'ubembed.com', 'elink.io', 'trk.klclick.com'
  ];

  var SUSPICIOUS_TLDS = [
    'zip', 'mov', 'xyz', 'top', 'click', 'country', 'gq', 'tk', 'ml', 'cf', 'ga', 'work',
    'support', 'rest', 'cam', 'buzz', 'icu', 'sbs', 'cfd', 'lol', 'quest', 'monster',
    'bond', 'cyou', 'mom', 'beauty', 'hair', 'skin', 'makeup', 'boats', 'autos', 'yachts',
    'motorcycles', 'pw', 'cc', 'su', 'ru', 'loan', 'win', 'bid', 'date', 'review', 'party',
    'science', 'stream', 'racing', 'download', 'accountant', 'faith', 'men', 'kim', 'gdn'
  ];

  // Ord, som phishere ofte sætter foran/efter et brand (paypal-login, secure-mitid).
  var BAIT_WORDS = [
    'login', 'logon', 'signin', 'secure', 'sikker', 'verify', 'verification', 'verificer',
    'bekraeft', 'bekraeftelse', 'confirm', 'account', 'accounts', 'konto', 'support', 'help',
    'hjaelp', 'service', 'kundeservice', 'update', 'opdater', 'opdatering', 'id', 'auth',
    'online', 'web', 'app', 'portal', 'dk', 'denmark', 'danmark', 'pay', 'payment',
    'betaling', 'refund', 'refusion', 'tilbagebetaling', 'billing', 'invoice', 'faktura',
    'track', 'tracking', 'levering', 'delivery', 'pakke', 'parcel', 'post', 'mail', 'official',
    'safe', 'security', 'check', 'unlock', 'reset', 'recovery', 'wallet', 'bonus', 'gift',
    'gave', 'vinder', 'winner', 'prize', 'customer', 'kunde', 'net', 'group', 'info', 'my',
    'mit', 'min', 'new', 'ny', 'nye', 'cloud', 'mobile', 'mobil', 'center', 'centre', 'team',
    'admin', 'notice', 'alert', 'claim', 'helpdesk', 'desk', 'store', 'shop', 'apps'
  ];

  // Brands, som ofte efterlignes – især i Danmark.
  //   keys:     ord der skal findes i domænenavnet
  //   domains:  officielle registrerbare domæner (underdomæner er også ok)
  //   textKeys: ord i linkteksten, der viser at linket "lover" at gå til brandet
  //   anyTld:   brandet ejer sit navn under mange landeendelser (google.de osv.)
  var BRANDS = [
    { name: 'MitID', keys: ['mitid'], domains: ['mitid.dk', 'mitid.dk'], textKeys: ['mitid'] },
    { name: 'NemID', keys: ['nemid'], domains: ['nemid.nu', 'mitid.dk'], textKeys: ['nemid'] },
    { name: 'borger.dk', keys: ['borgerdk'], domains: ['borger.dk', 'lifeindenmark.dk'], textKeys: ['borger.dk'] },
    { name: 'Skattestyrelsen', keys: ['skat', 'skattestyrelsen'], domains: ['skat.dk', 'sktst.dk', 'skattestyrelsen.dk'], textKeys: ['skattestyrelsen', 'skat.dk', 'tastselv', 'forskudsopgørelse', 'årsopgørelse'] },
    { name: 'e-Boks', keys: ['eboks'], domains: ['e-boks.dk', 'e-boks.com', 'e-boks.no', 'e-boks.se'], textKeys: ['e-boks', 'eboks'] },
    { name: 'Digital Post', keys: ['digitalpost', 'mitdk'], domains: ['digitalpost.dk', 'mit.dk', 'borger.dk'], textKeys: ['digital post', 'mit.dk'] },
    { name: 'sundhed.dk', keys: ['sundhed', 'sundheddk'], domains: ['sundhed.dk'], textKeys: ['sundhed.dk'] },
    { name: 'Politiet', keys: ['politi', 'politiet'], domains: ['politi.dk'], textKeys: ['politiet', 'politi.dk'] },
    { name: 'Udbetaling Danmark', keys: ['udbetalingdanmark', 'udbetaling'], domains: ['borger.dk', 'atp.dk', 'lifeindenmark.dk'], textKeys: ['udbetaling danmark'] },
    { name: 'Danske Bank', keys: ['danskebank'], domains: ['danskebank.dk', 'danskebank.com', 'danskebank.se', 'danskebank.no', 'danskebank.fi'], textKeys: ['danske bank'] },
    { name: 'Nordea', keys: ['nordea'], domains: ['nordea.dk', 'nordea.com', 'nordea.se', 'nordea.no', 'nordea.fi'], textKeys: ['nordea'] },
    { name: 'Jyske Bank', keys: ['jyskebank'], domains: ['jyskebank.dk', 'jyskebank.com'], textKeys: ['jyske bank'] },
    { name: 'Sydbank', keys: ['sydbank'], domains: ['sydbank.dk', 'sydbank.com'], textKeys: ['sydbank'] },
    { name: 'Nykredit', keys: ['nykredit'], domains: ['nykredit.dk', 'nykredit.com'], textKeys: ['nykredit'] },
    { name: 'Spar Nord', keys: ['sparnord'], domains: ['sparnord.dk'], textKeys: ['spar nord'] },
    { name: 'Arbejdernes Landsbank', keys: ['albank', 'arbejderneslandsbank'], domains: ['al-bank.dk'], textKeys: ['arbejdernes landsbank'] },
    { name: 'Lunar', keys: ['lunarbank'], domains: ['lunar.app'], textKeys: ['lunar bank'] },
    { name: 'MobilePay', keys: ['mobilepay', 'vipps'], domains: ['mobilepay.dk', 'mobilepay.fi', 'vippsmobilepay.com', 'vipps.no'], textKeys: ['mobilepay', 'vipps'] },
    { name: 'Dankort', keys: ['dankort'], domains: ['dankort.dk', 'nets.eu'], textKeys: ['dankort'] },
    { name: 'Visa', keys: ['visa'], domains: ['visa.com', 'visa.dk', 'visaeurope.com'], textKeys: [] },
    { name: 'Mastercard', keys: ['mastercard'], domains: ['mastercard.com', 'mastercard.dk', 'mastercard.us'], textKeys: ['mastercard'] },
    { name: 'PostNord', keys: ['postnord'], domains: ['postnord.dk', 'postnord.com', 'postnord.se', 'postnord.no', 'postnord.fi'], textKeys: ['postnord'] },
    { name: 'GLS', keys: ['gls'], domains: ['gls-group.eu', 'gls-group.com', 'gls.dk', 'gls-pakkeshop.dk'], textKeys: [] },
    { name: 'DAO', keys: ['dao', 'daodk'], domains: ['dao.as', 'dao.dk'], textKeys: [] },
    { name: 'Bring', keys: ['bring'], domains: ['bring.dk', 'bring.com', 'bring.no', 'bring.se'], textKeys: [] },
    { name: 'DHL', keys: ['dhl'], domains: ['dhl.com', 'dhl.dk', 'dhl.de', 'dhl.se', 'dhlparcel.nl'], textKeys: [] },
    { name: 'UPS', keys: ['ups'], domains: ['ups.com'], textKeys: [] },
    { name: 'FedEx', keys: ['fedex'], domains: ['fedex.com'], textKeys: ['fedex'] },
    { name: 'Apple', keys: ['apple', 'icloud', 'appleid'], domains: ['apple.com', 'icloud.com', 'me.com', 'apple.co', 'mzstatic.com', 'apple.news'], textKeys: ['apple id', 'icloud', 'apple-id'] },
    { name: 'Google', keys: ['google', 'gmail'], domains: ['google.com', 'gmail.com', 'youtube.com', 'googleusercontent.com', 'googleapis.com', 'gstatic.com', 'googlevideo.com', 'withgoogle.com', 'goo.gl', 'g.co', 'blogger.com', 'googlemail.com'], textKeys: ['gmail', 'google-konto', 'google account'], anyTld: true },
    { name: 'Microsoft', keys: ['microsoft', 'outlook', 'office365', 'onedrive', 'hotmail', 'msonline'], domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'office.net', 'microsoftonline.com', 'office365.com', 'sharepoint.com', 'onedrive.com', 'hotmail.com', 'msn.com', 'aka.ms', 'windows.net', 'azure.com', 'microsoft365.com', 'cloud.microsoft', 'msauth.net', 'msftauth.net'], textKeys: ['microsoft', 'outlook', 'office 365', 'onedrive', 'hotmail'] },
    { name: 'PayPal', keys: ['paypal'], domains: ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal.dk'], textKeys: ['paypal'] },
    { name: 'Amazon', keys: ['amazon', 'amzn'], domains: ['amazon.com', 'amazon.co.uk', 'amzn.to', 'amzn.eu', 'amazonaws.com', 'media-amazon.com', 'primevideo.com'], textKeys: ['amazon'], anyTld: true },
    { name: 'Netflix', keys: ['netflix'], domains: ['netflix.com', 'nflxext.com', 'nflximg.net'], textKeys: ['netflix'] },
    { name: 'Facebook', keys: ['facebook', 'fb'], domains: ['facebook.com', 'fb.com', 'fb.me', 'meta.com', 'messenger.com', 'fbcdn.net', 'facebook.net'], textKeys: ['facebook'] },
    { name: 'Instagram', keys: ['instagram'], domains: ['instagram.com', 'cdninstagram.com', 'meta.com'], textKeys: ['instagram'] },
    { name: 'WhatsApp', keys: ['whatsapp'], domains: ['whatsapp.com', 'whatsapp.net', 'wa.me'], textKeys: ['whatsapp'] },
    { name: 'Spotify', keys: ['spotify'], domains: ['spotify.com', 'spoti.fi', 'scdn.co'], textKeys: ['spotify'] },
    { name: 'Steam', keys: ['steam', 'steamcommunity', 'steampowered'], domains: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com'], textKeys: ['steam'] },
    { name: 'Coinbase', keys: ['coinbase'], domains: ['coinbase.com'], textKeys: ['coinbase'] },
    { name: 'Binance', keys: ['binance'], domains: ['binance.com'], textKeys: ['binance'] },
    { name: 'DSB', keys: ['dsb'], domains: ['dsb.dk'], textKeys: [] },
    { name: 'Rejsekort', keys: ['rejsekort'], domains: ['rejsekort.dk'], textKeys: ['rejsekort'] },
    { name: 'Norlys', keys: ['norlys'], domains: ['norlys.dk'], textKeys: ['norlys'] },
    { name: 'Ørsted', keys: ['orsted', 'oersted'], domains: ['orsted.dk', 'orsted.com'], textKeys: ['ørsted'] },
    { name: 'TDC / Nuuday', keys: ['tdc', 'yousee', 'nuuday'], domains: ['tdc.dk', 'yousee.dk', 'nuuday.dk', 'tdcnet.dk'], textKeys: ['yousee'] },
    { name: 'Telenor', keys: ['telenor'], domains: ['telenor.dk', 'telenor.com'], textKeys: ['telenor'] },
    { name: 'Telia', keys: ['telia'], domains: ['telia.dk', 'telia.com'], textKeys: ['telia'] },
    { name: '3', keys: ['3dk'], domains: ['3.dk'], textKeys: [] }
  ];

  // Tegn, der ligner hinanden. Begge sider af en sammenligning "skelet-normaliseres".
  var CONFUSABLES = {
    // kyrillisk
    'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'з': '3', 'і': 'l', 'ї': 'l', 'ј': 'j', 'к': 'k',
    'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
    'ѕ': 's', 'һ': 'h', 'ӏ': 'l', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ъ': 'b', 'ь': 'b', 'п': 'n',
    'г': 'r', 'ɡ': 'g', 'ү': 'y', 'ҝ': 'k', 'ԍ': 'g', 'ԃ': 'd',
    // græsk
    'α': 'a', 'β': 'b', 'γ': 'y', 'ε': 'e', 'ι': 'l', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p',
    'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w', 'η': 'n', 'μ': 'u',
    // latinske varianter
    'ı': 'l', 'ł': 'l', 'ɩ': 'l', 'ǀ': 'l', 'ƚ': 'l', 'ȷ': 'j', 'ʀ': 'r', 'ɑ': 'a', 'ɐ': 'a',
    'ß': 'b', 'ð': 'd', 'đ': 'd', 'ħ': 'h', 'ŧ': 't', 'ƅ': 'b', 'ɢ': 'g', 'ʏ': 'y',
    // cifre og ascii
    '0': 'o', '1': 'l', 'i': 'l', '|': 'l', '3': 'e', '5': 's', '$': 's', '@': 'a'
  };

  // Endelser vi stoler på, når en linktekst "ligner" en adresse.
  var TEXT_TLDS = ['com', 'net', 'org', 'info', 'biz', 'io', 'app', 'dev', 'online', 'site', 'shop',
    'store', 'tech', 'me', 'co', 'ai', 'gov', 'edu', 'eu', 'nu', 'xyz', 'top', 'live', 'cloud',
    'digital', 'email', 'link', 'click', 'page', 'website', 'services', 'support', 'help', 'zip', 'mov'];
  var FILE_EXTS = ['md', 'js', 'py', 'sh', 'ts', 'rb', 'cs', 'kt', 'gz', 'db', 'ps', 'mm'];

  var DEFAULT_PORTS = { http: '80', https: '443' };

  // ---------------------------------------------------------------------------
  // Hjælpere
  // ---------------------------------------------------------------------------

  function arrayIncludes(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true;
    return false;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function endsWithDomain(host, domain) {
    return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
  }

  function matchesAnySuffix(host, list) {
    for (var i = 0; i < list.length; i++) if (endsWithDomain(host, list[i])) return list[i];
    return null;
  }

  // ---------------------------------------------------------------------------
  // Punycode (RFC 3492)
  // ---------------------------------------------------------------------------

  var BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;

  function adapt(delta, numPoints, firstTime) {
    var k = 0;
    delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) {
      delta = Math.floor(delta / (BASE - TMIN));
    }
    return Math.floor(k + (BASE - TMIN + 1) * delta / (delta + SKEW));
  }

  function basicToDigit(cp) {
    if (cp >= 0x30 && cp < 0x3A) return 26 + (cp - 0x30);
    if (cp >= 0x41 && cp < 0x5B) return cp - 0x41;
    if (cp >= 0x61 && cp < 0x7B) return cp - 0x61;
    return BASE;
  }

  function digitToBasic(d) {
    return d + 22 + 75 * (d < 26 ? 1 : 0);
  }

  function punyDecodeLabel(input) {
    var output = [];
    var i = 0, n = INITIAL_N, bias = INITIAL_BIAS;
    var basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (var j = 0; j < basic; ++j) output.push(input.charCodeAt(j));
    for (var index = basic > 0 ? basic + 1 : 0; index < input.length;) {
      var oldi = i;
      for (var w = 1, k = BASE; ; k += BASE) {
        if (index >= input.length) throw new Error('punycode');
        var digit = basicToDigit(input.charCodeAt(index++));
        if (digit >= BASE) throw new Error('punycode');
        i += digit * w;
        var t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
        if (digit < t) break;
        w *= BASE - t;
      }
      var out = output.length + 1;
      bias = adapt(i - oldi, out, oldi === 0);
      n += Math.floor(i / out);
      i %= out;
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint.apply(String, output);
  }

  function punyEncodeLabel(input) {
    var cps = Array.from(input).map(function (c) { return c.codePointAt(0); });
    var output = [];
    var n = INITIAL_N, delta = 0, bias = INITIAL_BIAS;
    cps.forEach(function (c) { if (c < 0x80) output.push(String.fromCharCode(c)); });
    var basicLength = output.length, handled = basicLength;
    if (basicLength) output.push('-');
    while (handled < cps.length) {
      var m = Infinity;
      cps.forEach(function (c) { if (c >= n && c < m) m = c; });
      delta += (m - n) * (handled + 1);
      n = m;
      for (var x = 0; x < cps.length; x++) {
        var c = cps[x];
        if (c < n) delta++;
        if (c === n) {
          var q = delta;
          for (var k = BASE; ; k += BASE) {
            var t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
            if (q < t) break;
            output.push(String.fromCharCode(digitToBasic(t + (q - t) % (BASE - t))));
            q = Math.floor((q - t) / (BASE - t));
          }
          output.push(String.fromCharCode(digitToBasic(q)));
          bias = adapt(delta, handled + 1, handled === basicLength);
          delta = 0;
          handled++;
        }
      }
      delta++;
      n++;
    }
    return output.join('');
  }

  function hostToUnicode(host) {
    return host.split('.').map(function (label) {
      if (label.slice(0, 4) === 'xn--') {
        try { return punyDecodeLabel(label.slice(4)).toLowerCase(); } catch (e) { return label; }
      }
      return label;
    }).join('.');
  }

  function hostToASCII(host) {
    return host.split('.').map(function (label) {
      return /[^\x00-\x7f]/.test(label) ? 'xn--' + punyEncodeLabel(label.toLowerCase()) : label;
    }).join('.');
  }

  // ---------------------------------------------------------------------------
  // URL-parser (WHATWG-lignende, kun det vi har brug for)
  // ---------------------------------------------------------------------------

  function parseURL(raw) {
    var s = String(raw == null ? '' : raw).trim();
    s = s.replace(/^[<"'(\[]+/, '').replace(/[>"')\].,;]+$/, '');
    if (!s) return null;

    if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) {
      // "www.eksempel.dk/sti" uden skema
      if (/^[^\s\/:@]+\.[a-z¡-￿]{2,}(?:[:\/?#]|$)/i.test(s)) s = 'https://' + s;
      else return null;
    }

    var scheme = s.slice(0, s.indexOf(':')).toLowerCase();
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ftp' && scheme !== 'ws' && scheme !== 'wss') {
      return { href: s, scheme: scheme, special: true, host: '', unicodeHost: '', asciiHost: '' };
    }

    // Som browsere: backslash = slash, tab/linjeskift fjernes.
    s = s.replace(/[\t\n\r]/g, '');
    var rest = s.slice(scheme.length + 1).replace(/\\/g, '/').replace(/^\/*/, '');
    var m = rest.match(/^([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!m) return null;

    var authority = m[1];
    var userinfo = null;
    var at = authority.lastIndexOf('@');
    if (at >= 0) {
      userinfo = authority.slice(0, at);
      authority = authority.slice(at + 1);
    }

    var host, port = null;
    if (authority.charAt(0) === '[') {
      var end = authority.indexOf(']');
      host = authority.slice(0, end + 1);
      var after = authority.slice(end + 1);
      if (after.charAt(0) === ':') port = after.slice(1);
    } else {
      var colon = authority.lastIndexOf(':');
      if (colon >= 0) { host = authority.slice(0, colon); port = authority.slice(colon + 1); }
      else host = authority;
    }

    host = safeDecode(host)
      .replace(/[。．｡]/g, '.') // "fuld-bredde" punktummer
      .toLowerCase()
      .replace(/\.+$/, '');
    if (port === '' || port === DEFAULT_PORTS[scheme]) port = null;
    if (!host) return null;

    var unicodeHost = hostToUnicode(host);
    var asciiHost;
    try { asciiHost = hostToASCII(unicodeHost); } catch (e) { asciiHost = host; }

    var path = m[2] || '/';
    var query = m[3] ? m[3].slice(1) : '';
    var fragment = m[4] ? m[4].slice(1) : '';

    var tail = (port ? ':' + port : '') + path + (query ? '?' + query : '') + (fragment ? '#' + fragment : '');
    var auth = scheme + '://' + (userinfo !== null ? userinfo + '@' : '');
    return {
      href: auth + host + tail,
      hrefASCII: auth + asciiHost + tail,
      scheme: scheme,
      special: false,
      userinfo: userinfo,
      host: host,
      unicodeHost: unicodeHost,
      asciiHost: asciiHost,
      port: port,
      path: path,
      query: query,
      fragment: fragment
    };
  }

  function queryParams(query) {
    var out = {};
    if (!query) return out;
    query.split('&').forEach(function (pair) {
      if (!pair) return;
      var eq = pair.indexOf('=');
      var k = eq >= 0 ? pair.slice(0, eq) : pair;
      var v = eq >= 0 ? pair.slice(eq + 1) : '';
      k = safeDecode(k.replace(/\+/g, ' ')).toLowerCase();
      v = safeDecode(v.replace(/\+/g, ' '));
      if (!(k in out)) out[k] = v;
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Domæner
  // ---------------------------------------------------------------------------

  function isIPv4(host) {
    return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host);
  }

  // http://3232235777, http://0xC0A80001, http://0300.0250.0.1 osv.
  function isObfuscatedIP(host) {
    if (/^\d{4,}$/.test(host)) return true;
    if (/^0x[0-9a-f]+$/i.test(host)) return true;
    var parts = host.split('.');
    if (parts.length >= 2 && parts.length <= 4 && parts.every(function (p) { return /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(p); })) {
      return !isIPv4(host) || parts.some(function (p) { return /^0[0-9x]/i.test(p) && p.length > 1; });
    }
    return false;
  }

  function isIP(host) {
    return isIPv4(host) || host.charAt(0) === '[' || isObfuscatedIP(host);
  }

  // Returnerer { suffix, registrable, sub, label, hosting }
  function splitDomain(host) {
    if (!host || isIP(host)) return { suffix: '', registrable: host, sub: '', label: host, hosting: null };
    var labels = host.split('.');
    if (labels.length === 1) return { suffix: '', registrable: host, sub: '', label: host, hosting: null };

    var hosting = matchesAnySuffix(host, HOSTING_SUFFIXES);
    var suffix = hosting;
    if (!suffix || suffix === host) {
      if (suffix === host) hosting = null; // fx github.io selv
      suffix = null;
      for (var i = 0; i < MULTI_SUFFIXES.length; i++) {
        if (endsWithDomain(host, MULTI_SUFFIXES[i]) && host !== MULTI_SUFFIXES[i]) { suffix = MULTI_SUFFIXES[i]; break; }
      }
      if (!suffix) suffix = labels[labels.length - 1];
    }
    var suffixLabels = suffix.split('.').length;
    if (labels.length <= suffixLabels) return { suffix: suffix, registrable: host, sub: '', label: host, hosting: hosting };
    var regLabels = labels.slice(labels.length - suffixLabels - 1);
    return {
      suffix: suffix,
      registrable: regLabels.join('.'),
      sub: labels.slice(0, labels.length - suffixLabels - 1).join('.'),
      label: regLabels[0],
      hosting: hosting
    };
  }

  function registrableDomain(host) {
    return splitDomain(host).registrable;
  }

  // ---------------------------------------------------------------------------
  // Ligheds-tjek
  // ---------------------------------------------------------------------------

  function stripMarks(s) {
    try { return s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { return s; }
  }

  function skeleton(s) {
    var out = '';
    var chars = Array.from(stripMarks(String(s).toLowerCase()));
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      out += CONFUSABLES.hasOwnProperty(c) ? CONFUSABLES[c] : c;
    }
    return out.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd').replace(/[\-_.]/g, '');
  }

  function scriptOf(ch) {
    var cp = ch.codePointAt(0);
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff)) return 'latin';
    if (cp >= 0x400 && cp <= 0x52f) return 'cyrillic';
    if (cp >= 0x370 && cp <= 0x3ff) return 'greek';
    if (cp >= 0x530 && cp <= 0x58f) return 'armenian';
    if (cp >= 0x13a0 && cp <= 0x13ff) return 'cherokee';
    if ((cp >= 0x30 && cp <= 0x39) || ch === '-' || ch === '_') return 'common';
    if (cp >= 0x250 && cp <= 0x2af) return 'latin'; // IPA-udvidelser (ɑ, ɡ …)
    return 'other';
  }

  function scriptsIn(label) {
    var set = {};
    Array.from(label).forEach(function (c) {
      var sc = scriptOf(c);
      if (sc !== 'common') set[sc] = true;
    });
    return Object.keys(set);
  }

  // Damerau-Levenshtein (optimal string alignment)
  function editDistance(a, b) {
    var al = a.length, bl = b.length;
    if (Math.abs(al - bl) > 2) return 99;
    var d = [];
    for (var i = 0; i <= al; i++) { d[i] = [i]; }
    for (var j = 0; j <= bl; j++) { d[0][j] = j; }
    for (i = 1; i <= al; i++) {
      for (j = 1; j <= bl; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[al][bl];
  }

  function isOfficial(brand, host) {
    var reg = registrableDomain(host);
    for (var i = 0; i < brand.domains.length; i++) {
      if (endsWithDomain(host, brand.domains[i]) || reg === brand.domains[i]) return true;
    }
    if (brand.anyTld) {
      var sd = splitDomain(host);
      if (!sd.hosting && arrayIncludes(brand.keys, sd.label)) return true;
    }
    return false;
  }

  function officialBrandFor(host) {
    for (var i = 0; i < BRANDS.length; i++) if (isOfficial(BRANDS[i], host)) return BRANDS[i];
    return null;
  }

  // Hvordan nævner en etiket (fx "secure-mitid-login") et brand-nøgleord?
  //   'exact'   : etiketten ER nøgleordet (evt. med bindestreger fjernet)
  //   'homoglyph': etiketten ligner nøgleordet med forvekslelige tegn
  //   'bait'    : nøgleordet + lokkeord (mitid-login, securepaypal)
  //   'typo'    : stavet næsten ens (paypall, nordeaa)
  function brandMention(label, key) {
    var plain = label.replace(/[\-_]/g, '');
    if (plain === key) return 'exact';
    var skLabel = skeleton(label), skKey = skeleton(key);
    if (skLabel === skKey) return 'homoglyph';

    var tokens = label.split(/[\-_]+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === key || skeleton(t) === skKey) return tokens.length > 1 ? 'bait' : 'exact';
      // nøgleord limet sammen med lokkeord: securepaypal, mitidlogin, danskebankdk
      if (key.length >= 3 && t.length > key.length) {
        var idx = t.indexOf(key);
        if (idx === 0 && arrayIncludes(BAIT_WORDS, t.slice(key.length))) return 'bait';
        if (idx > 0 && idx + key.length === t.length && arrayIncludes(BAIT_WORDS, t.slice(0, idx))) return 'bait';
      }
    }
    if (tokens.length > 1) {
      for (i = 0; i < tokens.length; i++) {
        if (key.length >= 5 && editDistance(skeleton(tokens[i]), skKey) === 1) return 'typo';
      }
    }
    if (key.length >= 6) {
      var dist = editDistance(skLabel, skKey);
      // Ved 6 tegn kun ekstra/manglende bogstav (paypall), ellers rammer vi fx norden/nordea.
      if (dist === 1 && (key.length >= 7 || skLabel.length !== skKey.length)) return 'typo';
      if (dist === 2 && key.length >= 10) return 'typo';
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Omslag (Outlook Safe Links, Google-omdirigering osv.)
  // ---------------------------------------------------------------------------

  function looksLikeWebURL(s) {
    return /^(https?:)?\/\//i.test(s) || /^https?%3a/i.test(s);
  }

  function unwrapOnce(p) {
    if (!p || p.special) return null;
    var host = p.host;
    var q = queryParams(p.query);
    var pick = function (names) {
      for (var i = 0; i < names.length; i++) {
        var v = q[names[i]];
        if (v && looksLikeWebURL(v)) return /^https?%3a/i.test(v) ? safeDecode(v) : (v.indexOf('//') === 0 ? 'https:' + v : v);
      }
      return null;
    };

    if (endsWithDomain(host, 'safelinks.protection.outlook.com')) return { url: pick(['url']), via: 'Outlook Safe Links' };
    if (/^(www\.)?google\.[a-z.]+$/.test(host) && p.path === '/url') return { url: pick(['q', 'url']), via: 'Google' };
    if (/^(l|lm)\.facebook\.com$/.test(host) || host === 'l.messenger.com') return { url: pick(['u']), via: 'Facebook' };
    if (host === 'l.instagram.com') return { url: pick(['u']), via: 'Instagram' };
    if (endsWithDomain(host, 'youtube.com') && p.path === '/redirect') return { url: pick(['q']), via: 'YouTube' };
    if (host === 'slack-redir.net') return { url: pick(['url']), via: 'Slack' };
    if (endsWithDomain(host, 'linkedin.com') && /^\/(redir|redirect)/.test(p.path)) return { url: pick(['url']), via: 'LinkedIn' };
    if (host === 'steamcommunity.com' && /^\/linkfilter/.test(p.path)) return { url: pick(['url', 'u']), via: 'Steam' };
    if (host === 'href.li') return { url: p.query ? safeDecode(p.query) : null, via: 'href.li' };
    if (endsWithDomain(host, 'urldefense.com')) {
      var v3 = p.href.match(/\/v3\/__(.+?)__;/);
      if (v3) return { url: v3[1], via: 'Proofpoint' };
    }
    if (endsWithDomain(host, 'urldefense.proofpoint.com')) {
      var u = q.u;
      if (u) return { url: u.replace(/-/g, '%').replace(/_/g, '/').replace(/%([0-9a-f]{2})/gi, function (m0, h) { return String.fromCharCode(parseInt(h, 16)); }), via: 'Proofpoint' };
    }
    return null;
  }

  // Finder en fuld adresse gemt i et query-parameter (åben omdirigering / klik-sporing).
  function embeddedURL(p) {
    if (!p || p.special) return null;
    var q = queryParams(p.query);
    var names = ['url', 'u', 'redirect', 'redirect_url', 'redirect_uri', 'redir', 'dest', 'destination', 'target', 'to', 'goto', 'next', 'link', 'out', 'continue', 'return', 'returnurl'];
    for (var i = 0; i < names.length; i++) {
      var v = q[names[i]];
      if (v && /^https?:\/\//i.test(v)) {
        var inner = parseURL(v);
        if (inner && !inner.special && registrableDomain(inner.host) !== registrableDomain(p.host)) return { param: names[i], url: inner.href };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Offentlige funktioner
  // ---------------------------------------------------------------------------

  /**
   * Hurtig forberedelse: normaliserer, pakker omslag ud og fortæller, om
   * adressen bør følges over netværket for at finde den endelige destination.
   */
  function prepare(rawURL) {
    var p = parseURL(rawURL);
    if (!p) return { ok: false, reason: 'invalid' };
    if (p.special) return { ok: false, reason: 'not-web', scheme: p.scheme, url: p.href };

    var wrappers = [];
    var current = p;
    for (var i = 0; i < 4; i++) {
      var w = unwrapOnce(current);
      if (!w || !w.url) break;
      var inner = parseURL(w.url);
      if (!inner || inner.special) break;
      wrappers.push({ via: w.via, from: current.href, to: inner.href });
      current = inner;
    }

    var shortener = matchesAnySuffix(current.host, SHORTENERS);
    var tracker = matchesAnySuffix(current.host, TRACKER_SUFFIXES);
    return {
      ok: true,
      url: p.href,
      target: current.href,
      targetASCII: current.hrefASCII,
      host: current.host,
      isIP: isIP(current.host),
      asciiRegistrableDomain: registrableDomain(current.asciiHost),
      unicodeHost: current.unicodeHost,
      registrableDomain: registrableDomain(current.host),
      wrappers: wrappers,
      isShortener: !!shortener,
      isTracker: !!tracker,
      shouldFollow: !!(shortener || tracker)
    };
  }

  function finding(list, id, level, title, detail) {
    var base = id, n = 2;
    while (list.some(function (f) { return f.id === id; })) id = base + '-' + (n++);
    list.push({ id: id, level: level, title: title, detail: detail || '' });
  }

  function hostFindings(p, list, prefix) {
    var host = p.host;
    var sd = splitDomain(host);
    var uni = p.unicodeHost;
    var official = officialBrandFor(host);
    prefix = prefix || '';

    if (p.userinfo !== null && p.userinfo !== undefined) {
      var decoy = safeDecode(p.userinfo);
      var looksLikeHost = /[a-z0-9-]+\.[a-z]{2,}/i.test(decoy);
      finding(list, prefix + 'userinfo', looksLikeHost ? 'danger' : 'warning',
        'Adressen indeholder et "@"',
        'Alt før "@" (' + decoy + ') er pynt. Linket går i virkeligheden til ' + uni + '.');
    }

    if (isObfuscatedIP(host)) {
      finding(list, prefix + 'ip-obfuscated', 'danger', 'Skjult IP-adresse',
        'Destinationen er en IP-adresse skrevet på en usædvanlig måde (' + host + '). Det bruges næsten kun til at skjule, hvor linket går hen.');
    } else if (isIP(host)) {
      finding(list, prefix + 'ip', 'warning', 'Går direkte til en IP-adresse',
        'Rigtige virksomheder bruger næsten altid et domænenavn i stedet for et tal som ' + host + '.');
    }

    if (p.scheme === 'http') {
      finding(list, prefix + 'http', 'warning', 'Ukrypteret forbindelse',
        'Siden bruger http i stedet for https. Det du skriver, kan læses af andre på netværket.');
    }

    if (p.port) {
      finding(list, prefix + 'port', 'info', 'Usædvanlig port', 'Linket bruger port ' + p.port + '.');
    }

    if (isIP(host)) return official;

    // IDN / punycode / blandede skrifttyper
    var labels = uni.split('.');
    var mixed = false;
    labels.forEach(function (label) {
      var scripts = scriptsIn(label);
      if (scripts.length > 1) {
        mixed = true;
        finding(list, prefix + 'mixed-script', 'danger', 'Blandede alfabeter i domænet',
          '"' + label + '" blander bogstaver fra ' + scripts.join(' og ').replace('latin', 'latinsk').replace('cyrillic', 'kyrillisk').replace('greek', 'græsk') + ' alfabet. Det er et klassisk trick til at efterligne et kendt navn.');
      } else if (scripts.length === 1 && scripts[0] !== 'latin' && scripts[0] !== 'other') {
        var sk = skeleton(label);
        if (/^[a-z0-9]+$/.test(sk)) {
          mixed = true;
          finding(list, prefix + 'whole-script', 'danger', 'Falske bogstaver i domænet',
            '"' + label + '" er skrevet med ikke-latinske bogstaver, der ligner "' + sk + '".');
        }
      }
    });
    if (!mixed && uni !== p.asciiHost) {
      finding(list, prefix + 'idn', 'info', 'Domænet indeholder specialtegn',
        'Vises som ' + uni + ', men hedder teknisk ' + p.asciiHost + '.');
    }

    // Efterligning af kendte brands
    if (!official) {
      var regLabel = hostToUnicode(sd.label);
      var subLabels = sd.sub ? hostToUnicode(sd.sub).split('.') : [];
      var reported = {};
      BRANDS.forEach(function (brand) {
        if (reported[brand.name]) return;
        var best = null;
        brand.keys.forEach(function (key) {
          var kind = brandMention(regLabel, key);
          if (kind && (!best || rank(kind) > rank(best.kind))) best = { kind: kind, where: 'domain' };
          subLabels.forEach(function (lab) {
            if (key.length < 4) return; // ups/dhl/fb som underdomæne er for tvetydigt
            var k2 = brandMention(lab, key);
            if (k2 && k2 !== 'typo' && (!best || rank(k2) > rank(best.kind))) best = { kind: k2, where: 'sub' };
          });
        });
        if (!best) return;
        // Korte nøgleord (ups, dhl, gls, dao, fb, visa …) kun ved eksakt/lokkeord-match
        reported[brand.name] = true;
        var owner = sd.registrable;
        if (best.where === 'sub') {
          finding(list, prefix + 'brand-sub', 'danger', 'Udgiver sig for at være ' + brand.name,
            'Domænet starter med "' + brand.name + '", men ejes af ' + owner + ' – ikke af ' + brand.name + '.');
        } else if (best.kind === 'homoglyph') {
          finding(list, prefix + 'brand-homoglyph', 'danger', 'Efterligner ' + brand.name,
            owner + ' er stavet med tegn, der ligner ' + brand.name + ' – men det er ikke ' + brand.name + '.');
        } else if (best.kind === 'exact') {
          finding(list, prefix + 'brand-tld', 'warning', 'Ligner ' + brand.name + ', men med en anden endelse',
            owner + ' er ikke et af ' + brand.name + 's kendte domæner (' + brand.domains.slice(0, 2).join(', ') + ').');
        } else if (best.kind === 'bait') {
          finding(list, prefix + 'brand-bait', 'danger', 'Udgiver sig for at være ' + brand.name,
            owner + ' bruger navnet ' + brand.name + ', men tilhører ikke ' + brand.name + '.');
        } else if (best.kind === 'typo') {
          finding(list, prefix + 'brand-typo', 'warning', 'Stavet næsten som ' + brand.name,
            owner + ' minder om ' + brand.name + ', men er stavet anderledes.');
        }
      });

      // Brandnavn i stien på en fremmed side: evil.github.io/paypal-login
      if (!Object.keys(reported).length && p.path) {
        var pathLower = safeDecode(p.path).toLowerCase();
        for (var b = 0; b < BRANDS.length; b++) {
          var hit = BRANDS[b].keys.filter(function (k) { return k.length >= 5 && pathLower.indexOf(k) >= 0; })[0];
          if (hit) {
            finding(list, prefix + 'brand-path', 'warning', 'Nævner ' + BRANDS[b].name + ' på en fremmed side',
              'Adressen indeholder "' + hit + '", men siden ligger på ' + sd.registrable + '.');
            break;
          }
        }
      }

      // Et andet "ægte" domæne gemt i underdomænet: mitid.dk.login-sikker.com
      if (sd.sub && !list.some(function (f) { return f.id === prefix + 'brand-sub'; })) {
        var subDomainLike = hostToUnicode(sd.sub).match(/(^|\.)([a-z0-9\-]+\.(dk|com|net|org|se|no|de|eu|uk|gov|nu|io|app))(\.|$)/i);
        if (subDomainLike) {
          finding(list, prefix + 'sub-domainlike', 'warning', 'Domænet starter med et andet domæne',
            'Adressen starter med "' + subDomainLike[2] + '", men den egentlige ejer er ' + sd.registrable + '.');
        }
      }
    }

    // Endelse
    var tld = host.split('.').pop();
    if (!official && arrayIncludes(SUSPICIOUS_TLDS, tld)) {
      finding(list, prefix + 'tld', 'warning', 'Endelse der ofte bruges til svindel',
        '.' + tld + ' er billig og bruges uforholdsmæssigt ofte til phishing.');
    }

    if (sd.hosting && !official) {
      finding(list, prefix + 'hosting', 'info', 'Gratis hjemmeside-tjeneste',
        'Siden ligger på ' + sd.hosting + ', hvor alle kan oprette en side på få minutter.');
    }

    var depth = sd.sub ? sd.sub.split('.').length : 0;
    if (depth >= 4 || host.length > 60) {
      finding(list, prefix + 'long-host', 'info', 'Usædvanligt langt domæne',
        'Lange domæner bruges ofte til at skubbe den rigtige ejer ud af syne på en lille skærm.');
    }

    var hyphenCount = (hostToUnicode(sd.label).match(/-/g) || []).length;
    if (hyphenCount >= 3 && !official) {
      finding(list, prefix + 'hyphens', 'info', 'Mange bindestreger', sd.registrable + ' indeholder mange bindestreger.');
    }

    return official;
  }

  function rank(kind) {
    return { typo: 1, exact: 2, bait: 3, homoglyph: 4 }[kind] || 0;
  }

  function linkTextFindings(text, p, first, list) {
    if (!text) return;
    var t = String(text).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 300) return;
    var targetReg = registrableDomain(p.host);
    var firstReg = first ? registrableDomain(first.host) : targetReg;

    var m = t.match(/(?:https?:\/\/)?((?:[a-z0-9¡-￿](?:[a-z0-9¡-￿\-]*[a-z0-9¡-￿])?\.)+[a-z¡-￿]{2,})(?=[\/:?#\s]|$)/i);
    if (m) {
      var shown = parseURL(m[0]);
      var shownTld = shown && !shown.special ? shown.host.split('.').pop() : '';
      var tldOk = /^(https?:\/\/|www\.)/i.test(m[0]) || arrayIncludes(TEXT_TLDS, shownTld) ||
        (shownTld.length === 2 && !arrayIncludes(FILE_EXTS, shownTld));
      if (shown && !shown.special && tldOk) {
        var shownReg = registrableDomain(shown.host);
        if (shownReg && shownReg !== targetReg && shownReg !== firstReg) {
          finding(list, 'text-mismatch', 'danger', 'Teksten og linket passer ikke sammen',
            'Linket viser "' + shown.unicodeHost + '", men går til ' + p.unicodeHost + '.');
          return;
        }
        if (shownReg) return; // teksten viser den rigtige adresse
      }
    }

    var lower = t.toLowerCase();
    for (var i = 0; i < BRANDS.length; i++) {
      var brand = BRANDS[i];
      for (var j = 0; j < brand.textKeys.length; j++) {
        var key = brand.textKeys[j];
        var re = new RegExp('(^|[^a-z0-9æøå])' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9æøå])', 'i');
        if (re.test(lower) && !isOfficial(brand, p.host)) {
          finding(list, 'text-brand', 'warning', 'Teksten nævner ' + brand.name,
            'Men linket går til ' + p.unicodeHost + ', som ikke er ' + brand.name + 's domæne.');
          return;
        }
      }
    }
  }

  var LEVEL_POINTS = { danger: 60, warning: 25, info: 5, good: 0 };

  /**
   * Fuld analyse.
   *   rawURL  – adressen der blev klikket på
   *   opts    – {
   *     linkText:      synlig tekst på linket (valgfri)
   *     redirectChain: liste af adresser fulgt over netværket (valgfri, inkl. start)
   *     finalURL:      endelig adresse efter omdirigeringer (valgfri)
   *     domainAgeDays: alder på destinationens domæne i dage (valgfri)
   *     domainCreated: ISO-dato for registrering (valgfri)
   *     networkError:  tekst hvis netværkstjek fejlede (valgfri)
   *     pageHost:      værten for siden linket står på (valgfri)
   *   }
   */
  function analyze(rawURL, opts) {
    opts = opts || {};
    var prep = prepare(rawURL);
    var findings = [];

    if (!prep.ok) {
      if (prep.reason === 'not-web') {
        var level = (prep.scheme === 'data' || prep.scheme === 'javascript' || prep.scheme === 'blob') ? 'danger' : 'info';
        var titles = {
          mailto: 'Åbner en ny e-mail', tel: 'Ringer op', sms: 'Åbner en sms',
          data: 'Linket indeholder selv en hel side', javascript: 'Linket kører kode', blob: 'Linket indeholder selv en hel side'
        };
        finding(findings, 'scheme', level, titles[prep.scheme] || ('Åbner ' + prep.scheme + ':'),
          level === 'danger' ? 'Den slags links kan vise en falsk side, der ikke ligger på noget domæne.' : prep.url);
      } else {
        finding(findings, 'invalid', 'warning', 'Ugyldig adresse', 'Kunne ikke læse adressen.');
      }
      return finish(rawURL, prep, null, null, findings, opts);
    }

    var first = parseURL(prep.url);
    var finalStr = opts.finalURL || prep.target;
    var finalP = parseURL(finalStr);
    if (!finalP || finalP.special) finalP = parseURL(prep.target);

    // Omslag
    prep.wrappers.forEach(function (w, i) {
      finding(findings, 'wrapper-' + i, 'info', 'Pakket ind af ' + w.via, 'Den egentlige adresse er gemt inde i linket og er pakket ud.');
    });

    // Omdirigeringer
    var chain = opts.redirectChain || [];
    var firstReg = registrableDomain(parseURL(prep.target).host);
    var finalReg = registrableDomain(finalP.host);
    if (prep.isShortener) {
      if (chain.length > 1 || opts.finalURL) {
        finding(findings, 'shortener', 'info', 'Forkortet link', 'Forkorteren ' + prep.host + ' sender videre til ' + finalP.unicodeHost + '.');
      } else {
        finding(findings, 'shortener', 'warning', 'Forkortet link – destinationen er skjult',
          opts.networkError ? 'Kunne ikke finde ud af, hvor linket ender: ' + opts.networkError : 'Linket går via ' + prep.host + ', så den endelige side kan ikke ses i adressen.');
      }
    } else if (finalReg !== firstReg) {
      finding(findings, 'redirect', 'info', 'Sender videre til et andet domæne',
        'Linket starter på ' + firstReg + ' men ender på ' + finalReg + '.');
    }
    if (chain.length > 5) {
      finding(findings, 'redirect-many', 'warning', 'Mange omdirigeringer', 'Linket springer ' + (chain.length - 1) + ' gange, før det lander.');
    }

    // Åben omdirigering gemt i adressen
    var emb = embeddedURL(finalP);
    if (emb) {
      var embP = parseURL(emb.url);
      finding(findings, 'embedded', 'warning', 'Adressen gemmer en anden adresse',
        'Parameteret "' + emb.param + '" peger på ' + embP.unicodeHost + '. Siden kan sende dig videre dertil.');
      hostFindings(embP, findings, 'embedded-');
    }

    // Brugernavn-tricket kan kun ses i den oprindelige adresse
    if (first.userinfo !== null && first.userinfo !== undefined && first.href !== finalP.href) {
      hostFindings({ host: first.host, unicodeHost: first.unicodeHost, asciiHost: first.asciiHost, userinfo: first.userinfo, scheme: 'https', port: null }, findings, 'first-');
    }

    var official = hostFindings(finalP, findings, '');

    // Domænealder
    if (typeof opts.domainAgeDays === 'number' && !official) {
      var days = Math.floor(opts.domainAgeDays);
      if (days < 14) {
        finding(findings, 'age', 'danger', 'Helt nyt domæne', finalReg + ' blev registreret for ' + days + (days === 1 ? ' dag' : ' dage') + ' siden. Svindelsider er ofte kun få dage gamle.');
      } else if (days < 90) {
        finding(findings, 'age', 'warning', 'Nyt domæne', finalReg + ' blev registreret for ' + days + ' dage siden.');
      } else {
        var years = Math.floor(days / 365);
        finding(findings, 'age', 'good', 'Etableret domæne', finalReg + ' har eksisteret i ' + (years >= 1 ? 'over ' + years + (years === 1 ? ' år' : ' år') : 'over ' + Math.floor(days / 30) + ' måneder') + '.');
      }
    }

    if (official) {
      finding(findings, 'official', 'good', 'Officielt domæne for ' + official.name, finalReg + ' tilhører ' + official.name + '.');
    }

    linkTextFindings(opts.linkText, finalP, parseURL(prep.target), findings);

    return finish(rawURL, prep, first, finalP, findings, opts, official);
  }

  function finish(rawURL, prep, first, finalP, findings, opts, official) {
    var score = 0;
    var levels = { danger: 0, warning: 0, info: 0, good: 0 };
    findings.forEach(function (f) { score += LEVEL_POINTS[f.level] || 0; levels[f.level]++; });

    var verdict = levels.danger > 0 ? 'danger' : (levels.warning > 0 ? 'caution' : 'ok');
    var order = { danger: 0, warning: 1, info: 2, good: 3 };
    findings.sort(function (a, b) { return order[a.level] - order[b.level]; });

    // Ved falske bogstaver viser vi den tekniske (xn--) form, så domænet ikke ligner originalen.
    var spoofed = findings.some(function (f) { return /(^|-)(mixed-script|whole-script)$/.test(f.id); });

    var summary;
    if (verdict === 'danger') summary = findings[0].title;
    else if (verdict === 'caution') summary = 'Vær opmærksom: ' + findings[0].title.charAt(0).toLowerCase() + findings[0].title.slice(1);
    else if (official) summary = 'Linket går til ' + official.name;
    else summary = 'Ingen tegn på problemer fundet';

    return {
      version: VERSION,
      input: String(rawURL),
      url: prep && prep.url ? prep.url : String(rawURL),
      finalURL: finalP ? finalP.href : (prep && prep.url ? prep.url : String(rawURL)),
      scheme: finalP ? finalP.scheme : (prep && prep.scheme) || '',
      host: finalP ? finalP.host : '',
      displayHost: finalP ? (spoofed ? finalP.asciiHost : finalP.unicodeHost) : '',
      asciiHost: finalP ? finalP.asciiHost : '',
      registrableDomain: finalP ? (spoofed ? registrableDomain(finalP.asciiHost) : hostToUnicode(registrableDomain(finalP.host))) : '',
      spoofed: spoofed,
      isWeb: !!finalP,
      verdict: verdict,
      score: Math.min(score, 100),
      summary: summary,
      findings: findings,
      redirectChain: (opts && opts.redirectChain) || [],
      domainAgeDays: typeof (opts && opts.domainAgeDays) === 'number' ? Math.floor(opts.domainAgeDays) : null,
      domainCreated: (opts && opts.domainCreated) || null,
      officialBrand: official ? official.name : null
    };
  }

  // JSON-varianter til Swift/JavaScriptCore (kun strenge over broen).
  function prepareJSON(url) {
    return JSON.stringify(prepare(url));
  }

  function analyzeJSON(url, optsJSON) {
    var opts = {};
    try { opts = optsJSON ? JSON.parse(optsJSON) : {}; } catch (e) { opts = {}; }
    return JSON.stringify(analyze(url, opts));
  }

  return {
    version: VERSION,
    parseURL: parseURL,
    prepare: prepare,
    analyze: analyze,
    prepareJSON: prepareJSON,
    analyzeJSON: analyzeJSON,
    registrableDomain: registrableDomain,
    splitDomain: splitDomain,
    hostToUnicode: hostToUnicode,
    hostToASCII: hostToASCII,
    skeleton: skeleton,
    brandMention: brandMention,
    _brands: BRANDS
  };
});
