import {
	ButtonStyle,
	ChannelType,
	ComponentType,
	MessageType,
	type APIEmbed,
	type BaseMessageOptions,
	type Message,
	type Snowflake,
} from "discord.js";
import { setTimeout as wait } from "node:timers/promises";
import { client, defineEvent } from "strife.js";
import config from "../../common/config.js";
import constants from "../../common/constants.js";
import { getBaseChannel, reactAll } from "../../util/discord.js";
import { stripMarkdown } from "../../util/markdown.js";
import { normalize } from "../../util/text.js";
import { BOARD_EMOJI } from "../board/misc.js";
import { getSettings } from "../settings.js";
import autoreactions from "./autos-data.js";
import github from "./github.js";

import dad from "./dad.js";
import { getMatches, handleMatch } from "./scratch.js";
const REACTION_CAP = 3;

const ignoreTriggers = [
	/\bkill/i,
	/\bsuicid/i,
	/\bdepress/i,
	/\bpain/i,
	/\bsick/i,
	/\babus/i,
	/\bkms/i,
	/\bkys/i,
	/\bbleed/i,
];

const ignoredChannels = new Set<Snowflake>();
defineEvent("messageCreate", async (message) => {
	let reactions = 0;

	if (
		[
			MessageType.GuildBoost,
			MessageType.GuildBoostTier1,
			MessageType.GuildBoostTier2,
			MessageType.GuildBoostTier3,
		].includes(message.type)
	) {
		await message.react(BOARD_EMOJI).catch(() => void 0);
		reactions++;
	}

	const response = await handleMutatable(message);
	if (response === true) return;
	for (const [index, action] of [response].flat().entries()) {
		if (!action) break;

		if (typeof action === "number") {
			if (index === 0) {
				if (ignoredChannels.has(message.channel.id)) break;
				else ignoredChannels.add(message.channel.id);
			}
			await message.channel.sendTyping();
			await wait(action);
			if (index === 0) ignoredChannels.delete(message.channel.id);
			continue;
		}

		if (!autoResponses.has(message.id)) {
			const reply = await (message.system ?
				message.channel.send(action)
			:	message.reply(action));
			autoResponses.set(message.id, reply);
			continue;
		}

		const reply = await autoResponses
			.get(message.id)
			?.edit(action)
			.catch(() => void 0);
		if (!reply) break;
	}

	const settings = await getSettings(message.author);
	if (!settings.autoreactions || !canDoSecrets(message)) return;
	const content = stripMarkdown(normalize(message.content.toLowerCase()));
	reactionLoop: for (const [rawEmojis, ...requirements] of autoreactions) {
		let shouldReact = false;
		const emojis = [rawEmojis].flat();
		if (emojis.some((emoji) => content.includes(emoji.replace(/^<a?:_*/, "")))) continue;

		for (const requirement of requirements) {
			const [rawMatch, type] =
				Array.isArray(requirement) ? requirement : ([requirement, "word"] as const);
			const match = typeof rawMatch === "string" ? rawMatch : rawMatch.source;

			if (type === "ping") {
				shouldReact ||= message.mentions.has(match, {
					ignoreEveryone: true,
					ignoreRoles: true,
				});
			} else {
				const result = new RegExp(
					type === "partial" || type === "raw" ? match
					: type === "full" ? `^(?:${match})$`
					: `\\b(?:${match})${type === "plural" ? /(?:e?s)?/.source : ""}\\b`,
					"iu",
				).test(type === "raw" ? message.content : content);

				if (type === "negative" && result) continue reactionLoop;

				shouldReact ||= result;
			}
		}

		if (shouldReact) {
			reactions += emojis.length;
			const messageReactions = await reactAll(message, emojis);
			if (reactions > REACTION_CAP || messageReactions.length < emojis.length) return;
		}
	}
});

defineEvent("messageUpdate", async (_, message) => {
	if (message.partial) return;

	const found = autoResponses.get(message.id);
	if (!found && 1 > +"0" /* TODO: only return if there's new messages */) return;

	const response = await handleMutatable(message);
	const data =
		Array.isArray(response) ?
			response.find((item): item is BaseMessageOptions => typeof item === "object")
		:	typeof response === "object" && response;
	if (found)
		await found.edit(data || { content: constants.zws, components: [], embeds: [], files: [] });
	else if (data)
		autoResponses.set(
			message.id,
			await (message.system ? message.channel.send(data) : message.reply(data)),
		);
});

