import type { GuildMember } from "discord.js";
import config from "../../common/config.js";
import tryCensor, { censor, isPingable } from "./misc.js";
import { warn } from "./automod.js";

export default async function changeNickname(member: GuildMember): Promise<void> {
	const censored = tryCensor(member.displayName);
	const newNick = findName(member);

	if (censored && member.nickname)
		await warn(
			member,
			censored.words.length === 1 ? "Used a banned word" : "Used banned words",
			censored.strikes,
			"Set nickname to " + member.displayName,
		);

	if (newNick !== member.displayName) {
		const unpingable = isPingable(member.displayName);
		await setNickname(
			member,
			newNick,
			`${censored ? "Has bad words" : ""}${censored && unpingable ? "; " : ""}${
				unpingable ? "Unpingable" : ""
			}`,
		);
		return;
	}

	const members = (await config.guild.members.fetch({ query: newNick, limit: 100 })).filter(
		(found) => found.displayName === newNick,
	);

	if (members.size > 1) {
		const [safe, unsafe] = members.partition((found) => found.user.displayName === newNick);

		if (safe.size) {
			for (const [id, found] of unsafe) {
				const nick = censor(found.user.displayName);
				if (nick !== found.displayName && isPingable(nick)) {
					await setNickname(found, nick, "Conflicts");
					unsafe.delete(id);
				}
			}
		}

		const unchanged = safe
			// eslint-disable-next-line unicorn/prefer-spread -- This is not an array
			.concat(unsafe)
			.toSorted((one, two) => (two.joinedTimestamp ?? 0) - (one.joinedTimestamp ?? 0));

		if (unchanged.size > 1 && unchanged.has(member.id)) {
			const nick = censor(member.user.displayName);
			if (nick !== newNick && isPingable(nick)) {
				await setNickname(member, nick, "Conflicts");
				unchanged.delete(member.id);
			}
		}
		if (unchanged.size > 1) {
			for (const found of unchanged.values()) {
				const nick = censor(found.user.username);
				if (nick !== found.displayName && isPingable(nick)) {
					await setNickname(found, nick, "Conflicts");
					unchanged.delete(found.id);
				}
			}
		}

		if (unchanged.size === 2) {
			const oldest = unchanged.firstKey();
			if (oldest) unchanged.delete(oldest);
		}
	}
}

async function setNickname(
	member: GuildMember,
	newNickname: string,
	reason: string,
): Promise<void> {
	await (member.moderatable && newNickname.length <= 32
		? member.setNickname(member.user.displayName === newNickname ? null : newNickname, reason)
		: void 0);
}

function findName(member: GuildMember): string {
	const nick = censor(member.displayName);
	if (isPingable(nick)) return nick;

	const user = censor(member.user.displayName);
	if (isPingable(user)) return user;

	const tag = censor(member.user.tag);
	if (isPingable(tag)) return tag;

	return nick;
}
