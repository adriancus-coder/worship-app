'use strict';

// "Ce e nou": the releases people are told about when they open the app after an update
// (public/whats-new.js shows the ones newer than the last one seen on that device). Newest
// first; id = the release day (orderable as text). Keep each list short: what a person
// notices, not how it is built. Add an entry on top with every deploy worth telling.
//
// Every item says whom it is for (`for`), so each person sees only what is new for their
// role: 'all', or a list of rights (lib/roles.js PERMS: library, events, media, live, screens,
// schedule, guides) and/or roles (owner, presenter, leader, operator, member); one match is
// enough. A release with nothing for a person is left out for them.

const RELEASES = [
  {
    id: '2026-10-24',
    title: { ro: 'Detectarea gamei', en: 'Key detection' },
    items: [
      {
        for: 'all',
        ro: 'Pe Acasă, în programul evenimentului, atingi o cântare și se deschide toată sub rând (în gama evenimentului); atingi o strofă și o vezi mare, iar de acolo glisezi stânga / dreapta prin strofe și prin cântările următoare; ✕ te aduce înapoi la card, unde poți deschide altă cântare. Cine schimbă gama pentru eveniment o face acum atingând eticheta gamei din dreapta.',
        en: 'On Home, in the event’s programme, tap a song and it opens in full under its row (in the event’s key); tap a section to see it big, then swipe left / right through the sections and on into the next songs; ✕ brings you back to the card, where another song can be opened. Those who change the key for the event now tap the key badge on the right.',
      },
      {
        for: ['live', 'screens', 'owner'],
        ro: 'Pornirea și încheierea evenimentului sunt ale operatorului (dreptul „Proiector”) și ale proprietarului. Liderul și prezentatorul nu mai au „Pornește live” / „Încheie”: de pe Acasă și de pe eveniment intră direct în pagina lor (versurile mari, pagina live), iar panoul proiectorului le apare doar când operatorul le dă controlul; până atunci ce mută ei vede doar echipa.',
        en: 'Starting and ending the event belong to the operator (the “Projector” right) and the owner. The leader and the presenter no longer have “Start live” / “End”: from Home and the event they go straight to their page (the big lyrics, the live page), and the projector panel shows for them only once the operator hands them the projector; until then what they move is seen by the team only.',
      },
      {
        for: 'all',
        ro: 'Pagina „Repetiție” a fost scoasă (butonul de pe Acasă și de pe pagina evenimentului, linkul). Programul se vede pe pagina evenimentului, fiecare cântare se deschide de acolo cu versuri și acorduri (și PDF), iar în timpul slujbei telefonul urmărește live. Linkurile vechi către repetiție duc la pagina evenimentului.',
        en: 'The “Rehearsal” page was removed (the button on Home and on the event page, the link). The programme is on the event page, each song opens from there with lyrics and chords (and a PDF), and during the service the phone follows live. Old rehearsal links land on the event page.',
      },
      {
        for: ['library', 'school', 'live', 'operator', 'owner'],
        ro: 'Negativ la cântări: pe pagina cântării, cei care o pot edita (biblioteca sau școala duminicală) încarcă un fișier audio (MP3, M4A, WAV, OGG, până la 20 MB) sau pun un link YouTube la „Negativ”; oricine deschide cântarea îl poate asculta. În consola operatorului, cântarea de pe proiector arată playerul „Negativ” și lista marchează cântările cu ♪, ca operatorul să-l pornească de pe dispozitivul lui, la pupitru.',
        en: 'Backing tracks on songs: on the song page, those who can edit it (the library or the Sunday school) upload an audio file (MP3, M4A, WAV, OGG, up to 20 MB) or set a YouTube link under “Backing track”; anyone opening the song can listen. In the operator console, the song on the projector shows the “Backing track” player and the list marks such songs with ♪, so the operator plays it from the desk.',
      },
      {
        for: ['school', 'events', 'live'],
        ro: 'Responsabilii școlii duminicale (dreptul „Școala duminicală”) pot pune cântările școlii în programul unui eveniment: pe pagina evenimentului, „+ Cântare de la școala duminicală” deschide biblioteca școlii, iar cântarea intră la sfârșitul programului cu nota „Școala duminicală”, vizibilă operatorului și echipei. Tot ei o pot scoate cu ✕; restul programului rămâne al liderului.',
        en: 'The Sunday school’s people (the “Sunday school” right) can put the school’s songs into an event’s programme: on the event page, “+ Sunday school song” opens the school library and the song joins the end of the programme marked “Școala duminicală”, seen by the operator and the team. They can take it out again with ✕; the rest of the programme stays the leader’s.',
      },
      {
        for: ['owner'],
        ro: '„Vezi aplicația ca” (Mai mult) are acum și rolurile create de tine (de exemplu „Școala duminicală”): vezi aplicația exact cum o vede o persoană cu acel rol — biblioteca, meniul, paginile și drepturile — iar bara de sus te aduce înapoi la proprietar.',
        en: '“View the app as” (More) now lists the roles you created too (“Sunday school”, for instance): you see the app exactly as a person with that role does — the library, the menu, the pages and the rights — and the bar at the top brings you back to owner.',
      },
      {
        for: ['library', 'school', 'owner'],
        ro: 'La importul din fișier (Bibliotecă → ⋯ → Importă) alegi în care bibliotecă intră cântările noi: Biserica sau Școala duminicală (presetată cea deschisă). Cântările care există deja rămân în biblioteca lor; rezumatul spune unde au intrat.',
        en: 'The file import (Library → ⋯ → Import) lets you choose which library the new songs go into: Church or Sunday school (preset to the one open). Songs that already exist stay in their library; the summary names where they went.',
      },
      {
        for: 'all',
        ro: 'Pe pagina cântării, butonul „Tipărește” face un PDF cu cântarea: titlul, gama, tematica și versurile așa cum le vezi (cu acorduri, sau doar textul dacă „Doar text” e pornit). Pe telefon se deschide meniul de partajare (Tipărește, Salvează în Fișiere, WhatsApp…), pe calculator se descarcă. Merge și în aplicația instalată și fără internet — de exemplu cântările școlii duminicale, ca să le învețe copiii și de pe foaie.',
        en: 'On the song page, the “Print” button makes a PDF of the song: the title, the key, the themes and the lyrics as shown (with chords, or the text alone when “Text only” is on). On a phone the share sheet opens (Print, Save to Files, WhatsApp…), on a computer it downloads. It works in the installed app and offline too — the Sunday school songs, for instance, so the children can learn them from paper.',
      },
      {
        for: ['library', 'school', 'owner'],
        ro: 'Biblioteca școlii duminicale: a doua bibliotecă, separată de a bisericii (comutatorul „Biblioteca: Biserica / Școala duminicală” sus în Bibliotecă; la editare alegi în care intră cântarea). Dreptul nou „Școala duminicală” (Echipa → Roluri) lasă responsabilii să adauge și să editeze doar acolo. La alegerea cântărilor pentru program apar ambele, cele ale școlii marcate.',
        en: 'The Sunday school library: a second library, apart from the church’s (the “Library: Church / Sunday school” switch at the top of the Library; when editing you choose which one the song goes into). The new “Sunday school” right (Team → Roles) lets its people add and edit there only. When picking songs for a programme both show, the school’s marked.',
      },
      {
        for: ['events'],
        ro: '„+ Eveniment nou” nu mai creează evenimentul pe loc: întâi completezi numele, data (din calendar), ora (din listă), programul de pornire (10 cântări la întâmplare, din orice temă sau dintr-una anume; copia unui eveniment trecut; gol) și o notă, apoi „Creează evenimentul” îl deschide gata pregătit.',
        en: '“+ New event” no longer creates the event at once: first you fill in the name, the date (from a calendar), the time (from a list), the starting programme (10 random songs from any or one theme; a copy of a past event; empty) and a note, then “Create the event” opens it ready.',
      },
      {
        for: ['leader', 'presenter', 'owner'],
        ro: 'Pagina live are o vedere „Compact” (comutatorul Vedere: Complet / Compact, sau „Listă” din versurile mari): doar programul, cu gama fiecărei cântări și o bifă verde pe cântările pe care proiectorul le-a arătat în proporție de peste 70 %. Ecranul telefonului rămâne aprins cât timp evenimentul e live.',
        en: 'The live page has a “Compact” view (the View switch: Full / Compact, or “List” from the big lyrics): only the programme, with each song’s key and a green tick on the songs the projector has shown more than 70 % of. The phone’s screen stays on while the event is live.',
      },
      {
        for: ['library', 'events'],
        ro: 'Tematica cântărilor: pe pagina cântării, „Tematică · Setează” deschide indexul tematic (A doua venire, Botez, Colinde, Laudă și închinare, Paște, Rugăciune…) din care alegi cu o atingere, plus orice temă scrisă de tine; temele vin automat și la importul de pe resursecrestine.ro („Tematica” de acolo). Pe pagina cântării temele sunt etichete; în bibliotecă ai filtrul „Tema”. La „Idei de cântări” și „10 cântări la întâmplare” alegi tema din care vin propunerile.',
        en: 'Song themes: on the song page, “Themes · Set” opens the thematic index (second coming, baptism, carols, praise and worship, Easter, prayer…) to pick from with one tap, plus any theme you write; themes also come in automatically with the resursecrestine.ro import (its “Tematica”). The song page shows them as chips; the library has a “Theme” filter. “Song ideas” and “10 random songs” take the theme the suggestions come from.',
      },
      {
        for: ['events'],
        ro: 'Șabloanele de evenimente au fost scoase (nu mai există tab-ul „Șabloane”, „Salvează ca șablon” și „Pornește de la șablonul”). Un eveniment nou pornește de la ziua și ora obișnuită din Setări și de la 10 cântări la întâmplare; „Detalii → Program de la” păstrează copia unui eveniment trecut.',
        en: 'Event templates were removed (no more “Templates” tab, “Save as template” or “Start from the template”). A new event starts from the usual day and time in Settings and ten random songs; “Details → Programme from” keeps the copy of a past event.',
      },
      {
        for: ['events'],
        ro: 'Cântări la întâmplare: un eveniment nou („+ Eveniment nou”) pornește cu 10 cântări alese la întâmplare din bibliotecă, fără cele cântate la ultimele 3 evenimente. În program, „+ Altele → 10 cântări la întâmplare” le adaugă oricând, iar „Idei de cântări” (sub bara de adăugare) îți arată 10 propuneri din care alegi una câte una.',
        en: 'Random songs: a new event (“+ New event”) starts with 10 songs drawn at random from the library, leaving out the ones sung at the last 3 events. In the programme, “+ More → 10 random songs” adds them any time, and “Song ideas” (under the add bar) shows 10 suggestions to pick from one by one.',
      },
      {
        for: 'all',
        ro: 'Mesajele explicative (de exemplu „Proiectorul e al tău” de pe consolă sau sfaturile cu taste) se pot închide cu ×: rămân închise pe dispozitivul tău. Le aduci înapoi din Profil, „Arată din nou mesajele închise”.',
        en: 'The explanatory messages (for example “The projector is yours” on the console or the keyboard tips) can be closed with ×: they stay closed on your device. Bring them back from Profile, “Show the closed messages again”.',
      },
      {
        for: ['library'],
        ro: 'Pe pagina unei cântări fără ton: „Detectează gama”. Gama se estimează din acordurile cântării (cea mai probabilă, încă două variante și cât de sigură e); alegi și confirmi înainte de salvare. O gamă deja setată nu se înlocuiește fără o a doua confirmare.',
        en: 'On the page of a song without a key: “Detect the key”. The key is estimated from the song’s chords (the most likely one, two more candidates and how sure it is); you choose and confirm before it is saved. A key already set is never replaced without a second confirmation.',
      },
      {
        for: ['library'],
        ro: 'Fără acorduri? Încarcă o înregistrare (mp3, m4a, wav) sau înregistrează 20 de secunde cu microfonul: analiza se face pe dispozitivul tău, înregistrarea nu pleacă nicăieri.',
        en: 'No chords? Upload a recording (mp3, m4a, wav) or record 20 seconds with the microphone: the analysis runs on your device, the recording goes nowhere.',
      },
      {
        for: ['library'],
        ro: 'În bibliotecă, meniul „⋯” are „Detectează gama la toate”: o listă cu toate cântările care au acorduri dar nu au ton, cu gama propusă de verificat și salvat în bloc.',
        en: 'In the library, the “⋯” menu has “Detect the key of all songs”: a list of every song with chords but no key, with the suggested key to check and save in one go.',
      },
    ],
  },
  {
    id: '2026-10-18',
    title: { ro: 'Gama pe proiector; mai mult loc pentru Program pe telefon', en: 'The key on the projector; more room for the Program on phones' },
    items: [
      {
        for: ['live', 'owner'],
        ro: 'Pe tabletă în peisaj (iPad), pagina live și consola operatorului au loc pentru toate butoanele: Programul și panoul „Proiector” în stânga, cântarea curentă în dreapta; de la lățimi mai mari, trei coloane ca pe calculator. Toate paginile au fost verificate la lățimile de iPad (portret și peisaj).',
        en: 'On a tablet in landscape (iPad), the live page and the operator console have room for all their buttons: the Program and the “Projector” panel on the left, the current song on the right; from wider screens, three columns as on a computer. Every page was checked at iPad widths (portrait and landscape).',
      },
      {
        for: 'all',
        ro: 'În versurile mari, rândul „Urmează: …” e mai mic și pe două rânduri: încape și primul vers al secțiunii următoare. Pe telefon, butoanele de jos sunt mai scunde.',
        en: 'In the big lyrics, the “Next: …” line is smaller and up to two rows: the first line of the next section fits. On the phone the bottom buttons are shorter.',
      },
      {
        for: 'all',
        ro: 'La repetiție, „Elementul 3 din 5” e acum un buton: deschide Programul și sari direct la orice cântare, nu doar una după alta. Mărimea textului se schimbă din A− / A+, sus în dreapta.',
        en: 'At the rehearsal, “Item 3 of 5” is now a button: it opens the Program and you jump straight to any song, not only one after another. The text size changes from A− / A+, top right.',
      },
      {
        for: ['live', 'owner'],
        ro: '„Acorduri” pe proiector: versurile de pe ecran cu acordurile deasupra cuvintelor, pornite / oprite din panoul „Proiector” (consolă și pagina live, lângă Gama; tasta C); Setările dau cu ce pornește un eveniment nou (oprite implicit). Fiecare din echipă are în continuare „Doar text” pe dispozitivul lui.',
        en: '“Chords” on the projector: the lyrics on the screen with the chords above the words, on / off from the “Projector” panel (the console and the live page, next to Key; key C); Settings give what a new event starts with (off by default). Everyone on the team still has “Text only” on their own device.',
      },
      {
        for: ['library', 'events', 'live'],
        ro: 'Căutarea pe resurse găsește și foile din secțiunea „Acorduri” a site-ului (marcate „Acorduri”, cu autorul): se importă direct ca o cântare cu acorduri; poți lipi și un link de acolo.',
        en: 'The resurse search also finds the sheets in the site’s “Acorduri” section (marked “Chords”, with the author): they import straight away as a song with chords; a link from there can be pasted too.',
      },
      {
        for: ['library', 'events', 'live'],
        ro: 'Importul de pe resursecrestine.ro aduce și acordurile: dacă textul cântării nu le are, se iau din foaia de acorduri de pe site care se potrivește cu versurile (automat, la „Importă”). În previzualizare alegi foaia (autor, tonalitate, cât din versuri acoperă) sau „Fără acorduri”.',
        en: 'The import from resursecrestine.ro brings the chords too: when the song’s text has none, they come from the site’s chord sheet that matches the lyrics (automatically, on “Import”). In the preview you pick the sheet (author, key, how much of the lyrics it covers) or “No chords”.',
      },
      {
        for: 'all',
        ro: 'Cardul de pe Acasă arată Programul cu tonalitatea fiecărei cântări în dreapta și echipa evenimentului: un cerc cu inițialele fiecăruia și un punct cu răspunsul (verde Vin, galben Poate, roșu Nu pot, gri fără răspuns).',
        en: 'The home card shows the Program with each song’s key on the right and the event’s team: a circle with everyone’s initials and a dot with their answer (green yes, yellow maybe, red no, grey no answer).',
      },
      {
        for: ['events'],
        ro: 'Pe cardul de pe Acasă atingi o cântare și alegi gama (C D E …): se transpune pentru acest eveniment, dintr-o atingere. La o cântare fără ton, același rând îi setează tonul în bibliotecă (cu „minor” pentru Lam, Mim …).',
        en: 'On the home card, tap a song and pick its key (C D E …): it is transposed for this event, in one tap. On a song with no key, the same row sets its key in the library (with “minor” for Am, Em …).',
      },
      {
        for: 'all',
        ro: 'Diagrame de acorduri: pe pagina cântării și la repetiție atingi un acord și vezi cum se cântă, pe chitară (poziția pe grif) sau pe pian (clapele), cu un comutator Chitară / Pian.',
        en: 'Chord diagrams: on the song page and at the rehearsal, tap a chord to see how it is played, on the guitar (the fret shape) or on the piano (the keys), with a Guitar / Piano switch.',
      },
      {
        for: 'all',
        ro: 'Pe pagina cântării: „Cântată ultima dată: …” și, deschis, lista evenimentelor la care a fost cântată.',
        en: 'On the song page: “Last sung: …” and, opened, the list of events it was sung at.',
      },
      {
        for: ['events'],
        ro: '„Notă pentru echipă” pe orice element din Program (verset, anunț, predică, rugăciune, video), nu doar pe cântări: ex. „intro la pian, refrenul de 2 ori”.',
        en: '“Note for the team” on any Program item (verse, announcement, sermon, prayer, video), not only songs: e.g. “piano intro, chorus twice”.',
      },
      {
        for: 'all',
        ro: 'Nota pentru echipă a elementului se vede la repetiție, pe telefon în timpul slujbei, pe pagina live și în consola operatorului. Niciodată pe proiector.',
        en: 'The item’s note for the team shows at the rehearsal, on the phone during the service, on the live page and in the operator console. Never on the projector.',
      },
      {
        for: ['live', 'owner'],
        ro: '„Gama” pe proiector: tonalitatea cântării, mică, într-un colț, doar pe primul ecran al fiecărei cântări. Se pornește, se mută și se mărește din panoul „Proiector” (consola operatorului și pagina live, lângă Ceas; tasta G); Setările dau cu ce pornește un eveniment nou (oprită implicit).',
        en: 'The “Key” on the projector: the song’s key, small, in a corner, only on the first screen of each song. Turned on, moved and sized from the “Projector” panel (the operator console and the live page, next to Clock; key G); Settings give what a new event starts with (off by default).',
      },
      {
        for: 'all',
        ro: 'Pe telefon, pagina evenimentului lasă Programului aproape tot ecranul: capul paginii e compact. Un eveniment numit după ziua lui („Duminica”) are ca titlu direct data („Duminică, 18 octombrie · 15:00”), fără să repete ziua; starea, numărul de elemente și nota stau pe un rând.',
        en: 'On the phone, the event page leaves almost the whole screen to the Program: a compact head. An event named after its day (“Sunday”) has the date as its title (“Sunday, 18 October · 15:00”), without saying the day twice; status, item count and the note share one row.',
      },
      {
        for: ['events'],
        ro: 'La editare: bara de adăugare e un singur rând: „+ Cântare”, „+ Verset” și „+ Altele” (meniu cu Video, Anunț, Predică, Rugăciune, Altceva); „Șterge evenimentul” stă în bara de jos, lângă „Salvează”.',
        en: 'When editing: the add bar is one row: “+ Song”, “+ Verse” and “+ More” (a menu with Video, Announcement, Sermon, Prayer, Other); “Delete event” sits in the bottom bar next to “Save”.',
      },
      {
        for: ['events', 'live'],
        ro: 'Un tip nou de element în Program: Rugăciune — doar cu „Cine” (persoana), care apare mare în Program și pe proiector. La Predică: titlul și „Cine”, pe proiector sub titlu.',
        en: 'A new item type in the Program: Prayer — just “Who” (the person), shown large in the Program and on the projector. A Sermon has its title and “Who”, under the title on the projector.',
      },
    ],
  },
  {
    id: '2026-10-16',
    title: { ro: 'Versuri editabile în timpul slujbei, invitații, planificator', en: 'Lyrics editable during the service, invitations, a planner' },
    items: [
      {
        for: ['live'],
        ro: '„✎ Versuri” la cântarea afișată (pagina live și consola): corectezi textul pe loc și alegi: doar pentru acest eveniment sau definitiv, în bibliotecă.',
        en: '“✎ Lyrics” on the song on screen (the live page and the console): fix the text right there and choose: for this event only, or for good, in the library.',
      },
      {
        for: ['schedule'],
        ro: '„Trimite invitația” la toată echipa, dintr-un singur buton; vezi cine a răspuns Vin / Poate / Nu pot.',
        en: '“Send the invitation” to the whole team with one button; see who answered Yes / Maybe / No.',
      },
      {
        for: 'all',
        ro: 'Răspunzi la invitație cu Vin / Poate / Nu pot, din aplicație (pop-up la deschidere) sau direct din email.',
        en: 'Answer an invitation with Yes / Maybe / No, in the app (a pop-up on opening) or straight from the email.',
      },
      {
        for: ['events'],
        ro: '„Planifică”: creezi mai multe evenimente deodată dintr-un calendar (ex. toate duminicile din lună), dintr-un șablon.',
        en: '“Plan”: create many events at once from a calendar (e.g. every Sunday of the month), from a template.',
      },
      {
        for: 'all',
        ro: 'Notificările, rearanjate: pe zile, mai compacte, cu repetările strânse într-un rând.',
        en: 'Notifications, rearranged: by day, more compact, repeats folded into one row.',
      },
      {
        for: 'all',
        ro: 'Pe telefon, fiecare alege pe cine urmărește: liderul / prezentatorul sau proiectorul. Liderul la fel, pe pagina live.',
        en: 'On the phone, everyone chooses whom to follow: the leader / presenter or the projector. The leader too, on the live page.',
      },
      {
        for: ['live'],
        ro: 'Când operatorul predă proiectorul, proiecția nu mai sare: cine primește controlul alege să continue de acolo sau de unde era.',
        en: 'When the operator hands over the projector, the projection no longer jumps: whoever receives it chooses to continue from there or from where they were.',
      },
      {
        for: 'all',
        ro: 'Nota evenimentului apare pe carduri.',
        en: 'The event note shows on the cards.',
      },
      {
        for: ['guides'],
        ro: 'Ghidurile pot fi scrise cu AI.',
        en: 'The Guides can be written with AI.',
      },
    ],
  },
];

// Whether an item is for this person: 'all', or one of their rights / their role.
function isFor(item, user) {
  if (item.for === 'all') return true;
  const perms = user && Array.isArray(user.perms) ? user.perms : [];
  const role = user ? user.role : null;
  return (Array.isArray(item.for) ? item.for : []).some((f) => f === role || perms.includes(f));
}

// The releases for this person in a language, newest first (at most `limit`): only the items
// for them, and no release with nothing for them. [{ id, title, items: [text] }]
function releasesFor(user, lang, limit = 10) {
  const l = lang === 'en' ? 'en' : 'ro';
  return RELEASES
    .map((r) => ({ id: r.id, title: r.title[l], items: r.items.filter((it) => isFor(it, user)).map((it) => it[l]) }))
    .filter((r) => r.items.length)
    .slice(0, limit);
}

// The releases newer than `since` (an id seen before; null: the newest one only).
function releasesSince(since) {
  if (!since) return RELEASES.slice(0, 1);
  return RELEASES.filter((r) => r.id > since);
}

module.exports = { RELEASES, releasesFor, releasesSince, isFor, latest: () => (RELEASES[0] ? RELEASES[0].id : null) };
