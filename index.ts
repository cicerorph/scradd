import http from "node:http";
import path from "path";
import url from "url";

import {
	type Snowflake,
	PermissionsBitField,
	ApplicationCommandType,
	type ApplicationCommandData,
	ApplicationCommandOptionType,
	type ApplicationCommandAutocompleteNumericOptionData,
	type ApplicationCommandAutocompleteStringOptionData,
	type ApplicationCommandChannelOptionData,
	type ApplicationCommandNonOptionsData,
	type ApplicationCommandNumericOptionData,
	type ApplicationCommandStringOptionData,
	type Collection,
} from "discord.js";
import dotenv from "dotenv";

import pkg from "./package.json" assert { type: "json" };
import { importScripts } from "./util/files.js";

import type Command from "./common/types/command.js";
import type { Option } from "./common/types/command.js";
import type Event from "./common/types/event.js";
import type { ClientEvent } from "./common/types/event.js";

declare global {
	namespace NodeJS {
		interface ProcessEnv {
			GUILD_ID: Snowflake;
			BOT_TOKEN: string;
			NODE_ENV: "development" | "production";
			PORT?: `${number}`;
			CDBL_AUTH?: string;
		}
	}
}

dotenv.config();

const { default: client } = await import("./client.js");
const { default: CONSTANTS } = await import("./common/CONSTANTS.js");

const dirname = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * Convert our custom options format to something the Discord API will accept.
 *
 * @param options - The options to convert.
 *
 * @returns The converted options.
 */
function transformOptions(options: { [key: string]: Option }) {
	return Object.entries(options)
		.map(
			([name, option]) =>
				({
					autocomplete: option.autocomplete,
					channelTypes: option.channelTypes,

					choices:
						option.choices &&
						Object.entries(option.choices).map(([value, choice]) => ({
							name: choice,
							value,
						})),

					description: option.description,
					maxLength: option.maxLength,
					minLength: option.minLength,
					maxValue: option.max,
					minValue: option.min,
					name,
					type: option.type,
					required: option.required ?? false,
				} as
					| ApplicationCommandAutocompleteNumericOptionData
					| ApplicationCommandAutocompleteStringOptionData
					| ApplicationCommandChannelOptionData
					| ApplicationCommandNonOptionsData
					| ApplicationCommandNumericOptionData
					| ApplicationCommandStringOptionData),
		)
		.sort((one, two) =>
			one.required === two.required
				? two.name.localeCompare(one.name)
				: one.required
				? -1
				: 1,
		);
}

const { default: logError } = await import("./util/logError.js");

const promises = [
	importScripts(path.resolve(dirname, "./events")).then(
		(events: Collection<ClientEvent, Event>) => {
			for (const [event, execute] of events.entries()) {
				client.on(event, async (...args) => {
					try {
						await execute(...args);
					} catch (error) {
						await logError(error, event);
					}
				});
			}
		},
	),
	importScripts(path.resolve(dirname, "./commands")).then(
		async (commands: Collection<string, Command>) => {
			await client.application.commands.set(
				commands
					.filter((command): command is NonNullable<typeof command> => Boolean(command))
					.map(({ data }, name): ApplicationCommandData => {
						const type = data.type ?? ApplicationCommandType.ChatInput;
						return {
							description: data.description ?? "",

							defaultMemberPermissions: data.restricted
								? new PermissionsBitField()
								: undefined,

							type,

							name:
								type === ApplicationCommandType.ChatInput
									? name
									: name
											.split("-")
											.map(
												(word) =>
													(word[0] ?? "").toUpperCase() + word.slice(1),
											)
											.join(" "),

							options: data.options
								? transformOptions(data.options)
								: data.subcommands &&
								  Object.entries(data.subcommands).map(([subcommand, command]) => ({
										description: command.description,
										name: subcommand,

										options:
											command.options && transformOptions(command.options),

										type: ApplicationCommandOptionType.Subcommand,
								  })),
						};
					}),
				CONSTANTS.guild.id,
			);
		},
	),
	client.guilds.fetch().then(
		async (guilds) =>
			await Promise.all(
				guilds.map(async (otherGuild) => {
					if (otherGuild.id !== CONSTANTS.guild.id)
						await client.application.commands.set([], otherGuild.id).catch(() => {});
				}),
			),
	),
];

setInterval(() => {
	fetch(`${CONSTANTS.urls.usercountJson}?date=${Date.now()}`)
		.then(async (response) => await response.json())
		.then(({ count }: { count: number; _chromeCountDate: string }) => {
			CONSTANTS.channels.SA?.setName(
				`Scratch Addons - ${count.toLocaleString([], {
					compactDisplay: "short",
					maximumFractionDigits: 1,
					minimumFractionDigits: count > 999 ? 1 : 0,
					notation: "compact",
				})} users`,
				"Automated update to sync count",
			).catch((error) => logError(error, "setInterval(SA)"));
		});

	CONSTANTS.channels.info
		?.setName(
			`Info - ${CONSTANTS.guild.memberCount.toLocaleString([], {
				compactDisplay: "short",
				maximumFractionDigits: 2,
				minimumFractionDigits: CONSTANTS.guild.memberCount > 999 ? 2 : 0,
				notation: "compact",
			})} members`,
			"Automated update to sync count",
		)
		.catch((error) => logError(error, "setInterval(info)"));
}, 300_000);

if (process.env.NODE_ENV === "production") {
	const { cleanDatabaseListeners } = await import("./common/database.js");
	http.createServer(async (request, response) => {
		const requestUrl = new URL(request.url ?? "", `https://${request.headers.host}`);

		if (
			requestUrl.pathname === "/cleanDatabaseListeners" &&
			requestUrl.searchParams.get("auth") === process.env.CDBL_AUTH
		) {
			process.emitWarning("cleanDatabaseListeners called");
			cleanDatabaseListeners().then(() => {
				process.emitWarning("cleanDatabaseListeners ran");
				response.writeHead(200, { "Content-Type": "text/plain" }).end("Success");
			});
		} else {
			response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
		}
	}).listen(process.env.PORT ?? 443);
}

await Promise.all(promises);
if (process.env.NODE_ENV === "production") {
	const { default: log } = await import("./common/logging.js");
	await log(`🤖 Bot restarted on version **v${pkg.version}**!`, "server");
}

process
	.on("uncaughtException", (error, origin) => {
		logError(error, origin).catch(console.error);
	})
	.on("warning", (error) => {
		logError(error, "warning").catch(console.error);
	});
