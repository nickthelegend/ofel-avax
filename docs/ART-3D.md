# Ofel 3D art kit

- **Material:** smoked obsidian glass, very dark moss-black and slightly translucent, with a thin glowing seam of warm "first light", small bone-white details and a soft first-light rim light; rounded bevelled edges, gentle toy-like proportions.
- **Palette:** obsidian `#11130f` (objects), bone `#ebe5d8` (details), first light `#f0b9a0` (seams, glow, rim light).
- **Face:** only where it fits: two tiny bone-white closed eyes drawn as short curves (sleeping = sealed); the "opened" object gets two tiny round open eyes instead; the error seal gets worried closed eyes. No face on the eclipse, validators, key, coins or mark.
- **Background:** transparent, no ground shadow (objects sit on dark or light surfaces).
- **Subjects:** hero (sealed obsidian envelope/ticket, closed eyes), eclipse (dark disc over a ring of first light, the batch clock), validators (three monoliths with light seams), key (first-light key with obsidian bow), coins (four bone coins with obsidian rims), lens (auditor's lens, open eyes), empty (empty tray, closed eyes), opened (envelope opened with light spilling out, open eyes), cracked (cracked seal with a broken light seam, error state), mark (obsidian disc with a crescent of first light on its lower edge, logo candidate).

Style line used in every prompt: "smoked obsidian glass 3D render in #11130f with #ebe5d8 details and a soft #f0b9a0 rim light, a thin glowing #f0b9a0 seam of light, soft studio lighting, crisp reflections, rounded bevelled edges, gentle toy-like proportions, centred, transparent background (no background, no ground shadow), square 1024x1024, no text, no letters, no logos."

Ship round (Nov 12–13), same style line, one fresh ChatGPT chat: **block** (three sealed envelopes bound by a band of
first light, closed eyes on the top one; landing hero, 880 px), **hourglass** (the batch clock, step 2), **scale** (one
fair price, step 3), **desk** (obsidian tablet with a first-light price line, "try it" section), **proof** (wax-seal
medallion with a first-light check, "check it yourself"), and **og-bg** (1536×1024 scene for the social card;
`scripts/qa/og.mjs` lays real type over it into `web/public/og.jpg`, so no generated text). Each file is trimmed,
padded square and under 75 KB; every `<img>` has width and height.

Files: `web/public/art/<name>.webp` (640 px, transparent).

3D art generated with ChatGPT

Film round (Nov 14), same style line, one fresh ChatGPT chat in Nick's Chrome: **exposed** (a clear glass envelope with
its coins in plain view under a spotlight, worried eyes; the public-book side of "Why sealed"), **vault** (an obsidian
chain block holding a sealed envelope; "the chain stores ciphertext"), **orb** (a sealed obsidian orb, closed eyes; a
commitment, "Who sees what"), **receipt** (an obsidian receipt with a first-light check; the live receipt panel),
**node** (an obsidian server node with an antenna; the public RPC panel) and **ladder** (a public order book as clear
glass depth bars with coins on each, worried eyes; "Compared"). The first ladder came back with a painted checkerboard
instead of transparency and was regenerated. Same processing: trimmed, padded square, 640 px WebP under 75 KB.
