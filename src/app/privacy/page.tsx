import type { Metadata } from "next";
import { renderLegalDocument } from "@/lib/legalDocument";

export const metadata: Metadata = {
  title: "プライバシーポリシー | sokudoku",
};

export default async function PrivacyPage() {
  return <main dangerouslySetInnerHTML={{ __html: await renderLegalDocument("privacy") }} />;
}
