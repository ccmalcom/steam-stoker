import { useState } from "react";

const fmt = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));

/** Half-step star rating (0.5–5). Each star has a left half (→ x.5) and right half (→ x.0)
 *  as click targets; hovering previews the fill. Read-only when no onChange is given.
 *  With showValue, a numeric readout (previewing the hovered value) follows the stars. */
export default function StarRating(
  { value, onChange, showValue }: { value: number; onChange?: (n: number) => void; showValue?: boolean }
) {
  const [hover, setHover] = useState(0);       // 0 = not hovering; previews the pending selection
  const shown = hover || value;
  return (
    <span
      className={`stars${onChange ? " interactive" : ""}`}
      role={onChange ? "slider" : undefined}
      aria-valuenow={value} aria-valuemin={0.5} aria-valuemax={5}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map(i => {
        const fill = shown >= i ? 100 : shown >= i - 0.5 ? 50 : 0;
        return (
          <span key={i} className="star-wrap">
            <span className="star-bg">☆</span>
            <span className="star-fg" style={{ width: `${fill}%` }}>★</span>
            {onChange && <>
              <button type="button" className="star-half left" aria-label={`${i - 0.5} stars`}
                onMouseEnter={() => setHover(i - 0.5)} onClick={() => onChange(i - 0.5)} />
              <button type="button" className="star-half right" aria-label={`${i} stars`}
                onMouseEnter={() => setHover(i)} onClick={() => onChange(i)} />
            </>}
          </span>
        );
      })}
      {showValue && <span className="star-value">{shown ? fmt(shown) : "—"}</span>}
    </span>
  );
}
