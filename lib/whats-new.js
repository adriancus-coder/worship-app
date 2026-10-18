'use strict';

// "Ce e nou": the releases people are told about when they open the app after an update
// (public/whats-new.js shows the ones newer than the last one seen on that device). Newest
// first; id = the release day (orderable as text). Keep each list short: what a person
// notices, not how it is built. Add an entry on top with every deploy worth telling.

const RELEASES = [
  {
    id: '2026-10-18',
    ro: {
      title: 'Mai mult loc pentru Program pe telefon; Îndemn la rugăciune',
      items: [
        'Pe telefon, pagina evenimentului lasă Programului aproape tot ecranul: capul paginii e compact, iar bara de salvare are un singur rând.',
        'Un tip nou de element în Program: Îndemn la rugăciune (lângă Predică și Altceva), cu culoarea lui și titlul pe proiector.',
      ],
    },
    en: {
      title: 'More room for the Program on phones; Call to prayer',
      items: [
        'On the phone, the event page leaves almost the whole screen to the Program: a compact head and a one-line save bar.',
        'A new item type in the Program: Call to prayer (next to Sermon and Other), with its own colour and a title on the projector.',
      ],
    },
  },
  {
    id: '2026-10-16',
    ro: {
      title: 'Versuri editabile în timpul slujbei, invitații, planificator',
      items: [
        '„✎ Versuri” la cântarea afișată (pagina live și consola): corectezi textul pe loc și alegi: doar pentru acest eveniment sau definitiv, în bibliotecă.',
        '„Trimite invitația” la toată echipa; fiecare răspunde Vin / Poate / Nu pot, din aplicație (pop-up la deschidere) sau direct din email.',
        '„Planifică”: creezi mai multe evenimente deodată dintr-un calendar (ex. toate duminicile din lună), dintr-un șablon.',
        'Notificările, rearanjate: pe zile, mai compacte, cu repetările strânse într-un rând.',
        'Pe telefon, fiecare alege pe cine urmărește: liderul / prezentatorul sau proiectorul. Liderul la fel, pe pagina live.',
        'Când operatorul predă proiectorul, proiecția nu mai sare: cine primește controlul alege să continue de acolo sau de unde era.',
        'Nota evenimentului apare pe carduri; Ghidurile pot fi scrise cu AI.',
      ],
    },
    en: {
      title: 'Lyrics editable during the service, invitations, a planner',
      items: [
        '“✎ Lyrics” on the song on screen (the live page and the console): fix the text right there and choose: for this event only, or for good, in the library.',
        '“Send the invitation” to the whole team; everyone answers Yes / Maybe / No, in the app (a pop-up on opening) or straight from the email.',
        '“Plan”: create many events at once from a calendar (e.g. every Sunday of the month), from a template.',
        'Notifications, rearranged: by day, more compact, repeats folded into one row.',
        'On the phone, everyone chooses whom to follow: the leader / presenter or the projector. The leader too, on the live page.',
        'When the operator hands over the projector, the projection no longer jumps: whoever receives it chooses to continue from there or from where they were.',
        'The event note shows on the cards; the Guides can be written with AI.',
      ],
    },
  },
];

// The releases newer than `since` (an id seen before; null: the newest one only).
function releasesSince(since) {
  if (!since) return RELEASES.slice(0, 1);
  return RELEASES.filter((r) => r.id > since);
}

module.exports = { RELEASES, releasesSince, latest: () => (RELEASES[0] ? RELEASES[0].id : null) };
