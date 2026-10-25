# Reconnaissance satellite

Available with Fog of War, at the far right of the build bar and in the build
menu. Requires an owned, completed missile silo with a ready launch slot.
It costs 1,000,000 gold initially, increasing by 1,000,000 for additional
satellites up to 4,000,000 gold per launch. Infinite gold and disabled-unit
settings apply. Launching consumes one silo slot and its normal reload time.

Select Satellite and point anywhere on the map, including hidden areas, water,
or impassable terrain. The nearest ready silo is chosen, with unit ID breaking
equal-distance ties. The line from that silo through the target fixes the
direction. A zero-length direction is invalid. The placement preview shows a
160-tile coverage circle and a cyan orbit path with direction arrows, split at
map seams. It previews one circuit along the orbit's dominant axis.

The satellite starts at the silo and moves one tile per simulation tick along
its dominant axis (10 tiles per second). It wraps to the opposite map edge
instead of turning or stopping. On these rectangular maps, the orbit wraps
both horizontally and vertically; diagonal orbits may shift their ground track
between circuits. The selected target is a direction marker, not a stopping
point. There is no retargeting or fuel limit. Losing the silo does not affect an
already launched satellite; it disappears when its owner is eliminated.

Satellites reveal live ownership and units in a moving 160-tile circle, including
coverage across map seams. Allies share the coverage, and AI transport targeting
uses the same vision. Satellites do not leave ship-vision trails, cause damage,
break alliances, or detect submerged submarines. They are untargetable orbital
units, not missiles that SAM launchers intercept.

Orbit state is included in normal snapshots, resumed games, and replays. Unit,
stats, and atlas entries are appended so existing indices keep their meaning.
Regenerate the fork's appended sprite/icon atlas columns with
`python scripts/buildForkUnitAssets.py` (Pillow required).
