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
    id: '2026-10-18',
    title: { ro: 'Gama pe proiector; mai mult loc pentru Program pe telefon', en: 'The key on the projector; more room for the Program on phones' },
    items: [
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
