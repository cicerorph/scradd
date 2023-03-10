import CONSTANTS from "./CONSTANTS.js";

import type AddonManifest from "./types/addonManifest.js";

export const manifest = await fetch(`${CONSTANTS.urls.saSource}/manifest.json`).then(
	async (response) => await response.json<chrome.runtime.Manifest>(),
);

const addonIds = await fetch(`${CONSTANTS.urls.saSource}/addons/addons.json`).then(
	async (response) => await response.json<string[]>(),
);

export const addons = await Promise.all(
	addonIds
		.filter((item) => !item.startsWith("//"))
		.map(
			async (addonId) =>
				await fetch(
					`${CONSTANTS.urls.saSource}/addons/${encodeURI(addonId)}/addon.json`,
				).then(async (response) => ({
					...(await response.json<AddonManifest>()),

					id: addonId,
				})),
		),
);
