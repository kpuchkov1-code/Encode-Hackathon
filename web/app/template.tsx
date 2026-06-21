/*
  template.tsx (unlike layout.tsx) creates a fresh instance on every navigation, so the CSS
  enter animation on `.page-transition` replays each time a route changes — giving a smooth
  fade/rise instead of an instant teleport.

  The flex passthrough classes (`flex min-h-0 w-full flex-1 flex-col`) keep the console's
  full-height, scroll-locked layout working when the body is a flex column; on ordinary
  scrolling pages those classes are inert, so layout is unchanged.
*/
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-transition flex min-h-0 w-full flex-1 flex-col">{children}</div>
  );
}
