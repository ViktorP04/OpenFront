# Fork naval units

Coastal Battery and Submarine are available to every player, independently of
account levels. Find them in the build menu or select their icons in the hotbar.
They can be disabled with the existing disabled-unit lobby settings.

Custom additions sit at the far right of the bottom bar: Coastal Battery,
Submarine, then Radar Station (when Fog of War is enabled). Coastal Battery
defaults to **O**, Submarine to **J**, and Radar Station to **H**; all three can
be rebound in Settings > Hotkeys.
Existing custom bindings take precedence over newly added defaults.

| Unit            | Starting cost | Role                                                                                                                                                                   |
| --------------- | ------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coastal Battery |  200,000 gold | Capturable shoreline gun with 800 health; 40-tile starting firing range (upgradable toward 140), 3-second reload, 300 base damage. Detects submarines within 35 tiles. |
| Submarine       |  350,000 gold | 600-health naval raider; 70-tile vision, 55-tile torpedo range, 6-second reload, 450 base damage. Attacks military ships and transports; ignores trade ships.          |

Costs increase with construction count: batteries add 200,000 up to 800,000;
submarines add 350,000 up to 1,400,000. Existing infinite-gold settings apply.
Projectile damage uses the same deterministic damage roll as warship shells.

Build batteries on owned land immediately beside water, with normal structure
spacing. They take eight seconds to complete and give no defense-post land bonus.
They fire automatically on hostile ships and belong to whoever captures their
territory. Warships and submarines can destroy them with normal naval fire;
damaged batteries show health bars. In fog, ships target batteries they can see,
or batteries firing on their own fleet, within their weapon range. Friendly
batteries are ignored. Batteries cannot bombard other land buildings. Upgrade them through the same
build/upgrade controls as other structures. Range is `140 - 200 / (level + 1)`:
40 at level 1, about 73 at level 2, and 90 at level 3, with diminishing gains.
Damage, reload, and submarine-detection range stay unchanged. Each upgrade uses
the current battery construction price and increases the construction count.

Visible, completed batteries show SAM-style coverage circles when placing boats,
ports or batteries, hovering their build buttons, or selecting a fleet to move.
Circles use the battery's current level and ownership colors; fog-hidden batteries
are excluded. The battery placement preview shows the new or upgraded range.

Build a submarine by selecting water reachable from one of your completed ports.
It launches at the nearest connected port and moves to the selected position,
where it holds its ambush station. Use the same click, touch, box-selection, and
select-all fleet controls used for warships to move it again. It cannot capture
land, has no automatic repair retreat, and does not gain warship veterancy.

Submarines start in **Scout mode** and hold fire, even when attacked. Select one
or a group and use the **Submarine mode** button in the bottom HUD to enable
**Attack mode** or return to scouting. Mixed selections switch together. Switching
back to scouting does not cancel shots already fired or erase the five-second
firing reveal. Mode choices are saved and synchronized through normal intents.

A submarine is hidden from enemy rendering, health bars and hover UI while
submerged. Firing exposes it for five seconds. Enemy warships and completed
coastal batteries detect it within 35 tiles, while warships must approach within
15 tiles. Warships can shoot revealed subs.
Owners, allies, and spectators can see submerged submarines. As with the rest of
OpenFront's deterministic simulation, stealth is a gameplay presentation/targeting
rule, not server-side secrecy from a modified client.

Both units record build/loss/capture stats and support snapshots, resumed games,
and replays. New enum, stat, and atlas entries are appended to preserve existing
indices. Established AI nations occasionally supplement their normal build choices
with custom units, keeping at least twice the purchase cost in gold before buying.
They build up to two batteries and two radar stations (radar only with fog),
and upgrade their range up to level 3. They keep up to two submarines, sending
scouting subs to explore reachable water. Subs already in attack mode can head
toward visible military ships. Hidden
enemy units and trade ships are not used to choose submarine destinations.

Balance values live in `packages/engine-lib/src/configuration/Config.ts`; costs
live in `packages/engine/src/configuration/EngineConfig.ts`. The battery range
curve is shared with the renderer in `packages/engine-lib/src/game/NavalBalance.ts`.
Icons are SVGs under
`resources/images`. Regenerate the appended atlas columns and submarine sprite
with `python scripts/buildForkUnitAssets.py` (requires Pillow). Regeneration is
idempotent and retains the original atlas columns pixel-for-pixel.
