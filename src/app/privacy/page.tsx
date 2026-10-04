import type { Metadata } from "next";
import { AppBar } from "@/components/AppBar";
import { renderLegalDocument } from "@/lib/legalDocument";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "プライバシーポリシー | sokudoku",
  description: "RSVP 速読リーダー sokudoku のプライバシーポリシー",
};

export default async function PrivacyPage() {
  return (
    <>
      <AppBar />
      <main className={styles.legal} dangerouslySetInnerHTML={{ __html: await renderLegalDocument("privacy") }} />
    </>
  );
}
