import { describe, it, expect } from "vitest";
import { STEP_ORDER, nextStep } from "./onboarding";

describe("wizard steps", () => {
  it("walks welcome→steam_key→steam_id→folders→sync→sprint→bounced→done", () => {
    expect(STEP_ORDER).toEqual(["welcome", "steam_key", "steam_id", "folders", "sync", "sprint", "bounced", "done"]);
    expect(nextStep("welcome")).toBe("steam_key");
    expect(nextStep("bounced")).toBe("done");
    expect(nextStep("done")).toBe("done");
  });
});
