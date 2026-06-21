/*
  DockMarket brand mark: a hexagonal ligand docking into an open double-ring pocket.
  Monochrome line-art; uses `currentColor` so it inherits the surrounding text colour.
*/
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="2 21 182 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* outer ring: near-full circle, open on the left where the ligand enters */}
      <path
        d="M63.6 64.5 A60 60 0 1 1 63.6 105.5"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* inner ring: crescent, open on the left */}
      <path
        d="M87.9 67.3 A42 42 0 1 1 87.9 102.7"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* hexagonal ligand with a concave chevron notch on its docking face */}
      <path
        d="M6 85 L26 50.4 L66 50.4 L80 66 L70 85 L80 104 L66 119.6 L26 119.6 Z"
        fill="currentColor"
      />
    </svg>
  );
}
