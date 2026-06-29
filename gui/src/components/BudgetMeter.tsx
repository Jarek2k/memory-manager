import { useStore, projectedLines } from "../store";
import { Help } from "./Tooltip";

export function BudgetMeter() {
  const { inv, cartList } = useStore();
  if (!inv) return null;
  const b = inv.budget;
  const cur = b.current_lines;
  const proj = projectedLines(inv, cartList);
  const limit = b.soft_limit_lines;
  const cls = cur > limit ? "red" : cur >= b.warn_threshold_lines ? "amber" : "";
  const over = proj > limit;
  return (
    <span className="budget">
      <span style={{ color: "var(--faint)" }}>Global</span>
      <span className="bar">
        <span className={"fill " + cls} style={{ transform: `scaleX(${Math.min(1, cur / limit)})` }} />
        {proj !== cur && <span className="marker" style={{ left: Math.min(100, (proj / limit) * 100) + "%" }} />}
      </span>
      <span className="num tabnum">
        {proj !== cur ? <>{cur} → <b className={over ? "over" : ""}>{proj}</b> / {limit}</> : <>{cur} / {limit}</>}
      </span>
      <Help text={`Zeilen, die jede Session global laden (CLAUDE.md + rules/*). Warnung ab ${b.warn_threshold_lines}, Limit ${limit}.`} />
    </span>
  );
}
