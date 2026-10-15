// The whole protocol as a timing diagram. Two authored compositions of the same flow: five lanes
// across seven steps for wide screens, and one column with the clock as its spine for phones.
import type { ReactNode } from "react";
import s from "./Schematic.module.css";

type Tone = "ink" | "brass" | "rust";
const STROKE: Record<Tone, string> = { ink: s.arrowInk, brass: s.arrowBrass, rust: s.arrowRust };
const MARK: Record<Tone, string> = { ink: s.markInk, brass: s.markBrass, rust: s.markRust };

export const STEPS = [
  {
    n: "01",
    verb: "File it sealed",
    body: "The researcher writes one atomic batch: the encrypted case file, a clock whose Entity Expiration is the deadline, and three triggers that each escrow one watcher’s share of the advisory key. The case file and the triggers are handed to 0x…dEaD in the same transaction, so nobody can edit or delete them.",
  },
  {
    n: "02",
    verb: "Answer unseen",
    body: "The case is addressed to the vendor’s stealth inbox. The vendor finds it by its view tag, opens it with its view key, and answers from a one-time responder address. Anyone can see the case was acknowledged; nobody can see by whom.",
  },
  {
    n: "03",
    verb: "Extend",
    body: "Only the clock’s custodian can move the deadline: a Lifetime Extension on the clock and on every trigger, plus a grant record, in one batch. The vendor’s own extendEntity reverts with NotOwner.",
  },
  {
    n: "04",
    verb: "Lapse",
    body: "At the deadline the clock’s lifetime runs out. Arkiv emits no event for that and nobody has to act: the entity is simply no longer there.",
  },
  {
    n: "05",
    verb: "Prove it",
    body: "Each watcher checks that the clock existed one block before its deadline (a historical query), that it is gone now, and that no EntityDeleted log names it. Then it publishes a receipt carrying its share.",
  },
  {
    n: "06",
    verb: "Rebuild K",
    body: "Any two of the three shares rebuild the advisory key K. The watcher whose receipt completes the threshold checks K against the case and publishes the reveal in the same batch as its share.",
  },
  {
    n: "07",
    verb: "Reveal",
    body: "Anyone’s browser decrypts the advisory with K. The vendor is named only after K proves the case was addressed to that vendor’s keys and the inbox it names matches them.",
  },
] as const;

function T({ x, y, c, a, children }: { x: number; y: number; c: string; a?: "middle" | "end"; children: ReactNode }) {
  return (
    <text x={x} y={y} className={c} textAnchor={a}>
      {children}
    </text>
  );
}

