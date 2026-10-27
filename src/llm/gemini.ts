import { GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentParameters } from "@google/genai";
import { config } from "../config.js";
import { withRetry } from "./retry.js";
import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export class GeminiLlm implements LlmClient {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey?: string, model: string = "gemini-2.5-flash") {
    const key = apiKey || config.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is required to initialize GeminiLlm. Set it in .env or switch to LLM_MODE=mock."
      );
    }
    this.ai = new GoogleGenAI({ apiKey: key });
    this.model = model;
  }

  async generate(
    messages: LlmMessage[],
    tools?: ToolDefinition[]
  ): Promise<LlmResponse> {
    // 1. Convert internal LlmMessage format into GoogleGenAI Content format
    const contents: Content[] = messages.map((msg) => {
      if (msg.role === "user") {
        if (msg.toolResult) {
          return {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: msg.toolResult.name,
                  response: { output: msg.toolResult.result },
                },
              },
            ],
          };
        }
        return {
          role: "user",
          parts: [{ text: msg.text ?? "" }],
        };
      } else {
        // model role
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          return {
            role: "model",
            parts: msg.toolCalls.map((tc) => ({
              functionCall: {
                name: tc.name,
                args: tc.args,
              },
            })),
          };
        }
        return {
          role: "model",
          parts: [{ text: msg.text ?? "" }],
        };
      }
    });

    // 2. Prepare parameters
    const params: GenerateContentParameters = {
      model: this.model,
      contents,
    };

    if (tools && tools.length > 0) {
      const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      }));
      params.config = {
        tools: [{ functionDeclarations }],
      };
    }

    // 3. Invoke the Gemini model with exponential backoff retry on 429/5xx
    const response = await withRetry(() =>
      this.ai.models.generateContent(params)
    );

    // 4. Extract function calls or text response
    const rawFunctionCalls = response.functionCalls;
    const toolCalls: ToolCall[] | undefined =
      rawFunctionCalls && rawFunctionCalls.length > 0
        ? rawFunctionCalls.map((fc: any) => ({
            name: fc.name,
            args: (fc.args ?? {}) as Record<string, unknown>,
          }))
        : undefined;

    const result: LlmResponse = {
      text: response.text ?? undefined,
      toolCalls,
    };

    return result;
  }
}
