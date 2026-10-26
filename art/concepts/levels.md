# New terrain art

Three environment illustrations generated with Codex's built-in image generation tool.
Full prompts and asset paths are in [level-prompts.json](./level-prompts.json).

| Level       | Terrain direction                                                             | Artwork                                      |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| Frostgate   | Alpine snow terraces, cyan glacial ravine, steel bridge and research outpost  | [PNG](../../public/art/maps/frostgate.png)   |
| Amberfen    | Autumn peat islands, amber reeds, braided channels, causeways and fords       | [PNG](../../public/art/maps/amberfen.png)    |
| Cinderreach | Black-sand coast, basalt terraces, geothermal pools and industrial ramp roads | [PNG](../../public/art/maps/cinderreach.png) |

The original ImageGen PNGs and `*-v2.png` refinements are preserved as concepts.
Exact refinement prompts are in [level-refinement-prompts.json](./level-refinement-prompts.json).
The homepage now uses `*-field-v3.webp` and `*-field-card-v3.webp`: 1920 × 1080
Blender renders of the actual game GLBs on sampled playable terrain, with 640 × 360
thumbnails. This keeps the new maps in Skerry Front's sculpted visual style.
Full-resolution PNG masters are preserved beside the WebPs.

All three are playable in solo and cooperative operations. Choose a map on the
entrance screen, then enroll and launch it from the operation menu. Lobby hosts
choose a shared battlefield before launch. The original Skerry Front remains
available, and pre-existing battles retain their original geography.

Playable geography is generated from the persisted map ID and seed, with shared
server/client height, movement, buildability and minimap rules. Enemy bases, ore
and exits are placed on reachable ground. The homepage shows seed 947 with a
staged field outpost; an operation's seed and construction determine its layout.

`art/biomes.blend` and `art/blender/create_biomes.py` contain eleven instanced
landscape assets: glacial shelves and scree, amber and russet birches, fen reeds,
basalt columns and scree, plus snow-free versions of Skerry's two granites,
coastal spruce and juniper. Broad authored faces, continuous caps, restrained
vertex colours and 0.9 roughness match the shared landscape kit. The snow-free
variants preserve the original geometry and transforms.

`pnpm art:tactical biomes` regenerates this kit's Blender source and GLBs.
`pnpm art:tactical biome-cards` samples shared terrain, renders the three views,
and encodes homepage artwork (requires Blender and Python Pillow). Intermediate
terrain JSON and renders live in ignored `outputs/biome-review/`.

`lib/landscape-dressing.ts` places ice along glacial banks and basalt along cliff
faces while keeping crossings and ramp mouths clear. Amberfen reeds grow along
wet ground, with dry granite and shrubs under its tree canopy. Terrain shaders,
water and snow use restrained biome palettes. Buildings, bridges and vehicles
remain part of the shared military kit.

Development renderer previews support `/?artReview=1&map=frostgate` (also
`amberfen` and `cinderreach`), with an optional `seed`. Production uses real
operations through the normal homepage.

All three share an elevated RTS view, Nordic utility architecture and restrained modern
field equipment. Distinct palettes and terrain silhouettes establish each map's identity.
