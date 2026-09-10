# Booking landing page hero

The public home route `/` uses a silent 25.625-second film assembled from the user's nine accommodation photographs and two Bukchon street photographs. The single-property `/book/[id]` pages retain their own galleries and booking flow; the multi-property film is intentionally used on the shared landing page.

## Assets

- `public/videos/hanok-hero-v1.mp4`: H.264 / 1280 × 720 / 24 fps, fast-start, no audio and no burned-in text. Page copy remains responsive HTML.
- `public/videos/hanok-hero-poster.webp`: the opening street scene, displayed before playback and on media failure.

The film includes AI-composited fictional guests in three scenes. It is photo-based motion editing, not footage of actual guests. The source images were edited using built-in image generation; the source video project and prompts are in the sibling `hanok-video` workspace directory. Public serving requires only the two assets above, which are stored in this repository.

External photo credits: Bernard Gagnon (Bgag), CC0 1.0; photographed 27 September 2022; license checked 10 September 2026.

- https://commons.wikimedia.org/wiki/File:Bukchon_Hanok_Village_01.jpg
- https://commons.wikimedia.org/wiki/File:Bukchon_Hanok_Village_02.jpg
- https://creativecommons.org/publicdomain/zero/1.0/

## Behavior

Reduced-motion or data-saving visitors initially see the poster and may opt into playback. Other visitors get muted inline looping playback where permitted, with a pause control. Offscreen video and hidden tabs pause. A media failure leaves the poster and fully usable booking controls. Mobile shows the full 16:9 composition with the booking headline below, avoiding cropped portrait pairs.

The stay selector contains active properties from existing display metadata and sends visitors to the actual `/book/{slug}` route. Dates, availability and prices continue to come from the existing booking page, never from fabricated home-page data. Closed stays are omitted from the collection; opening-soon stays retain their existing informational page link.

This is the existing Next.js / Netlify application; no hosting provider, database, authentication or reservation integrations were migrated.
