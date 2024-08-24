import { aiModel, updateModels } from "./model-status.js";

export class AIChat {
	private apiUrl: string;
	private history: { role: string; content: string | any[]; type?: string }[] = [];
	private stickyMessages: { role: string; content: string | any[]; type?: string }[] = [];
	private maxMessages: number;

	constructor(apiUrl: string, maxMessages: number = 100) {
		this.apiUrl = apiUrl;
		this.maxMessages = maxMessages;
	}

	async send(message: string | any[], role: string = "user", type: "text" | "image" | "complex" = "text"): Promise<string> {
		this.inform(message, role, type);

		const response = await fetch(this.apiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: aiModel,
				messages: this.getEffectiveHistory(),
			}),
		});

		const data = (await response.json()) as any;
		const reply = data.choices?.[0].message.content;
		if (!reply) {
			await updateModels();
			if (aiModel != "All Down")
				return "[reply] Current model down. trying different model...";
		}

		this.inform(reply, "assistant", "text");

		return reply;
	}

	inform(content: string | any[], role: string = "system", type: "text" | "image" | "complex" = "text"): void {
		if (this.history.length >= this.maxMessages) {
			this.history.shift(); // Remove the oldest message
		}
		this.history.push({ role, content, type });
	}

	sticky(content: string | any[], role: string = "system", type: "text" | "image" | "complex" = "text"): void {
		this.stickyMessages.push({ role, content, type });
	}

	getChatHistory(): { role: string; content: string | any[]; type?: string }[] {
		return [...this.stickyMessages, ...this.history];
	}

	private getEffectiveHistory(): { role: string; content: string | any[]; type?: string }[] {
		// Combine sticky messages and history for the API request
		return [...this.stickyMessages, ...this.history];
	}
}
