import { ConsoleShell } from "@/components/console/ConsoleShell";

export const metadata = {
  title: "Copilot Console — DockMarket",
  description:
    "AI copilot for molecular docking: load and clean structures, select a binding pocket, run a screen on idle GPUs, and verify the proof.",
};

export default function ConsolePage() {
  return <ConsoleShell />;
}
