# Flipbook

A realistic 3D page-flip viewer for one PDF catalogue (three.js + pdf.js).

## Run

```bash
npm install
npm run dev        # http://localhost:5191 (or the port Vite prints)
npm run build      # static site in dist/, host anywhere (Vercel, Netlify, any server)
```

## Put your catalogue in

Replace `public/catalog.pdf` with your PDF (keep the name), then change the
title in `index.html` (`<h1 id="docTitle">`). That's it. The download button
serves the same file.

## How the realism works

- Each turning sheet is a real 3D mesh (72 x 44 grid) bent around a cylinder.
  The fold line is the perpendicular bisector between where you grabbed the
  page and where your pointer is, exactly like folding real paper.
- The sheet stays glued to the spine (both spine corners keep their distance
  to the grabbed point), so a dragged corner swings on a natural arc.
- The curl radius shrinks as the sheet lands so it settles perfectly flat; the
  sheet also rises off the book in an arc mid-turn.
- Soft real-time shadows, gutter shading, pages that dip into the spine, page
  stacks that grow and shrink as you read, a hardcover board.
- Hover a corner and it peels up a little; drag from anywhere on the edge;
  flick to turn; tap to turn; arrows / space / PageUp/PageDown / Home / End.
- Double click or pinch / scroll to zoom; pages re-render sharper when zoomed.
- Real recorded page sounds (10 variations, random pitch/level per turn).

## Mobile

On tall screens (phones in portrait) the viewer shows one page at a time and
the camera travels with each turned sheet to the page it lands on. Swipe to
turn, pinch to zoom. Landscape phones and desktop show the full spread.

## Offline app (PWA)

Once the site is online (HTTPS), visitors can install it ("Install app" button
on Chrome/Edge/Android; on iPhone the button explains Share > Add to Home
Screen). After the first visit everything is cached: the viewer, the PDF, the
sounds and fonts, so it opens and flips with all effects without internet.
When you upload a new `catalog.pdf` and redeploy, installed copies update
themselves the next time they are online.

Test it locally: `npm run build && npm run preview`, open the page once, stop
the server and reload. (The dev server, `npm run dev`, does not use offline
caching on purpose.)

## Hidden extras

A pen to write on the pages, a coffee cup and a burger that splash the
catalogue are built in but hidden. Add `?fun=1` to the address to show them.

## Logo

`public/brand/` has the Opsis logo in navy (used on the light header) and the
original white version.

## Share and deep links

`?page=12` opens the catalogue at page 12. The share menu builds that link
(optional) for Facebook, LinkedIn, X, WhatsApp, Viber, email, copy link and
the phone's native share sheet. Share previews need the site to be online on a
public URL.

## Files

- `src/flipbook/Flipbook.js` scene, input, textures, animation
- `src/flipbook/curl.js` the page bending math
- `src/flipbook/pdfSource.js` pdf.js rendering queue (nearest pages first)
- `src/flipbook/sound.js` page sounds
- `src/flipbook/flip-book-element.js` optional `<flip-book src="...">` web component
- `src/main.js`, `src/style.css`, `index.html` the demo page and UI

## Credits

- Sample catalogue: first 40 pages of "A catalogue of surgical instruments",
  Matthews Brothers, London 1874, public domain (Wellcome Library /
  archive.org, catalogueofsurgi00matt), re-encoded for fast loading.
  Replace `public/catalog.pdf` with your own catalogue.
- Page sounds: "10 book page flips" by StarNinjas, CC0, opengameart.org.
