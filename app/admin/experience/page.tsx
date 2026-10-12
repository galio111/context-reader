import { notFound } from "next/navigation";
import { getAdminAccessMode } from "@/lib/adminAuth";
import { ExperiencePreviewControls } from "@/components/ExperiencePreviewControls";
export const dynamic="force-dynamic";
export default async function Page() {
  if(await getAdminAccessMode()!=="developer")notFound();
  return <ExperiencePreviewControls/>;
}
