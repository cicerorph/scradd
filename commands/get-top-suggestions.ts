import { SlashCommandBuilder, cleanContent, GuildMember, hyperlink } from "discord.js";
import CONSTANTS from "../common/CONSTANTS.js";
import { escapeLinks } from "../util/markdown.js";
import { getAllMessages, paginate } from "../util/discord.js";
import { truncateText } from "../util/text.js";
import type { ChatInputCommand } from "../common/types/command.js";
import Database from "../common/database.js";
import { guild } from "../client.js";

export const suggestionAnswers = [
	"Unanswered",
	"Good Idea",
	"Implemented",
	"In Development",
	"Incompatible",
	"Impractical",
	"Rejected",
	"Impossible",
] as const;

export const suggestionsDatabase = new Database("suggestions");
await suggestionsDatabase.init();

const old = CONSTANTS.channels.old_suggestions
	? (await getAllMessages(CONSTANTS.channels.old_suggestions)).map((message) => {
			const embed = message.embeds[0];

			const segments = message.thread?.name.split(" | ");

			return {
				answer:
					suggestionAnswers.find((answer) =>
						[segments?.[0]?.toLowerCase(), segments?.at(-1)?.toLowerCase()].includes(
							answer?.toLowerCase(),
						),
					) || suggestionAnswers[0],

				author:
					(message.author.id === CONSTANTS.robotop
						? message.embeds[0]?.footer?.text.split(": ")[1]
						: /\/(?<userId>\d+)\//.exec(message.embeds[0]?.author?.iconURL ?? "")
								?.groups?.userId) || message.author.id,

				count:
					(message.reactions.valueOf().first()?.count ?? 0) -
					(message.reactions.valueOf().at(1)?.count ?? 0),

				url: message.url,

				title: truncateText(
					embed?.title ??
						(embed?.description && cleanContent(embed?.description, message.channel)) ??
						(embed?.image?.url ? embed?.image?.url : message.content),
					100,
				),
			};
	  })
	: [];

const command: ChatInputCommand = {
	data: new SlashCommandBuilder()
		.setDescription("Get the top suggestions")
		.addUserOption((input) =>
			input
				.setName("user")
				.setDescription("Filter suggestions to only get those by a certain user"),
		)
		.addStringOption((option) =>
			option
				.setName("answer")
				.setDescription("Filter suggestions to only get those with a certain answer")
				.addChoices(
					...suggestionAnswers.map((answer) => ({ name: answer, value: answer })),
				),
		),

	async interaction(interaction) {
		const author = interaction.options.getMember("user");
		const answer = interaction.options.getString("answer");
		const { suggestions } = CONSTANTS.channels;

		const nick = author instanceof GuildMember && author?.displayName;

		await paginate(
			[old, suggestionsDatabase.data]
				.flat()
				.filter(
					(item) =>
						!(
							(answer && item.answer !== answer) ||
							(author instanceof GuildMember && item.author !== author.id)
						),
				)
				.sort((suggestionOne, suggestionTwo) => suggestionTwo.count - suggestionOne.count),
			(suggestion) =>
				`**${suggestion.count}** ${
					suggestions?.defaultReactionEmoji?.name ||
					`<:${suggestions?.defaultReactionEmoji?.name}:${suggestions?.defaultReactionEmoji?.id}>`
				} ${hyperlink(
					escapeLinks(suggestion.title),
					"url" in suggestion
						? suggestion.url
						: `https://discord.com/channels/${guild.id}/${suggestion.id}/${suggestion.id}`,
					suggestion.answer,
				)}${nick ? "" : ` by <@${suggestion.author}>`}`,
			"No suggestions found. Try changing any filters you may have used.",
			`Top suggestions${nick ? ` by ${nick}` : ""}${
				answer ? `${nick ? " &" : ""} answered with ${answer}` : ""
			}`,
			(data) => interaction[interaction.replied ? "editReply" : "reply"](data),
		);
	},
};
export default command;
