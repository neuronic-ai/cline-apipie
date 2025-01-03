import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

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
	type: string
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

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Add cache control for file contents and system messages
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

		// Add system message with cache control
		openAiMessages.push({
			role: "system",
			content: [
				{
					type: "text",
					text: systemPrompt,
					// @ts-ignore-next-line
					cache_control: { type: "ephemeral" },
				},
			],
		})

		// Convert messages
		const convertedMessages = convertToOpenAiMessages(messages)
		openAiMessages.push(...convertedMessages)

		// Add cache control to the last two user messages
		const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
		lastTwoUserMessages.forEach((msg) => {
			if (typeof msg.content === "string") {
				msg.content = [
					{
						type: "text",
						text: msg.content,
						// @ts-ignore-next-line
						cache_control: { type: "ephemeral" },
					},
				]
			} else if (Array.isArray(msg.content)) {
				const lastTextPart = msg.content.filter((part) => part.type === "text").pop()
				if (lastTextPart) {
					// @ts-ignore-next-line
					lastTextPart.cache_control = { type: "ephemeral" }
				}
			}
		})

		// Add cache control to file content in tool messages
		openAiMessages.forEach((msg) => {
			if (
				msg.role === "tool" &&
				typeof msg.content === "string" &&
				(msg.content.includes("<file_content") || msg.content.includes("<final_file_content"))
			) {
				msg.content = [
					{
						type: "text",
						text: msg.content,
						// @ts-ignore-next-line
						cache_control: { type: "ephemeral" },
					},
				]
			}
		})

		// Fetch model info if we haven't already
		if (!this.modelInfo) {
			const response = await fetch("https://apipie.ai/v1/models?subtype=chatx,meta,code", {
				headers: {
					"X-API-Key": this.options.apipieApiKey || "",
				},
			})
			const models = await response.json()
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
		}

		// @ts-ignore-next-line
		const stream = await this.client.chat.completions.create({
			model: `${this.modelInfo.provider}/${this.modelInfo.id}`,
			temperature: 0,
			messages: openAiMessages,
			stream: true,
			transforms: ["middle-out"],
			response_format: { type: "text" },
		})

		for await (const chunk of stream) {
			const apipieChunk = chunk as ApipieStreamResponse
			const delta = apipieChunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (apipieChunk.usage) {
				yield {
					type: "usage",
					inputTokens: apipieChunk.usage.prompt_tokens || 0,
					outputTokens: apipieChunk.usage.completion_tokens || 0,
					totalCost: apipieChunk.usage.cost || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.modelInfo?.route || this.options.apiModelId || "openai/gpt-4o-mini",
			info: {
				maxTokens: this.modelInfo?.max_tokens || 128000,
				contextWindow: this.modelInfo?.max_response_tokens || 4096,
				supportsImages: false,
				supportsPromptCache: true,
				inputPrice: this.modelInfo?.input_cost || 0,
				outputPrice: this.modelInfo?.output_cost || 0,
				description: this.modelInfo?.description,
			},
		}
	}
}
