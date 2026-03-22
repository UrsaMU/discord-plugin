/**
 * @module @ursamu/discord-plugin
 * @description Webhook-based Discord integration for UrsaMU.
 *
 * Install by adding to your game's `plugins.manifest.json`:
 * ```json
 * { "plugins": [{ "name": "discord", "url": "https://github.com/UrsaMU/discord-plugin", "ref": "v1.1.0" }] }
 * ```
 *
 * Or import directly in your game's plugin loader:
 * ```ts
 * import discordPlugin from "jsr:@ursamu/discord-plugin";
 * ```
 */
export { default } from "./src/index.ts";
