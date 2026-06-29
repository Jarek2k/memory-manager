import { AlertTriangle, Clock, Globe, Scale, Scissors, Unlink } from "lucide-react";
import type { Entry } from "../types";
import { signalHas } from "../store";
import { Tooltip } from "./Tooltip";

const META: Record<string, { cls: string; label: string; tip: string; Icon: any }> = {
  enforceable: { cls: "enf", label: "erzwingbar", Icon: Scale, tip: "Klingt wie eine harte Regel (muss/nie/immer). Sollte vielleicht ein Hook/Permission sein statt weiches Memory." },
  split: { cls: "split", label: "zu lang", Icon: Scissors, tip: "Mischt eine Dauerregel mit datierten Logs. Split-Kandidat: Regel behalten, Logs auslagern." },
  unicode: { cls: "uni", label: "unicode", Icon: AlertTriangle, tip: "Enthält unsichtbare/verdächtige Zeichen. Vor dem Befördern prüfen." },
  dangling: { cls: "dangling", label: "verwaist", Icon: Unlink, tip: "Verweist per [[…]] auf einen Eintrag, den es nicht (mehr) gibt." },
  stale: { cls: "stale", label: "alt", Icon: Clock, tip: "Älter als 180 Tage — prüfen, ob noch aktuell." },
  global: { cls: "global", label: "global?", Icon: Globe, tip: "Taucht projektübergreifend auf — Kandidat, um daraus eine globale Regel zu machen." },
};

const ORDER = ["enforceable", "split", "unicode", "dangling", "stale", "global"];

export function SignalBadges({ entry }: { entry: Entry }) {
  const active = ORDER.filter((k) => signalHas(entry, k));
  if (!active.length) return null;
  return (
    <>
      {active.map((k) => {
        const m = META[k];
        return (
          <Tooltip key={k} text={m.tip}>
            <span className={"sig " + m.cls}><m.Icon size={11} />{m.label}</span>
          </Tooltip>
        );
      })}
    </>
  );
}
