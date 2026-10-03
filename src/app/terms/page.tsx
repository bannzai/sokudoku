import type { Metadata } from "next";
import { AppBar } from "@/components/AppBar";
import { renderLegalDocument } from "@/lib/legalDocument";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "利用規約 | sokudoku",
  description: "RSVP 速読リーダー sokudoku の利用規約",
};

export default async function TermsPage() {
  return (
    <>
      <AppBar />
      <main className={styles.legal} dangerouslySetInnerHTML={{ __html: await renderLegalDocument("terms") }} />
    </>
  );
}
