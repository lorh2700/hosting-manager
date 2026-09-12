# Booking landing page hero

The public home route `/` uses the user's supplied 30-second `한옥_영상_2.mp4`, compressed for silent background playback. The single-property `/book/[id]` pages retain their own galleries and booking flow; the film is used on the shared landing page.

## Assets

- `public/videos/hanok-hero-v2.mp4`: H.264 / 1280 × 720 / 30 fps, yuv420p, fast-start, no audio. Original duration, sequence and embedded ending title are retained. Page copy remains responsive HTML.
- `public/videos/hanok-hero-v2-poster.webp`: the opening landscape, displayed before playback and on media failure.
- Encoding: FFmpeg libx264, preset slow, CRF 25, Lanczos downscale, metadata stripped. The original 18,046,098-byte 1080p file is reduced to 3,427,900 bytes (81% smaller). Versioned asset paths avoid reusing cached footage and posters.

Public serving requires only the two v2 assets above, which are stored in this repository. The original supplied file is not needed at runtime.

## Previous version

The retained v1 assets are no longer referenced by the hero. That earlier photo-based film includes AI-composited fictional guests in three scenes, not footage of actual guests. Its source project and prompts are in the sibling `hanok-video` workspace directory. The following external photo credits apply to that previous version:

External photo credits: Bernard Gagnon (Bgag), CC0 1.0; photographed 27 September 2022; license checked 10 September 2026.

- https://commons.wikimedia.org/wiki/File:Bukchon_Hanok_Village_01.jpg
- https://commons.wikimedia.org/wiki/File:Bukchon_Hanok_Village_02.jpg
- https://creativecommons.org/publicdomain/zero/1.0/

## Behavior

Reduced-motion or data-saving visitors initially see the poster and may opt into playback. Other visitors get muted inline looping playback where permitted, with a pause control. Offscreen video and hidden tabs pause. A media failure leaves the poster and fully usable booking controls. Mobile shows the full 16:9 composition with the booking headline below, avoiding cropped portrait pairs.

The stay selector contains active properties from existing display metadata and sends visitors to the actual `/book/{slug}` route. Dates, availability and prices continue to come from the existing booking page, never from fabricated home-page data. Closed stays are omitted from the collection; opening-soon stays retain their existing informational page link.

This is the existing Next.js / Netlify application; no hosting provider, database, authentication or reservation integrations were migrated.
