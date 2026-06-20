import { JobView } from "@/components/JobView";

// Server component: extract the id + carried-over pdb, hand off to the live client view.
export default async function JobPage({
  params,
  searchParams,
}: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const pdb = typeof sp.pdb === "string" ? sp.pdb : "";
  return (
    <main>
      <JobView id={id} pdb={pdb} />
    </main>
  );
}
