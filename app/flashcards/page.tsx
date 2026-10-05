import { redirect } from "next/navigation";

// Study pages now live at /study/{id}/... so every saved week has a permanent URL.
export default function LegacyRedirect() {
  redirect("/");
}
