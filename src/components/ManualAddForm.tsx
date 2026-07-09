import { useState } from "react";
import { addManualGame, validateManualInput, type ManualGameInput } from "../lib/manual";

export default function ManualAddForm({ onAdded }: { onAdded: () => void }) {
  const [input, setInput] = useState<ManualGameInput>({
    title: "", platform: "xbox", playtimeHours: 0, rating: null, review: null });
  const [msg, setMsg] = useState("");

  async function submit() {
    const errs = validateManualInput(input);
    if (errs.length) { setMsg(errs.join("; ")); return; }
    await addManualGame(input);
    setMsg(`Added "${input.title}".`);
    setInput({ title: "", platform: input.platform, playtimeHours: 0, rating: null, review: null });
    onAdded();
  }

  return (
    <div className="card">
      <strong>Add a non-Steam game</strong>
      <div className="row">
        <input placeholder="Title" value={input.title}
          onChange={e => setInput({ ...input, title: e.target.value })} style={{ flex: 2 }} />
        <select value={input.platform}
          onChange={e => setInput({ ...input, platform: e.target.value as ManualGameInput["platform"] })}>
          {["xbox", "psn", "epic", "ea", "other"].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="number" min={0} placeholder="Hours" value={input.playtimeHours || ""}
          onChange={e => setInput({ ...input, playtimeHours: Number(e.target.value) })} style={{ width: "5rem" }} />
        <select value={input.rating ?? ""} onChange={e =>
          setInput({ ...input, rating: e.target.value ? Number(e.target.value) : null })}>
          <option value="">no rating</option>
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{"★".repeat(n)}</option>)}
        </select>
      </div>
      <textarea placeholder="Review (optional)" rows={2} value={input.review ?? ""}
        onChange={e => setInput({ ...input, review: e.target.value || null })} />
      <div className="row"><button onClick={submit}>Add</button><span>{msg}</span></div>
    </div>
  );
}
