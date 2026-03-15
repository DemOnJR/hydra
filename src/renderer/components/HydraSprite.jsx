export function HydraSprite({ activity = "sleep", role = "worker", label = "Hydra agent" }) {
  const isOrchestrator = role === "orchestrator";
  const bodyColor = isOrchestrator ? "#4f8ef7" : "#48bb78";
  const bodyDark = isOrchestrator ? "#2563b0" : "#276749";

  return (
    <div
      className={`hydra-avatar-shell hydra-role-${role}`}
      aria-label={label}
      style={{ overflow: "visible", position: "relative" }}
    >
      <svg
        className={`hydra-sprite hydra-octo hydra-octo-${activity}`}
        viewBox="0 0 40 48"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ overflow: "visible", display: "block" }}
      >
        <defs>
          <radialGradient id={`bg-${role}`} cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor={bodyColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={bodyColor} stopOpacity="0.04" />
          </radialGradient>
          <filter id={`glow-${activity}-${role}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ── Tentacles (8, drawn behind body) ── */}
        <g className="octo-tentacles">
          <path className="octo-t octo-t1" d="M11 30 Q5 34 4 40 Q3 44 6 46" stroke={bodyColor} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path className="octo-t octo-t2" d="M13 32 Q8 37 9 43 Q10 47 13 47" stroke={bodyColor} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path className="octo-t octo-t3" d="M17 33 Q15 39 16 44 Q17 48 19 47" stroke={bodyColor} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path className="octo-t octo-t4" d="M20 34 Q19 40 20 45 Q21 48 22 47" stroke={bodyDark} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path className="octo-t octo-t5" d="M23 33 Q25 39 24 44 Q23 48 21 47" stroke={bodyDark} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path className="octo-t octo-t6" d="M27 32 Q29 38 28 43 Q27 47 25 47" stroke={bodyColor} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path className="octo-t octo-t7" d="M30 30 Q35 35 34 41 Q33 45 30 46" stroke={bodyColor} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path className="octo-t octo-t8" d="M33 28 Q39 32 38 38 Q37 43 34 44" stroke={bodyColor} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>

        {/* ── Body ── */}
        <ellipse cx="20" cy="19" rx="13" ry="14" fill={`url(#bg-${role})`} />
        <ellipse className="octo-body" cx="20" cy="19" rx="13" ry="14"
          fill={bodyColor}
          filter={`url(#glow-${activity}-${role})`}
        />
        {/* body sheen */}
        <ellipse cx="16" cy="14" rx="4" ry="3" fill="white" opacity="0.13" />

        {/* ── Eyes (white sclera + dark pupil + shine — visible on any body color) ── */}
        <g className="octo-eyes">
          {/* sclera */}
          <circle cx="15" cy="18" r="3.5" fill="white" opacity="0.92" />
          <circle cx="25" cy="18" r="3.5" fill="white" opacity="0.92" />
          {/* pupils */}
          <circle className="octo-eye-l" cx="15" cy="18.5" r="2" fill="#111827" />
          <circle className="octo-eye-r" cx="25" cy="18.5" r="2" fill="#111827" />
          {/* shine */}
          <circle cx="16" cy="17.5" r="0.75" fill="white" opacity="0.9" />
          <circle cx="26" cy="17.5" r="0.75" fill="white" opacity="0.9" />
        </g>

        {/* ── Sleeping eyes (white sclera bg + white closed arcs — visible on any color) ── */}
        <g className="octo-eyes-closed">
          {/* sclera background so arcs show */}
          <ellipse cx="15" cy="18" rx="3.5" ry="2.2" fill="white" opacity="0.88" />
          <ellipse cx="25" cy="18" rx="3.5" ry="2.2" fill="white" opacity="0.88" />
          {/* closed eye arcs (dark on white bg — clearly visible) */}
          <path d="M12 18 Q15 15.5 18 18" stroke="#111827" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M22 18 Q25 15.5 28 18" stroke="#111827" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>

        {/* ── ZZZ (sleep bubbles — only shown in sleep state) ── */}
        <g className="octo-zzz">
          <text className="octo-z1" x="27" y="14" fontSize="4" fontWeight="700" fill="white" fillOpacity="0.7" fontFamily="sans-serif">z</text>
          <text className="octo-z2" x="30" y="10" fontSize="5" fontWeight="700" fill="white" fillOpacity="0.55" fontFamily="sans-serif">z</text>
          <text className="octo-z3" x="33" y="5" fontSize="6.5" fontWeight="700" fill="white" fillOpacity="0.4" fontFamily="sans-serif">Z</text>
        </g>

        {/* ── Mouth ── */}
        <path className="octo-mouth" d="M17 23 Q20 25.5 23 23" stroke="#111827" strokeWidth="1.4" fill="none" strokeLinecap="round" />

        {/* ── Thinking dots ── */}
        <g className="octo-think">
          <circle cx="28" cy="10" r="1.2" fill={bodyColor} />
          <circle cx="31" cy="7" r="1.6" fill={bodyColor} />
          <circle cx="34" cy="3" r="2" fill={bodyColor} />
        </g>

        {/* ── Error X eyes ── */}
        <g className="octo-eyes-error">
          <circle cx="15" cy="18" r="3.5" fill="white" opacity="0.92" />
          <circle cx="25" cy="18" r="3.5" fill="white" opacity="0.92" />
          <line x1="12.5" y1="15.5" x2="17.5" y2="20.5" stroke="#fc8181" strokeWidth="2" strokeLinecap="round" />
          <line x1="17.5" y1="15.5" x2="12.5" y2="20.5" stroke="#fc8181" strokeWidth="2" strokeLinecap="round" />
          <line x1="22.5" y1="15.5" x2="27.5" y2="20.5" stroke="#fc8181" strokeWidth="2" strokeLinecap="round" />
          <line x1="27.5" y1="15.5" x2="22.5" y2="20.5" stroke="#fc8181" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
