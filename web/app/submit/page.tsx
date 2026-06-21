import { Suspense } from "react";
import { SubmitForm } from "@/components/SubmitForm";

// useSearchParams (inside SubmitForm) must live under a Suspense boundary in Next 16.
export default function SubmitPage() {
  return (
    <main>
      <Suspense fallback={<div className="px-6 py-10 text-sm text-muted">Loading…</div>}>
        <SubmitForm />
      </Suspense>
    </main>
  );
}
