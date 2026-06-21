"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// A role card whose right-side thumbnail cycles through `frames` while hovered.
// Frames have a pure-black background, so the card is solid black (`bg-black`)
// and the image edges blend invisibly into it.
const FRAME_MS = 450;

export default function HoverFramesRoleCard({
  href,
  title,
  frames,
  frameClassName = "h-10 w-[3.5rem]",
  primary = false,
}: {
  href: string;
  title: string;
  frames: readonly string[];
  /** Tailwind sizing for the frame box; tune per image aspect ratio. */
  frameClassName?: string;
  primary?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!hovered) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [hovered, frames.length]);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group flex items-center justify-between gap-4 rounded-2xl border bg-black p-6 text-left transition-all ${
        primary
          ? "border-accent/50 hover:border-accent/80"
          : "border-border hover:border-accent/50"
      }`}
    >
      <span className="text-2xl font-semibold tracking-tight">{title}</span>

      <span className="flex items-center gap-3">
        {/* Stacked frames cross-fade so swaps don't reflow or flicker. */}
        <span className={`relative shrink-0 overflow-hidden ${frameClassName}`}>
          {frames.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              aria-hidden="true"
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ${
                i === frame ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}
        </span>
        <span className="text-xl text-accent transition-transform group-hover:translate-x-1">
          →
        </span>
      </span>
    </Link>
  );
}
