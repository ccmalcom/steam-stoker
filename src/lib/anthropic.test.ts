import { describe, it, expect } from "vitest";
import { claudeComplete, extractJson, AnthropicError } from "./anthropic";

const textResponse = (text: string) => new Response(JSON.stringify({
  content: [{ type: "text", text }], stop_reason: "end_turn",
}), { status: 200 });

describe("claudeComplete", () => {
  it("returns text for a plain completion", async () => {
    const out = await claudeComplete({
      apiKey: "K", system: "s", user: "u",
      fetchFn: async () => textResponse("hello"),
    });
    expect(out).toBe("hello");
  });
  it("runs the tool loop: executes handler, feeds result back", async () => {
    let call = 0;
    const out = await claudeComplete({
      apiKey: "K", system: "s", user: "u",
      tools: [{ name: "double", description: "", input_schema: { type: "object" } }],
      handlers: { double: async (inp: any) => ({ result: inp.x * 2 }) },
      fetchFn: async (_url, init) => {
        call++;
        if (call === 1) return new Response(JSON.stringify({
          content: [{ type: "tool_use", id: "t1", name: "double", input: { x: 21 } }],
          stop_reason: "tool_use",
        }), { status: 200 });
        const body = JSON.parse(init!.body as string);
        const toolResult = body.messages.at(-1).content[0];
        expect(toolResult.type).toBe("tool_result");
        expect(JSON.parse(toolResult.content)).toEqual({ result: 42 });
        return textResponse("done");
      },
    });
    expect(out).toBe("done");
    expect(call).toBe(2);
  });
  it("handler returning undefined is not misclassified as unknown tool", async () => {
    let call = 0;
    const out = await claudeComplete({
      apiKey: "K", system: "s", user: "u",
      tools: [{ name: "noOp", description: "", input_schema: { type: "object" } }],
      handlers: { noOp: async () => undefined },
      fetchFn: async (_url, init) => {
        call++;
        if (call === 1) return new Response(JSON.stringify({
          content: [{ type: "tool_use", id: "t1", name: "noOp", input: {} }],
          stop_reason: "tool_use",
        }), { status: 200 });
        const body = JSON.parse(init!.body as string);
        const toolResult = body.messages.at(-1).content[0];
        expect(toolResult.type).toBe("tool_result");
        const parsedContent = JSON.parse(toolResult.content);
        expect(parsedContent).toBe(null);
        expect(parsedContent).not.toEqual({ error: "unknown tool" });
        return textResponse("done");
      },
    });
    expect(out).toBe("done");
    expect(call).toBe(2);
  });
  it("unregistered tool name still produces unknown tool error", async () => {
    let call = 0;
    const out = await claudeComplete({
      apiKey: "K", system: "s", user: "u",
      tools: [{ name: "unknown", description: "", input_schema: { type: "object" } }],
      handlers: {},
      fetchFn: async (_url, init) => {
        call++;
        if (call === 1) return new Response(JSON.stringify({
          content: [{ type: "tool_use", id: "t1", name: "unknown", input: {} }],
          stop_reason: "tool_use",
        }), { status: 200 });
        const body = JSON.parse(init!.body as string);
        const toolResult = body.messages.at(-1).content[0];
        expect(toolResult.type).toBe("tool_result");
        expect(JSON.parse(toolResult.content)).toEqual({ error: "unknown tool" });
        return textResponse("done");
      },
    });
    expect(out).toBe("done");
    expect(call).toBe(2);
  });
  it("throws AnthropicError on HTTP failure", async () => {
    await expect(claudeComplete({
      apiKey: "K", system: "s", user: "u",
      fetchFn: async () => new Response("{}", { status: 401 }),
    })).rejects.toBeInstanceOf(AnthropicError);
  });
});

describe("extractJson", () => {
  it("parses bare JSON, fenced JSON, and JSON with surrounding prose", () => {
    expect(extractJson<number[]>("[1,2]")).toEqual([1, 2]);
    expect(extractJson<number[]>("```json\n[1,2]\n```")).toEqual([1, 2]);
    expect(extractJson<{ a: number }>('Here you go:\n{"a":1}\nEnjoy!')).toEqual({ a: 1 });
  });
});
