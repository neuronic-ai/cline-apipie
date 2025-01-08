import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import axios from "axios"

interface ApipieCompletionUsage extends OpenAI.CompletionUsage {
	prompt_characters?: number
	response_characters?: number
	latency_ms?: number
	cost?: number
}

interface ApipieStreamResponse extends Omit<OpenAI.Chat.ChatCompletionChunk, "usage"> {
	usage?: ApipieCompletionUsage
}

interface ApipieModel {
	enabled: number
	available: number
	modelType: string
	subtype: string
	provider: string
	id: string
	model: string
	route: string
	description: string
	max_tokens: number
	max_response_tokens: number
	input_cost: number
	output_cost: number
}

export class ApipieHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private models: ApipieModel[] = []
	private modelInfo: ApipieModel | null = null

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://apipie.ai/v1",
			apiKey: this.options.apipieApiKey,
		})
		
	}

	async clearMemory(sessionId: string): Promise<void> {
		const data = {
			memory: true,
			mem_clear: 1,
			mem_session: sessionId,
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "clear" }],
		}
		
		try {
			const response = await axios.post("https://apipie.ai/v1/chat/completions", data, {
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": this.options.apipieApiKey || "",
				},
			})
		} catch (error) {
			if (axios.isAxiosError(error)) {
				throw new Error(`Failed to clear memory: ${error.response?.status} ${error.response?.data || error.message}`)
			}
			throw error
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Check if we need to clear memory first
		if (this.options.apipieClearMemory) {
			const sessionId = this.options.apipieMemorySession || "cline-1";
			try {
				await this.clearMemory(sessionId);
				console.log(`[APIpie] Memory cleared for session: ${sessionId}`);
				
				// Reset the flag after clearing memory to prevent clearing on every request
				this.options.apipieClearMemory = false;
			} catch (error) {
				console.error(`[APIpie] Failed to clear memory: ${error}`);
			}
		}
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Fetch model info if we haven't already
		if (!this.modelInfo) {
			try {
				const response = await axios.get("https://apipie.ai/v1/models", {
					headers: {
						"X-API-Key": this.options.apipieApiKey || "",
					},
				})
				const models = response.data
				this.modelInfo = models.data.find((m: ApipieModel) => {
					if (m.available === 1 && m.max_response_tokens >= 8000) {
						m.model = `${m.provider}/${m.id}`
						return `${m.provider}/${m.id}` === this.options.apiModelId
					}
					return false
				})
				if (!this.modelInfo) {
					throw new Error(`Model not found or unavailable: ${this.options.apiModelId}`)
				}
			} catch (error) {
				if (axios.isAxiosError(error)) {
					throw new Error(`Failed to fetch models: ${error.response?.status} ${error.response?.data || error.message}`)
				}
				throw error
			}
		}

		// Create parameters object with APIpie-specific options
		const params = {
			model: `${this.modelInfo.provider}/${this.modelInfo.id}`,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
			memory: this.options.apipieMemory ?? true,
			mem_session: this.options.apipieMemorySession || "cline-1",
			mem_expire: this.options.apipieMemoryExpire || 15,
			mem_msgs: this.options.apipieMemoryMsgs || 10,
			integrity: this.options.apipieIntegrity || 11,
		};
		
		// Use type assertion to bypass TypeScript's type checking for APIpie custom parameters
		const stream = await (this.client.chat.completions.create as any)(params);

		// Process the stream
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}
			
			if (chunk.usage) {
				// Convert cost to number if it's a string
				const cost = (chunk.usage as ApipieCompletionUsage).cost;
				const costValue = typeof cost === "string" ? parseFloat(cost) : cost;
				
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					totalCost: costValue || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.modelInfo?.route || this.options.apiModelId || "openai/gpt-4o-mini",
			info: {
				maxTokens: this.modelInfo?.max_tokens || 128000,
				contextWindow: this.modelInfo?.max_response_tokens || 8192,
				supportsImages: false,
				supportsPromptCache: true,
				inputPrice: this.modelInfo?.input_cost || 0,
				outputPrice: this.modelInfo?.output_cost || 0,
				description: this.modelInfo?.description,
			},
		}
	}
}
