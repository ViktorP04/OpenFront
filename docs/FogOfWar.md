# Fog of War

Enable **Fog of War (shared allied vision)** in the advanced settings when hosting a lobby or starting a single-player game. It defaults to off. The setting is included in lobby summaries and saved game configuration.

Terrain stays visible. Outside current vision, ownership, units, map names, railroads, trails, and local combat effects disappear under a dark overlay. Ships leave temporary visibility trails: each tile they reveal stays visible for 10 seconds after it leaves their sight. This is live visibility, including ownership and units, and allows transport launches while it lasts. Trails expire in simulation time, so pausing freezes the countdown. Territory and structure coverage disappears immediately when lost. Allies and teammates share territory and unit vision; ending an alliance removes its coverage on the next tick.

- Owned territory reveals itself and extends vision 20 tiles beyond its border (Manhattan distance).
- Warships and transports reveal a circle of radius 35. Submarines reveal 70 tiles for coastal and inland scouting. Trade ships reveal only 10 tiles, leaving narrow visibility lines along active routes.
- Completed land structures and trains reveal a circle of radius 20. Projectiles never provide vision.
- Radar Stations start with a vision radius of 150 tiles. Upgrades extend coverage to 200 at level 2, 225 at level 3, and gradually toward 300 tiles. Each upgrade costs the current radar construction price and counts toward subsequent cost increases. They cost 300,000 gold initially, increasing by 300,000 per station to a maximum of 1,200,000, and take 12 seconds to build. They occupy ordinary owned land, can be captured, and use the normal structure upgrade controls. The placement preview shows the resulting coverage, including bulk upgrades. They are available only with Fog of War enabled and can also be disabled through unit settings.

Radar reveals surface activity; it does not defeat submarine stealth. A submarine must be both inside shared vision and detected by a warship within 15 tiles or a completed coastal battery within 35 tiles (or revealed by firing) to appear. Submarines default to Scout mode and hold fire until switched to Attack mode using the selected-fleet controls.

Warships and submarines can move into fog to scout. Transport destinations must be visible, including when using the transport hotkey. Clicking a hidden owner or opening its map action menu is blocked. Public diplomacy, match announcements, player roster, and aggregate leaderboard statistics remain public. Spectators, eliminated players, replay viewers, and the spawn phase have full visibility.

Transport visibility is enforced in the simulation for human players, nations, and tribes. A destination must be visible at launch; a transport already underway can continue after vision is lost. AI landing selection uses the same territory, ship, allied, radar, and recent ship-trail coverage as the client. Recent ship vision is preserved in snapshots and restored views. Hidden coasts are excluded from transport targeting, including Hard/Impossible beachhead attacks.

Nations use their normal, paid warships to scout unexplored water and coastlines before invading. Scout destinations use the public terrain map rather than hidden enemy ownership. They can build up to two ships for exploration and reuse idle ships, leaving ships in combat, repair retreat, or an ongoing voyage alone. Ports and warships must be enabled and affordable. Naval retaliation and sea-lane counter orders require sight of the relevant location. Games without fog keep the existing AI behavior.

This is a targeted approximation of playing with fog, not a full AI knowledge model: strategic decisions and other AI systems still have access to the simulation. Every client also still simulates the complete match, so fog does not conceal state from modified clients. It is a gameplay visibility rule rather than an anti-cheat boundary.
