import type { Metadata } from "next";
import { renderLegalDocument } from "@/lib/legalDocument";

export const metadata: Metadata = {
  title: "プライバシーポリシー | sokudoku",
  description: "RSVP 速読リーダー sokudoku のプライバシーポリシー",
};

export default async function PrivacyPage() {
  return <main dangerouslySetInnerHTML={{ __html: await renderLegalDocument("privacy") }} />;
}
