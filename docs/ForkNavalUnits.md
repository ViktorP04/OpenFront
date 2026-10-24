# Fork naval units

Coastal Battery and Submarine are available to every player, independently of
account levels. Find them in the build menu or select their icons in the hotbar.
They can be disabled with the existing disabled-unit lobby settings.

| Unit            | Starting cost | Role                                                                                                                                      |
| --------------- | ------------: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Coastal Battery |  200,000 gold | Capturable shoreline gun; 100-tile firing range, 3-second reload, 300 base damage. Detects submarines within 35 tiles.                    |
| Submarine       |  350,000 gold | 600-health naval raider; 55-tile torpedo range, 6-second reload, 450 base damage. Sinks shipping rather than capturing its trade revenue. |

Costs increase with construction count: batteries add 200,000 up to 800,000;
submarines add 350,000 up to 1,400,000. Existing infinite-gold settings apply.
Projectile damage uses the same deterministic damage roll as warship shells.

Build batteries on owned land immediately beside water, with normal structure
spacing. They take eight seconds to complete and give no defense-post land bonus.
They fire automatically on hostile ships and belong to whoever captures their
territory. They cannot bombard land buildings.

Build a submarine by selecting water reachable from one of your completed ports.
It launches at the nearest connected port and moves to the selected position,
where it holds its ambush station. Use the same click, touch, box-selection, and
select-all fleet controls used for warships to move it again. It cannot capture
land, has no automatic repair retreat, and does not gain warship veterancy.

A submarine is hidden from enemy rendering, health bars and hover UI while
submerged. Firing exposes it for five seconds. Enemy warships and completed
coastal batteries detect it within 35 tiles; warships can shoot revealed subs.
Owners, allies, and spectators can see submerged submarines. As with the rest of
OpenFront's deterministic simulation, stealth is a gameplay presentation/targeting
rule, not server-side secrecy from a modified client.

Both units record build/loss/capture stats and support snapshots, resumed games,
and replays. New enum, stat, and atlas entries are appended to preserve existing
indices. Bot nations continue using their existing build choices and can fight
submarines with their normal warships.

Balance values live in `packages/engine-lib/src/configuration/Config.ts`; costs
live in `packages/engine/src/configuration/EngineConfig.ts`. Icons are SVGs under
`resources/images`. Regenerate the appended atlas columns and submarine sprite
with `python scripts/buildForkUnitAssets.py` (requires Pillow). Regeneration is
idempotent and retains the original atlas columns pixel-for-pixel.
