# LinkTunnel

LinkTunnel er en iPhone-app, der viser, hvor et link går hen, før du åbner det. Den advarer også, hvis linket ligner svindel.

LinkTunnel kan bruges på to måder:

| | Hvordan | Hvor |
|---|---|---|
| **Pop-up ved klik** | Safari-udvidelse. Når du trykker på et link, åbner et ark nedefra med destinationen og en vurdering, før siden åbner. | Safari |
| **Tjek med LinkTunnel** | Handling i Del-menuen. Hold fingeren på et link, tryk Del og vælg Tjek med LinkTunnel. | Mail, Beskeder og alle andre apps |

Selve appen har også et felt, hvor du kan indsætte og tjekke et link. Desuden kan `linktunnel://check?url=…` bruges fra Genveje.

> iOS lader ikke apps opsnappe klik i Mail og Beskeder. Derfor er Del-menuen den officielle vej dertil, og pop-up'en findes kun i Safari.

## Hvad tjekkes

- **Den rigtige ejer af domænet.** Ejeren vises med fed, så `mitid.dk.sikker-login.xyz` tydeligt står som *sikker-login.xyz*.
- **Efterligning af kendte brands.** Fx `mitid-login.com`, `paypa1.com`, `danskebank-dk.info` og `nordeaa.com`. Listen dækker MitID, borger.dk, Skat, e-Boks, banker, MobilePay, PostNord, GLS, DAO, Apple, Microsoft, Google, Netflix og flere.
- **Falske bogstaver.** Kyrilliske og græske tegn, der ligner latinske (fx `аррӏе.com`), og domæner, der blander alfabeter. De vises i teknisk form (`xn--…`), så de ikke ligner originalen.
- **Linktekst og adresse passer ikke sammen.** Fx når der står "www.danskebank.dk", men linket går et andet sted hen, eller når teksten nævner MitID, mens linket ikke går til MitID.
- **Markering på forhånd.** I Safari får links, hvor teksten viser én adresse, men linket går til en anden, en rød stiplet ramme, allerede før du trykker. Det hjælper også ved "Åbn i ny fane" fra tryk-og-hold-menuen, som udvidelsen ikke kan stoppe.
- **Skjulte destinationer.** Forkortede links (bit.ly, t.co …) og nyhedsbrev-sporingslinks følges til den endelige side. Outlook Safe Links, Google-, Facebook- og Proofpoint-omslag pakkes ud lokalt.
- **Domænets alder.** Den slås op via RDAP. Domæner under 14 dage giver rød advarsel, og domæner under 90 dage giver gul.
- **Andre tricks.** `@` i adressen, skjulte IP-adresser, http uden kryptering, endelser der ofte bruges til svindel (.top, .xyz, .zip …), gratis hosting og usædvanligt lange domæner.

Et grønt resultat betyder kun, at ingen af disse tegn blev fundet. Det er ingen garanti for, at siden er sikker.

## Opbygning

```
Shared/linktunnel-core.js      Al analyse – én fil, bruges af både Safari og Swift
Shared/Swift/                  JavaScriptCore-bro, netværk (omdirigeringer, RDAP), modeller
Shared/UI/                     SwiftUI-visning af en vurdering (app + Del-menu)
App/                           Selve appen (tjek-felt + opsætningsguide)
ActionExtension/               "Tjek med LinkTunnel" i Del-menuen
SafariExtension/               Safari-udvidelsen (content script, pop-up, indstillinger) + native handler
tests/                         Node-tests af analysemotoren
project.yml                    XcodeGen-projektbeskrivelse
```

Analysen er skrevet i JavaScript, så den samme kode kører i Safari-udvidelsen og i Swift via JavaScriptCore. Vurderingen er derfor altid den samme, uanset hvor du tjekker linket. Netværksopslag (omdirigeringer og domænealder) laves i Swift, fordi et content script ikke kan følge omdirigeringer på tværs af domæner.

## Kom i gang

1. Installér XcodeGen: `brew install xcodegen`
2. Åbn `project.yml` og ret `BUNDLE_PREFIX` (dit omvendte domæne) og evt. `DEVELOPMENT_TEAM`.
3. Generér projektet: `xcodegen generate`
4. Åbn `LinkTunnel.xcodeproj` og vælg dit team under *Signing & Capabilities* for alle tre targets, hvis du ikke har sat `DEVELOPMENT_TEAM`.
5. Kør på din iPhone.
6. På telefonen: **Indstillinger → Apps → Safari → Udvidelser → LinkTunnel**. Slå udvidelsen til, og sæt **Alle websteder** til **Tillad**.

Kør testene af analysemotoren med `npm test` (kræver Node 18+).

## Indstillinger i Safari-udvidelsen

Tryk på puslespilsikonet i Safaris adresselinje og vælg LinkTunnel:

- **Hvornår:** ved alle links til andre websteder (standard) eller kun når noget ser mistænkeligt ud.
- **Spring links inden for samme websted over** (standard: til).
- **Følg omdirigeringer:** forkortede links og nyhedsbreve (standard), alle links eller aldrig.
- **Tjek domænets alder** (standard: til).
- **Markér links, hvor tekst og adresse ikke passer sammen** (standard: til).
- **Betroede domæner:** domæner, hvor du har valgt "Spørg ikke igen".

## Privatliv

- Når LinkTunnel følger omdirigeringer, sendes HEAD-forespørgsler uden cookies, og siden åbnes ikke. Enkelte engangslinks (fx "bekræft din e-mail") kan alligevel blive brugt op af det. Derfor følges som standard kun forkortede links og kendte nyhedsbrev-links.
- Ved tjek af domænealder sendes kun domænenavnet til rdap.org, som videresender til det relevante domæneregister. Nogle registre, muligvis også .dk, svarer ikke via RDAP. Så vises alderen bare ikke.
- Intet logges eller gemmes uden for telefonen.

## Kendte begrænsninger

- Pop-up'en reagerer på almindelige klik på links. Sider, der skifter adresse med JavaScript (fx knapper uden et rigtigt link), fanges ikke.
- "Åbn link" i Del-menuen bruger en udokumenteret vej til at åbne Safari fra en udvidelse. Virker den ikke på en kommende iOS-version, kopieres linket i stedet. Apple kan desuden afvise det ved App Store-gennemgang. Så kan knappen ændres til kun "Kopiér link".
- Listen over brands og mistænkelige endelser ligger i `Shared/linktunnel-core.js` og kan udvides. Husk at køre `npm test` bagefter.
