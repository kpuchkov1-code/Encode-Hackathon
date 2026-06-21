"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { shortAddr } from "@/components/AccountMenu";

// Local settings for the demo: account display name + provider defaults, persisted to
// localStorage so "Save changes" actually does something. Identity (the Sui address) is the
// connected wallet — read-only here, never a hardcoded fake.

const STORAGE_KEY = "dm_settings";

type Settings = {
  name: string;
  email: string;
  region: string;
  rate: number;
  notifyPaid: boolean;
  notifyJobs: boolean;
  interruptible: boolean;
};

const DEFAULTS: Settings = {
  name: "",
  email: "",
  region: "eu-west-1",
  rate: 100,
  notifyPaid: true,
  notifyJobs: true,
  interruptible: false,
};

export default function SettingsPage() {
  const account = useCurrentAccount();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  // Load persisted settings once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setS({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      setSaved(true);
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← marketplace
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-0.5 text-sm text-muted">Account, payouts and provider defaults.</p>

      <Section title="Account">
        <Field label="Display name">
          <input
            value={s.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Acme Bio Lab"
            className="input"
          />
        </Field>
        <Field label="Email">
          <input
            value={s.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="you@lab.bio"
            className="input font-mono"
          />
        </Field>
      </Section>

      <Section title="Wallet">
        <Field label="Connected Sui wallet (testnet)">
          <div className="input flex items-center font-mono text-sm text-foreground">
            {account ? shortAddr(account.address) : "—"}
          </div>
        </Field>
        <p className="text-xs text-muted">
          {account
            ? "This is your identity and the address that signs escrow locks. Connect or switch wallets from the Account menu."
            : "No wallet connected. Connect one from the Account menu (top right) to set your identity."}
        </p>
      </Section>

      <Section title="Provider defaults">
        <Field label="Region">
          <select
            value={s.region}
            onChange={(e) => set("region", e.target.value)}
            className="input font-mono"
          >
            <option>eu-west-1</option>
            <option>us-east-1</option>
            <option>ap-south-1</option>
          </select>
        </Field>
        <Field label="Preferred rate (SUI / job, indicative)">
          <input
            type="number"
            value={s.rate}
            onChange={(e) => set("rate", Number(e.target.value))}
            className="input font-mono"
          />
        </Field>
        <Toggle
          label="Accept interruptible jobs"
          desc="Cheaper for buyers, can be preempted"
          on={s.interruptible}
          onToggle={() => set("interruptible", !s.interruptible)}
        />
      </Section>

      <Section title="Notifications">
        <Toggle
          label="Job completed & paid"
          desc="Notify when escrow releases to your node"
          on={s.notifyPaid}
          onToggle={() => set("notifyPaid", !s.notifyPaid)}
        />
        <Toggle
          label="New jobs available"
          desc="Notify when matching jobs hit the queue"
          on={s.notifyJobs}
          onToggle={() => set("notifyJobs", !s.notifyJobs)}
        />
      </Section>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
        >
          Save changes
        </button>
        {saved && <span className="font-mono text-xs text-emerald-400">saved ✓</span>}
      </div>
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
