"use client";

import { useState } from "react";
import Link from "next/link";

// Cosmetic settings for the demo. No persistence beyond local state.
export default function SettingsPage() {
  const [region, setRegion] = useState("eu-west-1");
  const [rate, setRate] = useState(100);
  const [notifyPaid, setNotifyPaid] = useState(true);
  const [notifyJobs, setNotifyJobs] = useState(true);
  const [interruptible, setInterruptible] = useState(false);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← marketplace
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-0.5 text-sm text-muted">Account, payouts and provider defaults.</p>

      <Section title="Account">
        <Field label="Name">
          <input defaultValue="Demo Lab" className="input" />
        </Field>
        <Field label="Email">
          <input defaultValue="demo@lab.bio" className="input font-mono" />
        </Field>
      </Section>

      <Section title="Payout wallet">
        <Field label="Sui address">
          <input
            defaultValue="0x9f2a3c…b71e"
            className="input font-mono"
            spellCheck={false}
          />
        </Field>
        <p className="text-xs text-muted">
          Earnings settle on-chain via DeepBook to this address.
        </p>
      </Section>

      <Section title="Provider defaults">
        <Field label="Region">
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="input font-mono">
            <option>eu-west-1</option>
            <option>us-east-1</option>
            <option>ap-south-1</option>
          </select>
        </Field>
        <Field label="On-demand rate (credits / job)">
          <input
            type="number"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="input font-mono"
          />
        </Field>
        <Toggle
          label="Accept interruptible jobs"
          desc="Cheaper for buyers, can be preempted"
          on={interruptible}
          onToggle={() => setInterruptible((v) => !v)}
        />
      </Section>

      <Section title="Notifications">
        <Toggle
          label="Job completed & paid"
          desc="Notify when escrow releases to your node"
          on={notifyPaid}
          onToggle={() => setNotifyPaid((v) => !v)}
        />
        <Toggle
          label="New jobs available"
          desc="Notify when matching jobs hit the queue"
          on={notifyJobs}
          onToggle={() => setNotifyJobs((v) => !v)}
        />
      </Section>

      <button
        type="button"
        className="mt-8 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
      >
        Save changes
      </button>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold tracking-tight">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  desc,
  on,
  onToggle,
}: {
  label: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted">{desc}</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-2 border border-border"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}
