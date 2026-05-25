interface MouthVisualizerProps {
  phoneme: string;
  type: "vowel" | "diphthong" | "nasal" | "plosive" | "fricative" | "other";
  voiced: boolean;
  showAirflow?: boolean;
  tonguePosition:
    | "high-front"
    | "mid-front"
    | "low-front"
    | "high-back"
    | "mid-back"
    | "low-back"
    | "neutral"
    | "alveolar"
    | "velar"
    | "dental"
    | "diphthong-ey"
    | "diphthong-ay"
    | "diphthong-oy"
    | "diphthong-aw"
    | "diphthong-ow";
  mouthOpening: "closed" | "narrow" | "medium" | "wide";
  velum: "open" | "closed";
}

export function MouthVisualizer({
  phoneme,
  type,
  voiced,
  showAirflow = true,
  tonguePosition,
  mouthOpening,
  velum,
}: MouthVisualizerProps) {
  // 1. Determine Tongue Path(s)
  // For diphthongs, we return both start and end paths to show the glide.
  const getTonguePath = (pos: typeof tonguePosition, isEndState = false) => {
    const targetPos = isEndState
      ? pos === "diphthong-ey"
        ? "high-front"
        : pos === "diphthong-ay"
        ? "high-front"
        : pos === "diphthong-oy"
        ? "high-front"
        : pos === "diphthong-aw"
        ? "high-back"
        : pos === "diphthong-ow"
        ? "high-back"
        : "neutral"
      : pos === "diphthong-ey"
      ? "mid-front"
      : pos === "diphthong-ay"
      ? "low-front"
      : pos === "diphthong-oy"
      ? "low-back"
      : pos === "diphthong-aw"
      ? "low-front"
      : pos === "diphthong-ow"
      ? "mid-back"
      : pos;

    switch (targetPos) {
      case "high-front":
        // High, forward - e.g. /iː/
        return "M 80,135 C 80,135 90,92 112,94 C 122,110 132,125 135,142";
      case "mid-front":
        // Mid-height, forward - e.g. /e/
        return "M 80,135 C 82,135 92,104 114,106 C 124,118 132,128 135,142";
      case "low-front":
        // Low, forward - e.g. /æ/
        return "M 80,135 C 82,135 94,116 116,118 C 124,124 132,132 135,142";
      case "high-back":
        // High, retracted - e.g. /uː/
        return "M 80,135 C 92,132 106,120 122,96 C 130,108 133,126 135,142";
      case "mid-back":
        // Mid-height, retracted - e.g. /ɔː/
        return "M 80,135 C 92,135 108,125 121,110 C 128,118 132,126 135,142";
      case "low-back":
        // Low, retracted - e.g. /ɑː/
        return "M 80,135 C 94,136 108,132 120,122 C 128,126 132,132 135,142";
      case "alveolar":
        // Tongue tip raised to touch alveolar ridge (at x=87, y=86) - e.g. /n/, /t/, /d/, /l/
        return "M 87,86 C 90,105 110,114 122,118 C 129,124 133,132 135,142";
      case "velar":
        // Tongue back raised to touch velum (at x=130, y=94) - e.g. /k/, /g/, /ŋ/
        return "M 80,135 C 96,128 118,120 130,94 C 133,115 134,130 135,142";
      case "dental":
        // Tongue tip poking slightly between upper teeth (x=75, y=95) and lower teeth (x=73, y=122)
        return "M 70,108 C 88,112 110,116 122,118 C 129,124 133,132 135,142";
      case "neutral":
      default:
        // Relaxed tongue
        return "M 80,135 C 85,135 102,124 121,126 C 128,128 133,134 135,142";
    }
  };

  // Determine soft palate (velum) path
  const getVelumPath = () => {
    if (velum === "open") {
      // Lowered - opens nasal cavity, seals mouth slightly or hangs down
      return "M 125,80 C 132,84 136,92 136,102 C 136,108 140,111 142,112";
    } else {
      // Raised - seals off nasal cavity, seals against pharynx wall
      return "M 125,80 C 132,90 144,90 148,91 Q 150,97 150,105";
    }
  };

  // Airflow path coordinates
  const getAirflowPath = () => {
    if (velum === "open") {
      // Nasal flow: Up from larynx, behind velum, through nasal cavity, and out nose
      if (phoneme.toLowerCase() === "m") {
        // Double block: lips closed, so air flows up nose only, oral path is dark
        return "M 142,165 C 142,145 142,110 131,88 C 120,72 100,50 50,50";
      }
      // Alveolar/Velar nasal (lips open, mouth blocked by tongue)
      return "M 142,165 C 142,145 142,110 131,88 C 120,72 100,50 50,50";
    } else {
      // Oral flow: Up from larynx, through oral cavity, out mouth
      if (type === "plosive") {
        // Blocked at closure point:
        if (phoneme.toLowerCase() === "p" || phoneme.toLowerCase() === "b") {
          // Closed lips block
          return "M 142,165 C 142,145 125,128 108,118 C 95,110 82,110 74,110";
        } else if (phoneme.toLowerCase() === "t" || phoneme.toLowerCase() === "d") {
          // Alveolar block
          return "M 142,165 C 142,145 125,128 108,118 C 96,112 88,100 87,90";
        } else if (phoneme.toLowerCase() === "k" || phoneme.toLowerCase() === "g") {
          // Velar block
          return "M 142,165 C 142,145 132,122 130,100";
        }
      }
      // Standard open vowel or fricative oral flow
      return "M 142,165 C 142,145 125,128 108,118 C 92,110 75,110 50,110";
    }
  };

  const isDiphthong = type === "diphthong";
  const primaryTongue = getTonguePath(tonguePosition, false);
  const endTongue = isDiphthong ? getTonguePath(tonguePosition, true) : null;

  // Determine dynamic offsets based on mouth opening
  const jawOffset =
    mouthOpening === "wide"
      ? 12
      : mouthOpening === "medium"
      ? 6
      : mouthOpening === "closed"
      ? -4
      : 0;

  return (
    <div className="mouth-visualizer">
      <svg
        viewBox="0 0 200 200"
        className="mouth-svg"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Vocal tract anatomical profile animation"
      >
        <defs>
          {/* Soft Glow filter */}
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          {/* Airflow flow gradient */}
          <linearGradient id="airflowGrad" x1="1" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--color-primary, #6366f1)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--color-good, #10b981)" />
          </linearGradient>
        </defs>

        {/* ── BACKGROUND SILHOUETTE ─────────────────────────── */}
        {/* Soft, professional anatomic backing profile */}
        <path
          className="anatomic-bg"
          d={`
            M 45,40 
            C 45,40 70,30 95,30 
            C 120,30 145,42 155,55 
            C 165,68 168,85 168,105 
            L 168,175 L 120,175
            C 120,175 120,158 110,150 
            C 100,142 85,150 70,165 
            C 55,180 35,175 35,175 
            Z
          `}
          fill="var(--bg-anatomical, rgba(99, 102, 241, 0.03))"
          stroke="var(--border-anatomical, rgba(99, 102, 241, 0.1))"
          strokeWidth="1.5"
        />

        {/* ── UPPER PALATE / NASAL CAVITY / PHARYNX ────────── */}
        {/* The solid structures representing upper lip, nose, palate and pharynx wall */}
        <path
          className="chassis-upper"
          d={`
            M 40,75 
            C 38,70 42,60 50,60 
            C 58,60 62,65 65,75 
            C 68,85 70,95 75,95
            L 75,102 Q 77,102 77,95
            C 82,95 90,82 105,80 
            C 120,80 125,80 125,80
          `}
          fill="none"
          stroke="var(--color-text, #1e293b)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Back wall of pharynx */}
        <path
          className="chassis-throat-back"
          d={`
            M 152,102 
            L 152,175
          `}
          fill="none"
          stroke="var(--color-text, #1e293b)"
          strokeWidth="3.5"
        />
        {/* Nasal Cavity arch (interior) */}
        <path
          className="nasal-cavity-path"
          d="M 50,55 C 65,42 95,42 125,55 C 135,62 142,75 142,88"
          fill="none"
          stroke="var(--border-secondary, #e2e8f0)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />

        {/* ── LOWER JAW / TEETH / THROAT FRONT ────────────── */}
        {/* The structures that move slightly with the jaw offset */}
        <g transform={`translate(0, ${jawOffset})`}>
          {/* Lower lip and chin outline */}
          <path
            className="chassis-lower"
            d={`
              M 40,140 
              C 38,145 42,155 52,155
              C 62,155 68,148 70,135
              C 71,128 72,122 74,122
              L 74,115 Q 72,115 72,122
              C 72,125 78,138 95,142
              C 105,144 125,145 125,145
            `}
            fill="none"
            stroke="var(--color-text, #1e293b)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Front wall of throat (moving with jaw) */}
          <path
            className="chassis-throat-front"
            d={`
              M 132,150 
              L 132,175
            `}
            fill="none"
            stroke="var(--color-text, #1e293b)"
            strokeWidth="3.5"
          />
        </g>

        {/* ── SOFT PALATE (VELUM) ───────────────────────────── */}
        {/* Dynamically lowered (open) or raised (closed) */}
        <path
          className="velum-path"
          d={getVelumPath()}
          fill="none"
          stroke="var(--color-text, #1e293b)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* ── TEETH ─────────────────────────────────────────── */}
        {/* Upper teeth */}
        <rect x="74" y="96" width="3" height="6" fill="#ffffff" stroke="#94a3b8" strokeWidth="0.5" />
        {/* Lower teeth (moves with jaw) */}
        <rect
          x="71"
          y={116 + jawOffset}
          width="3"
          height="6"
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth="0.5"
        />

        {/* ── TONGUE ────────────────────────────────────────── */}
        {/* Primary tongue outline (solid) */}
        <path
          className="tongue-primary"
          d={primaryTongue}
          fill="var(--bg-tongue, rgba(239, 68, 68, 0.15))"
          stroke="var(--color-needs-work, #ef4444)"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Secondary tongue outline for diphthong glide (dashed) */}
        {isDiphthong && endTongue && (
          <>
            <path
              className="tongue-secondary"
              d={endTongue}
              fill="var(--bg-tongue-secondary, rgba(16, 185, 129, 0.05))"
              stroke="var(--color-good, #10b981)"
              strokeWidth="2.5"
              strokeDasharray="4 3"
              strokeLinecap="round"
              opacity="0.8"
            />
            {/* Draw glide animation arrow */}
            <path
              className="diphthong-arrow"
              d={`
                M ${tonguePosition === "diphthong-ey" ? "106,114 Q 100,105 96,101" : "106,114 Q 102,104 98,96"}
              `}
              fill="none"
              stroke="var(--color-good, #10b981)"
              strokeWidth="2.5"
              markerEnd="url(#arrow)"
              strokeLinecap="round"
              filter="url(#glow)"
            />
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-good, #10b981)" />
              </marker>
            </defs>
          </>
        )}

        {/* ── VOCAL CORDS (LARYNX) ─────────────────────────── */}
        {/* Glow pulsing wave if voiced, otherwise quiet line */}
        {voiced ? (
          <g className="vocal-cords voiced">
            {/* Pulsing vocal tract background */}
            <circle cx="142" cy="168" r="6" fill="#f59e0b" opacity="0.35" className="vocal-pulse-bg" />
            <path
              d="M 137,168 Q 140,163 142,168 T 147,168"
              fill="none"
              stroke="#d97706"
              strokeWidth="2"
              className="vocal-wave"
            />
          </g>
        ) : (
          <g className="vocal-cords voiceless">
            <line x1="137" y1="168" x2="147" y2="168" stroke="#94a3b8" strokeWidth="1.5" />
          </g>
        )}

        {/* ── AIRFLOW PATH ANIMATION ──────────────────────── */}
        {showAirflow ? (
          <path
            className="airflow-line"
            d={getAirflowPath()}
            fill="none"
            stroke="url(#airflowGrad)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray="8 6"
            filter="url(#glow)"
          />
        ) : null}

        {/* Plosive explosion shockwave if applicable */}
        {type === "plosive" && (
          <g className="plosive-explosion">
            {phoneme.toLowerCase() === "p" || phoneme.toLowerCase() === "b" ? (
              // Lips explosion
              <circle cx="70" cy="110" r="8" fill="none" stroke="var(--color-watch, #eab308)" strokeWidth="1.5" strokeDasharray="3 2" className="burst" />
            ) : phoneme.toLowerCase() === "t" || phoneme.toLowerCase() === "d" ? (
              // Alveolar explosion
              <circle cx="87" cy="90" r="7" fill="none" stroke="var(--color-watch, #eab308)" strokeWidth="1.5" strokeDasharray="3 2" className="burst" />
            ) : phoneme.toLowerCase() === "k" || phoneme.toLowerCase() === "g" ? (
              // Velar explosion
              <circle cx="130" cy="94" r="7" fill="none" stroke="var(--color-watch, #eab308)" strokeWidth="1.5" strokeDasharray="3 2" className="burst" />
            ) : null}
          </g>
        )}

        {/* ── HIGH-TECH RADAR READOUT LABELS INSIDE SVG ── */}
        <text
          x="10"
          y="190"
          className="svg-label label-velum"
          style={{
            fontSize: "6.5px",
            fontWeight: "700",
            fill: "var(--text-muted, #64748b)",
            textTransform: "uppercase",
            letterSpacing: "0.03em"
          }}
        >
          Velum: {velum === "open" ? "Lowered (Nasal)" : "Raised (Oral)"}
        </text>

        <text
          x="190"
          y="190"
          textAnchor="end"
          className="svg-label label-larynx"
          style={{
            fontSize: "6.5px",
            fontWeight: "700",
            fill: "var(--text-muted, #64748b)",
            textTransform: "uppercase",
            letterSpacing: "0.03em"
          }}
        >
          Vocal Cords: {voiced ? "Vibrating" : "Silent"}
        </text>
      </svg>
    </div>
  );
}
