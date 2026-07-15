import { redirect } from "next/navigation";

export default function LegacyAdminAccountsPage() {
  redirect("/admin?section=accounts");
}
