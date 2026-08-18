# SLEUTH — 404

A 404 page where the magnifying glass **is** your cursor. An investigator bird
walks to wherever you point, and the floor only gives up its case notes under
the glass.

No GIF, no images — the bird is inline SVG and the whole thing is three files.
Zero dependencies. Transform, opacity, and one clip-path.

- **Real magnification.** A second, sharper copy of the scene is clipped to a
  circle at the glass and scaled *about that same point*, so the circle is a
  fixed point of the transform: the disc can't drift off the ring.
- **A real walk.** Two bones per leg with a backward knee; the loop is told
  where each *foot* must be and solves the joint for it, so the planted foot
  stays planted while the body passes over it. Stride is advanced by distance
  travelled, never by a clock.
- **He can't moonwalk.** Facing is the direction of travel while he's moving;
  he only turns to look at the glass once he's stopped, pivoting through zero.
- Touch walks him to the tap, `prefers-reduced-motion` poses one still frame,
  and with JavaScript off it's still a working 404.

## Run it

Static. Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
```

Exported from the `96-sleuth` project of a larger multi-project repo, with the
absolute asset paths made relative so it can be served from a subpath.
