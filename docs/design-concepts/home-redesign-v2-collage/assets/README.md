# TeachInspire dashboard collage assets

These four files are the only raster assets required by the selected dashboard.
All navigation, icons, labels, buttons, borders, and activity cards should remain
live HTML/CSS/SVG.

| Workshop | 1x | 2x | Alt text |
| --- | --- | --- | --- |
| Prompts | `workshop-prompts.webp` | `workshop-prompts@2x.webp` | A teaching need transformed into a structured prompt |
| Audio | `workshop-audio.webp` | `workshop-audio@2x.webp` | A waveform, microphone, play control, and two faceless speakers |
| Documents | `workshop-documents.webp` | `workshop-documents@2x.webp` | One source transformed into a worksheet, guide, and answer key |
| Formation | `workshop-training.webp` | `workshop-training@2x.webp` | Faceless participants following a course path toward a calendar date |

## Delivery specification

- Ratio: `11 / 5`
- 1x: `660 × 300`
- 2x: `1320 × 600`
- Format: WebP
- Suggested display: `aspect-ratio: 11 / 5; object-fit: cover`
- Human rule: blank paper-cut heads only; no facial features

```html
<img
  src="/images/workshops/workshop-prompts.webp"
  srcset="/images/workshops/workshop-prompts.webp 660w,
          /images/workshops/workshop-prompts@2x.webp 1320w"
  sizes="(max-width: 760px) 100vw, 370px"
  width="660"
  height="300"
  alt="A teaching need transformed into a structured prompt"
  decoding="async"
/>
```

The first visible workshop image may load eagerly. Use `loading="lazy"` on the
remaining three.