async function handleMutatable(
	message: Message,
): Promise<(BaseMessageOptions | number)[] | BaseMessageOptions | true | undefined> {
	const baseChannel = getBaseChannel(message.channel);
	if (config.channels.modlogs.id === baseChannel?.id) return;

	const settings = await getSettings(message.author),
		configuredSettings = await getSettings(message.author, false);
	const links = settings.github && github(message.content);
	if (links)
		return {
			content: links,
			components:
				configuredSettings.github === undefined ?
					[
						{
							components: [
								{
									customId: `github-${message.author.id}_toggleSetting`,
									type: ComponentType.Button as const,
									label: `Disable GitHub Links`,
									style: ButtonStyle.Success as const,
								},
							],
							type: ComponentType.ActionRow,
						},
					]
				:	[],
		};
	if (settings.scratchEmbeds) {
		const matches = getMatches(message.content);
		const embeds: APIEmbed[] = [];
		for (const match of matches) {
			const embed = await handleMatch(match);
			if (embed) {
				embeds.push(embed);
				if (configuredSettings.scratchEmbeds !== undefined)
					embed.footer = { text: "Disable this using /settings" };
			}
			if (embeds.length >= 5) break;
		}
		if (embeds.length)
			return {
				content: "",
				files: [],
				embeds,
				components:
					configuredSettings.scratchEmbeds === undefined ?
						[
							{
								components: [
									{
										customId: `scratchEmbeds-${message.author.id}_toggleSetting`,
										type: ComponentType.Button as const,
										label: "Disable Scratch Embeds",
										style: ButtonStyle.Success as const,
									},
								],
								type: ComponentType.ActionRow,
							},
						]
					:	[],
			};
	}

	const ignored = ignoreTriggers.some((trigger) => message.content.match(trigger));
	if (ignored) return true;

	if (!canDoSecrets(message, true)) return;
	const cleanContent = stripMarkdown(normalize(message.cleanContent.toLowerCase()));
	if (/^i[\S\W]?m\b/u.test(cleanContent)) {
		const name = cleanContent
			.split(
				/[\p{Ps}\p{Pe}\p{Pi}\p{Pf}𞥞𞥟𑜽،܀۔؛⁌᭟＂‽՜؟𑜼՝𑿿։꛴⁍፨"⸘‼՞᨟꛵꛳꛶•⸐!꛷𑅀,𖫵:⁃჻⁉𑅃፠⹉᙮𒑲‣⸏！⳺𐡗፣⳾𒑴⹍¡⳻𑂿，⳹𒑳〽᥄⁇𑂾､𛲟𒑱⸑𖺚፧𑽆、።፥𑇈⹓？𑽅꓾.፦𑗅߹;𑈼𖺗．፤𑗄︕¿𑈻⹌｡：𝪋⁈᥅𑅵᠂。；⵰﹗⹔𑻸᠈꓿᠄︖𑊩𑑍𖺘︓?၊𑑚᠃︔⸮။߸᠉⁏﹖𐮙︐︒;꘏𐮚︑𝪈𝪊꥟⸴﹒𝪉§⹁⸼﹕𑇞𝪇܂﹔𑇟﹐܁܆𑗏﹑꘎܇𑗐⸲܅𑗗꘍܄𑗕܉𑗖܃𑗑܈𑗓⁝𑗌⸵𑗍𑗎𑗔𑗋𑗊𑗒⸹؝𑥆𑗉…᠁︙․‥\n]+/gmu,
			)[0]
			.split(/\s/g)
			.slice(1)
			.map((word) => (word[0] ?? "").toUpperCase() + word.slice(1).toLowerCase())
			.join(" ");

		if (name && message.member)
			return [dad(name, message.member)].flat().map((item) =>
				typeof item === "string" ?
					{
						content: item,
						files: [],
						embeds: [],
						components: [],
						allowedMentions: { users: [], repliedUser: true },
					}
				:	item,
			);
	}
}

defineEvent("messageDelete", async (message) => {
	const found = autoResponses.get(message.id);
	if (found) await found.delete();

	const reference =
		found?.id ?? [...autoResponses.entries()].find(([, { id }]) => id === message.id)?.[0];
	if (reference) autoResponses.delete(reference);
});

const autoResponses = new Map<Snowflake, Message>();

function canDoSecrets(message: Message, checkDads = false): boolean {
	if (message.channel.isDMBased()) return false;
	if (
		message.mentions.has(client.user, {
			ignoreEveryone: true,
			ignoreRepliedUser: true,
			ignoreRoles: true,
		})
	)
		return true;

	if (checkDads) {
		const baseChannel = getBaseChannel(message.channel);
		if (
			(message.guild?.id === config.guilds.testing.id &&
				message.guild.id !== config.guild.id) ||
			!baseChannel ||
			baseChannel.type !== ChannelType.GuildText ||
			!/\bbots?\b/i.test(baseChannel.name)
		)
			return false;
	}

	return message.channel.id !== message.id && !message.author.bot;
}
