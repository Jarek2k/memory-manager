import { Sparkles, UserRound } from "lucide-react";
import { useStore } from "../store";
import { Card } from "../components/Card";
import { TypeSectionHead } from "../components/TypeBadge";

/** "Über mich": the user-profile layer of Global — what Claude knows about you
 * as a person (type:user). Rendered as a section at the top of the Global view. */
export function AboutMeSection() {
  const { inv, cart, cartSet, cartRemove } = useStore();
  if (!inv) return null;
  const users = inv.entries.filter((e) => e.type === "user");
  const staged = cart.get("user_summary");

  return (
    <>
      <TypeSectionHead type="memory" title="Über mich" meta="was Claude über dich als Person gemerkt hat (Typ user)" />

      {users.length > 0 ? (
        <div className="cards">{users.map((e) => <Card key={e.id} entry={e} />)}</div>
      ) : (
        <div className="empty">
          <UserRound size={20} style={{ opacity: 0.5 }} />
          <div>
            <div className="big">Noch keine „user"-Memories.</div>
            <p style={{ maxWidth: 460, margin: "4px auto 14px", color: "var(--muted)" }}>
              Claude vergibt den Typ <code>user</code> selbst, wenn es einen dauerhaften Fakt über dich lernt — bisher ist keiner entstanden.
              Du kannst Claude bitten, aus deinen Memories und der CLAUDE.md einen Vorschlag zu entwerfen (du bestätigst ihn übers Diff-Gate).
            </p>
            {staged ? (
              <button className="btn" onClick={() => cartRemove("user_summary")}>Anfrage entfernen ✓ vorgemerkt</button>
            ) : (
              <button className="btn primary" onClick={() => cartSet({ key: "user_summary", kind: "user_summary" })}>
                <Sparkles size={14} /> Zusammenfassen lassen
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
