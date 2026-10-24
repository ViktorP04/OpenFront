# Fog of War

Enable **Fog of War (shared allied vision)** in the advanced settings when hosting a lobby or starting a single-player game. It defaults to off. The setting is included in lobby summaries and saved game configuration.

Terrain stays visible. Outside current vision, ownership, units, map names, railroads, trails, and local combat effects disappear under a dark overlay. There is no explored-map memory: losing vision hides the area again. Allies and teammates share territory and unit vision; ending an alliance removes its coverage on the next tick.

- Owned territory reveals itself and extends vision 12 tiles beyond its border (Manhattan distance).
- Warships, submarines, and transports reveal a circle of radius 35. Trade ships reveal only 10 tiles, so dedicated scouts are needed to explore safely.
- Completed land structures and trains reveal a circle of radius 20. Projectiles never provide vision.
- Radar Stations reveal a circle of radius 150. They cost 300,000 gold initially, increasing by 300,000 per station to a maximum of 1,200,000, and take 12 seconds to build. They occupy ordinary owned land, can be captured, and cannot be upgraded. They are available only with Fog of War enabled and can also be disabled through unit settings.

Radar reveals surface activity; it does not defeat submarine stealth. A submarine must be both inside shared vision and detected by the existing warship/coastal-battery rules (or revealed by firing) to appear.

Warships and submarines can move into fog to scout. Transport destinations must be visible, including when using the transport hotkey. Clicking a hidden owner or opening its map action menu is blocked. Public diplomacy, match announcements, player roster, and aggregate leaderboard statistics remain public. Spectators, eliminated players, replay viewers, and the spawn phase have full visibility.

This is client gameplay fog. Every client still simulates the complete match, and the existing AI continues to use complete simulation information. It does not protect hidden state from modified clients and should not be treated as an anti-cheat boundary. Authoritative hidden information and vision-limited AI would be separate follow-up work.