function Defs({ p, fade }: { p: string; fade: { x1: number; y1: number; x2: number; y2: number } }) {
  return (
    <defs>
      {(["ink", "brass", "rust"] as const).map((t) => (
        <marker key={t} id={`${p}-${t}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 Z" className={MARK[t]} />
        </marker>
      ))}
      <pattern id={`${p}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="2.2" height="5" className={s.hatch} />
      </pattern>
      <linearGradient id={`${p}-fade`} gradientUnits="userSpaceOnUse" {...fade}>
        <stop offset="0" className={s.fadeStart} />
        <stop offset="1" className={s.fadeEnd} />
      </linearGradient>
    </defs>
  );
}

function Arrow({ p, d, tone = "ink", dotted = false }: { p: string; d: string; tone?: Tone; dotted?: boolean }) {
  return <path d={d} className={`${s.arrow} ${STROKE[tone]}${dotted ? ` ${s.dotted}` : ""}`} markerEnd={`url(#${p}-${tone})`} />;
}

function Lock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className={s.lock}>
      <rect x={-4} y={-1} width={8} height={6.5} rx={1.2} />
      <path d="M-2.4 -1 V-3.2 a2.4 2.4 0 0 1 4.8 0 V-1" />
    </g>
  );
}

function Cross({ x, y, r = 4.5 }: { x: number; y: number; r?: number }) {
  return <path d={`M${x - r} ${y - r} L${x + r} ${y + r} M${x + r} ${y - r} L${x - r} ${y + r}`} className={s.cross} />;
}

function Chip({ x, y, w, label, sub, tone = "ink", lock = false, cross = false }: { x: number; y: number; w: number; label: string; sub?: string; tone?: Tone; lock?: boolean; cross?: boolean }) {
  const h = sub ? 36 : 26;
  const tx = lock || cross ? 24 : 10;
  const box = tone === "brass" ? s.chipBrass : tone === "rust" ? s.chipRust : s.chip;
  const text = tone === "brass" ? s.tChipBrass : tone === "rust" ? s.tChipRust : s.tChip;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={6} className={box} />
      {lock && <Lock x={13} y={sub ? 11 : 12} />}
      {cross && <Cross x={13} y={h / 2} r={3.5} />}
      <text x={tx} y={sub ? 15 : 17} className={text}>
        {label}
      </text>
      {sub && (
        <text x={tx} y={29} className={s.tChipSub}>
          {sub}
        </text>
      )}
    </g>
  );
}

function Checks({ x, y, lines, lh = 16 }: { x: number; y: number; lines: string[]; lh?: number }) {
  return (
    <>
      {lines.map((l, i) => (
        <text key={l} x={x} y={y + i * lh} className={s.tMono}>
          <tspan className={s.tBrass}>✓</tspan> {l}
        </text>
      ))}
    </>
  );
}

const ticks = (y: number, from: number, to: number, step = 12) => {
  let d = "";
  for (let x = from; x <= to; x += step) d += `M${x} ${y - 3}V${y + 3}`;
  return d;
};

// ---------- wide: five lanes, seven steps ----------

const COLS = [132, 278, 418, 570, 710, 850, 968];
const LANES = [
  { top: 62, label: "RESEARCHER", sub: "or its custodian" },
  { top: 160, label: "VENDOR", sub: "stealth inbox" },
  { top: 250, label: "ARKIV", sub: "Tiramisu entities" },
  { top: 450, label: "WATCHERS", sub: "any 2 of 3" },
  { top: 570, label: "ANYONE", sub: "the public" },
];

function Wide() {
  const p = "sw";
  const X0 = 176, BAR = 274, FILED = 496, DL = 590;
  const TRIGGERS = [306, 313, 320];
  const TRACKS = [482, 512, 542];
  return (
    <svg className={s.wide} viewBox="0 0 1100 720" role="img" aria-labelledby="sw-t sw-d">
      <title id="sw-t">One case, start to finish</title>
      <desc id="sw-d">
        A timing diagram with five lanes (researcher, vendor, Arkiv, watchers, anyone) across seven steps: file, answer, extend, lapse, prove,
        rebuild the key, reveal. The steps are described in the list below the diagram.
      </desc>
      <Defs p={p} fade={{ x1: DL, y1: 0, x2: 664, y2: 0 }} />

      {STEPS.map((st, i) => (
        <g key={st.n}>
          <T x={COLS[i]! + 10} y={24} c={s.tStep}>
            {st.n}
          </T>
          <T x={COLS[i]! + 10} y={46} c={s.tVerb}>
            {st.verb}
          </T>
          {i > 0 && <path d={`M${COLS[i]} 10V54`} className={s.colTick} />}
        </g>
      ))}
      <path d="M0 62H1100" className={s.ruleStrong} />
      <path d="M0 160H1100M0 570H1100M0 660H1100" className={s.rule} />
      <rect x={124} y={254} width={974} height={192} rx={12} className={s.band} />
      {LANES.map((l) => (
        <g key={l.label}>
          <T x={0} y={l.top + 24} c={s.tLane}>
            {l.label}
          </T>
          <T x={0} y={l.top + 40} c={s.tLaneSub}>
            {l.sub}
          </T>
        </g>
      ))}

      <path d={`M${DL} 62V680`} className={s.deadline} />

      {/* the clock and its escrow */}
      <T x={X0} y={268} c={s.tMono}>
        clock · Entity Expiration = deadline
      </T>
      <rect x={X0} y={BAR} width={FILED - X0} height={12} rx={2} className={s.bar} />
      <rect x={FILED} y={BAR} width={DL - FILED} height={12} fill={`url(#${p}-hatch)`} />
      <rect x={FILED + 0.5} y={BAR + 0.5} width={DL - FILED - 1} height={11} className={s.barEdge} />
      <T x={DL - 4} y={268} c={s.tBrass} a="end">
        + Lifetime Extension
      </T>
      <rect x={DL + 0.5} y={BAR + 0.5} width={100} height={11} rx={2} className={s.ghost} />
      {TRIGGERS.map((y) => (
        <rect key={y} x={X0} y={y} width={664 - X0} height={2.5} fill={`url(#${p}-fade)`} />
      ))}
      <T x={X0} y={342} c={s.tMute}>
        3 triggers: one share each,
      </T>
      <T x={X0} y={356} c={s.tMute}>
        bound to this clock
      </T>

      {/* 01 file */}
      <T x={142} y={90} c={s.tBody}>
        files one batch
      </T>
      <T x={142} y={106} c={s.tMute}>
        case file, clock
      </T>
      <T x={142} y={120} c={s.tMute}>
        and 3 triggers
      </T>
      <Arrow p={p} d="M156 128V364" />
      <path d={`M156 ${BAR + 6}H${X0 - 2}M156 313H${X0 - 2}`} className={`${s.arrow} ${s.arrowInk}`} />
      <Chip x={144} y={368} w={126} label="case file" sub="$owner 0x…dEaD" lock />

      {/* 02 answer */}
      <T x={288} y={90} c={s.tMute}>
        funds the responder
      </T>
      <T x={288} y={104} c={s.tMute}>
        with a little gas
      </T>
      <Arrow p={p} d="M402 112V216" dotted />
      <T x={288} y={186} c={s.tBody}>
        finds its case
      </T>
      <T x={288} y={202} c={s.tMute}>
        by its view tag
      </T>
      <circle cx={402} cy={226} r={5} className={s.responder} />
      <T x={392} y={230} c={s.tBrass} a="end">
        one-time responder
      </T>
      <Arrow p={p} d="M402 232V364" />
      <Chip x={290} y={368} w={124} label="ack" sub="by the responder" />

      {/* 03 extend */}
      <Arrow p={p} d="M432 80V364" tone="brass" />
      <circle cx={432} cy={BAR + 6} r={3} className={s.dot} />
      <circle cx={432} cy={313} r={3} className={s.dot} />
      <T x={444} y={90} c={s.tBody}>
        extends the clock
      </T>
      <T x={444} y={106} c={s.tMute}>
        clock, triggers and
      </T>
      <T x={444} y={120} c={s.tMute}>
        a grant: one batch
      </T>
      <T x={444} y={186} c={s.tBody}>
        tries to extend
      </T>
      <T x={444} y={202} c={s.tRust}>
        extendEntity
      </T>
      <T x={444} y={216} c={s.tRust}>
        reverts: NotOwner
      </T>
      <Arrow p={p} d="M560 172V222" tone="rust" />
      <Cross x={560} y={234} />
      <Chip x={424} y={368} w={134} label="grant" sub="new expiry, recorded" />

      {/* 04 lapse */}
      <T x={602} y={100} c={s.tMute}>
        nobody has to act
      </T>
      <T x={602} y={346} c={s.tBody}>
        it simply lapses
      </T>
      <T x={602} y={362} c={s.tMute}>
        no event emitted
      </T>

      {/* 05 prove */}
      <T x={720} y={282} c={s.tBody}>
        proves the lapse:
      </T>
      <Checks x={720} y={300} lines={["alive at deadline−1", "gone at the head", "no delete in logs"]} />
      <Chip x={718} y={368} w={124} label="receipt + s₁" sub="w1’s share" />
      <Arrow p={p} d="M770 476V408" />

      {/* 06 rebuild */}
      <T x={858} y={282} c={s.tBody}>
        w2 rebuilds K
      </T>
      <T x={858} y={302} c={s.tKey}>
        s₁ + s₂ → K
      </T>
      <T x={858} y={320} c={s.tMute}>
        checks that K
      </T>
      <T x={858} y={334} c={s.tMute}>
        opens the case
      </T>
      <Chip x={856} y={368} w={106} label="receipt + s₂" />
      <Chip x={856} y={400} w={106} label="reveal · K" tone="brass" />
      <T x={858} y={442} c={s.tMute}>
        one batch
      </T>
      <Arrow p={p} d="M944 506V430" />

      {/* 07 reveal */}
      <T x={980} y={186} c={s.tBody}>
        named, at last
      </T>
      <T x={980} y={202} c={s.tMute}>
        by its own inbox
      </T>
      <T x={980} y={296} c={s.tMute}>
        trusted only by
      </T>
      <T x={980} y={310} c={s.tMute}>
        recomputation
      </T>
      <Arrow p={p} d="M962 413H976V584" tone="brass" />
      <T x={988} y={592} c={s.tBody}>
        advisory opens
      </T>
      <Checks x={988} y={608} lh={14} lines={["key opens case", "delivery proven", "inbox matches"]} />
      <T x={988} y={652} c={s.tBrass}>
        → vendor named
      </T>

      {/* watchers: each lease is a tick every renewal */}
      {TRACKS.map((y, i) => (
        <g key={y}>
          <circle cx={146} cy={y} r={2.5} className={s.lampOn} />
          <T x={154} y={y + 3.5} c={s.tMute}>
            w{i + 1}
          </T>
          <path d={ticks(y, 178, i === 2 ? 694 : 1090)} className={s.lease} />
          {i === 2 && <path d={`M704 ${y}H1090`} className={s.leaseOff} />}
        </g>
      ))}
      <T x={712} y={560} c={s.tMute}>
        w3 offline: not needed
      </T>

      {/* the public, while the clock runs */}
      <T x={142} y={598} c={s.tSoft}>
        While the clock runs, anyone can see a case exists,
      </T>
      <T x={142} y={614} c={s.tSoft}>
        how severe it is and when it ends. Not who it is for.
      </T>
      {[
        ["vendor", 142],
        ["title", 240],
        ["report", 326],
      ].map(([w, x]) => (
        <g key={String(w)}>
          <T x={Number(x)} y={642} c={s.tMute}>
            {w}
          </T>
          <rect x={Number(x) + String(w).length * 6 + 6} y={634} width={42} height={9} rx={1} className={s.redact} />
        </g>
      ))}

      {/* block height */}
      <Arrow p={p} d="M142 688H1094" />
      {[
        [X0, "filed", s.tAxis],
        [FILED, "filed deadline", s.tAxis],
        [DL, "deadline", s.tAxisBrass],
        [790, "a few blocks later", s.tAxis],
      ].map(([x, label, c]) => (
        <g key={String(label)}>
          <path d={`M${x} 684V692`} className={s.ruleStrong} />
          <T x={Number(x)} y={708} c={String(c)} a="middle">
            {label}
          </T>
        </g>
      ))}
      <T x={1094} y={680} c={s.tAxis} a="end">
        block height
      </T>
    </svg>
  );
}

// ---------- tall: the clock is the spine ----------

function Band({ y, n, verb }: { y: number; n: string; verb: string }) {
  return (
    <g>
      {y > 0 && <path d={`M58 ${y}H354`} className={s.rule} />}
      <T x={58} y={y + 26} c={s.tStep}>
        {n}
      </T>
      <T x={84} y={y + 27} c={s.tVerbTall}>
        {verb}
      </T>
    </g>
  );
}

function Tall() {
  const p = "st";
  const B = [0, 214, 404, 630, 742, 942, 1098];
  const CLOCK = 139, TRIG = 178, FILED = B[2]! + 136, DL = B[3]! + 40;
  return (
    <svg className={s.tall} viewBox="0 0 358 1252" role="img" aria-labelledby="st-t st-d">
      <title id="st-t">One case, start to finish</title>
      <desc id="st-d">
        A vertical timing diagram. The clock runs down the left edge from filing to the deadline; each of the seven steps is a band to its right.
        The steps are described in the list below the diagram.
      </desc>
      <Defs p={p} fade={{ x1: 0, y1: DL, x2: 0, y2: DL + 76 }} />

      {/* spine */}
      <rect x={16} y={CLOCK} width={8} height={FILED - CLOCK} rx={2} className={s.bar} />
      <rect x={16} y={FILED} width={8} height={DL - FILED} fill={`url(#${p}-hatch)`} />
      <rect x={16.5} y={FILED + 0.5} width={7} height={DL - FILED - 1} className={s.barEdge} />
      <rect x={16.5} y={DL + 0.5} width={7} height={52} rx={2} className={s.ghost} />
      {[31, 35.5, 40].map((x) => (
        <rect key={x} x={x} y={TRIG} width={2} height={DL + 76 - TRIG} fill={`url(#${p}-fade)`} />
      ))}
      <path d={`M20 ${DL + 60}V1240`} className={`${s.rule} ${s.dotted}`} />
      <path d={`M24 ${CLOCK}H56M42 ${TRIG}H56`} className={`${s.arrow} ${s.arrowInk}`} />

      {/* 01 */}
      <Band y={B[0]!} n="01" verb="File it sealed" />
      <T x={58} y={52} c={s.tLane}>
        RESEARCHER
      </T>
      <T x={58} y={70} c={s.tBodyTall}>
        files one atomic batch:
      </T>
      <Chip x={58} y={80} w={180} label="case file" sub="$owner → 0x…dEaD" lock />
      <Chip x={58} y={126} w={258} label="clock · Entity Expiration = deadline" tone="brass" />
      <Chip x={58} y={160} w={258} label="3 triggers · one share each" sub="each bound to this clock" />

      {/* 02 */}
      <Band y={B[1]!} n="02" verb="Answer unseen" />
      <T x={58} y={B[1]! + 52} c={s.tLane}>
        VENDOR
      </T>
      <T x={58} y={B[1]! + 70} c={s.tBodyTall}>
        finds its case by the view tag
      </T>
      <T x={58} y={B[1]! + 86} c={s.tMute}>
        and opens it with its view key
      </T>
      <circle cx={63} cy={B[1]! + 105} r={5} className={s.responder} />
      <T x={76} y={B[1]! + 109} c={s.tBrass}>
        answers from a one-time responder
      </T>
      <Chip x={58} y={B[1]! + 120} w={196} label="ack" sub="$creator = responder" />
      <T x={58} y={B[1]! + 176} c={s.tMute}>
        the researcher funds the responder’s gas
      </T>

      {/* 03 */}
      <Band y={B[2]!} n="03" verb="Extend" />
      <T x={58} y={B[2]! + 52} c={s.tLane}>
        CUSTODIAN
      </T>
      <T x={58} y={B[2]! + 70} c={s.tBodyTall}>
        extends the clock
      </T>
      <Chip x={58} y={B[2]! + 80} w={272} label="Lifetime Extension" sub="clock + triggers + grant, one batch" tone="brass" />
      <path d={`M8 ${FILED}H354`} className={s.filed} />
      <T x={354} y={FILED - 5} c={s.tAxis} a="end">
        filed deadline
      </T>
      <T x={58} y={B[2]! + 162} c={s.tLane}>
        VENDOR
      </T>
      <T x={58} y={B[2]! + 180} c={s.tBodyTall}>
        tries to extend it too
      </T>
      <Chip x={58} y={B[2]! + 190} w={272} label="extendEntity → reverts: NotOwner" tone="rust" cross />

      {/* 04 */}
      <Band y={B[3]!} n="04" verb="Lapse" />
      <path d={`M8 ${DL}H354`} className={s.deadline} />
      <T x={354} y={DL - 5} c={s.tAxisBrass} a="end">
        deadline
      </T>
      <T x={58} y={B[3]! + 64} c={s.tBodyTall}>
        the clock simply lapses
      </T>
      <T x={58} y={B[3]! + 82} c={s.tMute}>
        no event is emitted, nothing is deleted,
      </T>
      <T x={58} y={B[3]! + 96} c={s.tMute}>
        and nobody has to act
      </T>

      {/* 05 */}
      <Band y={B[4]!} n="05" verb="Prove it" />
      <T x={58} y={B[4]! + 52} c={s.tLane}>
        WATCHERS
      </T>
      <T x={58} y={B[4]! + 70} c={s.tBodyTall}>
        each proves the lapse:
      </T>
      <Checks x={58} y={B[4]! + 88} lines={["alive one block before the deadline", "gone at the current head", "no EntityDeleted in the logs"]} />
      <Chip x={58} y={B[4]! + 134} w={180} label="receipt + s₁" sub="w1 publishes its share" />
      <circle cx={62} cy={B[4]! + 186} r={2.5} className={s.lampOff} />
      <T x={72} y={B[4]! + 189.5} c={s.tMute}>
        w3 offline: not needed
      </T>

      {/* 06 */}
      <Band y={B[5]!} n="06" verb="Rebuild K" />
      <T x={58} y={B[5]! + 52} c={s.tLane}>
        WATCHER W2
      </T>
      <T x={58} y={B[5]! + 72} c={s.tKey}>
        s₁ + s₂ → K
      </T>
      <T x={58} y={B[5]! + 88} c={s.tMute}>
        and checks that K opens this case
      </T>
      <Chip x={58} y={B[5]! + 100} w={124} label="receipt + s₂" />
      <Chip x={190} y={B[5]! + 100} w={118} label="reveal · K" tone="brass" />
      <T x={58} y={B[5]! + 144} c={s.tMute}>
        one batch: the last share and the reveal
      </T>

      {/* 07 */}
      <Band y={B[6]!} n="07" verb="Reveal" />
      <T x={58} y={B[6]! + 52} c={s.tLane}>
        ANYONE
      </T>
      <T x={58} y={B[6]! + 70} c={s.tBodyTall}>
        the advisory decrypts
      </T>
      <Checks x={58} y={B[6]! + 88} lines={["K opens this case", "delivery to the vendor proven", "named inbox matches its keys"]} />
      <T x={58} y={B[6]! + 140} c={s.tBrass}>
        → the vendor is named
      </T>
    </svg>
  );
}

export function Schematic() {
  return (
    <figure className={s.figure}>
      <div className={s.frame}>
        <Wide />
        <Tall />
      </div>
      <ol className={s.legend}>
        {STEPS.map((st) => (
          <li key={st.n}>
            <b>
              <span>{st.n}</span>
              {st.verb}
            </b>
            {st.body}
          </li>
        ))}
      </ol>
    </figure>
  );
}
