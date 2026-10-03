# Backgrounds from outside: by link and from Pexels

Backgrounds behind the lyrics come from the media library (Media → Fundaluri). Besides
uploading a file, an editor can add one **by link** or search **Pexels**. Both go through
the server: the browser never talks to another site, and the file ends up in the library
exactly like an upload (a projector-size WebP and a thumbnail for images, a muted loop for
videos), so the projector and the local mode need nothing from the internet afterwards.

## By link ("Din link")

Paste an `https://` link that leads straight to a JPEG / PNG / WebP image or an MP4 / WebM
video. The server fetches it with a 10 s timeout, follows at most 5 redirects (each one
checked again), refuses private / local addresses and non-https hops, stops at the size
limit (8 MB images, 50 MB loops by default: `MEDIA_MAX_IMAGE_MB`, `MEDIA_MAX_LOOP_MB`) and
decides what the file is from its first bytes, never from the link or the `Content-Type`.
The church's quota and the disk margin apply as for uploads. The link is kept as
`source_url` and the list shows *sursă: host*.

## Pexels ("Caută pe Pexels")

[Pexels](https://www.pexels.com) offers free photos and video loops. The tab appears in
Media → Fundaluri only when the server has a key.

### 1. A free key

1. Create an account at pexels.com and open <https://www.pexels.com/api/>.
2. "Get started" → "Your API key": copy the key (a long string, no prefix).
3. Set it in the environment and redeploy:

| Variable | Required | Meaning |
| --- | --- | --- |
| `PEXELS_API_KEY` | for the tab | the key from pexels.com/api |
| `PEXELS_API_URL` | no | tests only: a local stand-in for `https://api.pexels.com` |

On Render the key is declared in `render.yaml` with `sync: false`: set it in the service's
**Environment** tab. Locally put it in `.env`. The startup log says `Pexels: enabled` or
`Pexels: disabled`; Setări (owner) shows a card *Pexels: activ / dezactivat*.

### 2. What the tab does

- A search field with suggestions (sky, light, nature, abstract, worship…), a toggle
  Fotografii / Video-uri and a grid of thumbnails (landscape only, 24 per search).
- **Adaugă** downloads the projector-size photo (Pexels' `large2x`, 1880 px wide) or the
  largest MP4 at most 1920 px wide (HD, else SD; at most 50 MB) into the library, with the
  photographer's name and the Pexels page kept as attribution. The list shows
  *Foto: Name · Pexels* (a link); the projector never shows it.
- Server-side only: at most **60 searches an hour per church**, results cached **10
  minutes** per query, the download rules of "Din link" above.

### 3. Licence, in short

The [Pexels licence](https://www.pexels.com/license/) allows free use, including for a
church's projection, without asking and without attribution being required; the app keeps
the attribution anyway, as Pexels asks where possible. Not allowed: selling unaltered
copies, using identifiable people or brands in a way that suggests endorsement, or
implying Pexels or the photographer endorses the church. Check the current licence text on
pexels.com before relying on it.

## Without a key

Leave `PEXELS_API_KEY` unset (local mode, or a church without internet on the operator
PC): the tab is hidden, `/api/media/pexels/*` answers `503 pexelsDisabled`, and "Din link"
and uploads keep working.
