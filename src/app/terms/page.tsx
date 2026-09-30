import type { Metadata } from "next";
import { renderLegalDocument } from "@/lib/legalDocument";

export const metadata: Metadata = {
  title: "利用規約 | sokudoku",
  description: "RSVP 速読リーダー sokudoku の利用規約",
};

export default async function TermsPage() {
  return <main dangerouslySetInnerHTML={{ __html: await renderLegalDocument("terms") }} />;
}
