/**
 * Fixed to the page rather than a dismissible modal. The last line is the point:
 * it invites the reader to check the claim themselves instead of trusting it,
 * which is the only reason anyone should believe a page handling their tax
 * documents.
 */
export function PrivacyBanner() {
  return (
    <div className="border-b border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs text-emerald-900 dark:text-emerald-200">
        <span>
          ไฟล์ของคุณถูกอ่านในเบราว์เซอร์นี้เท่านั้น ไม่มีการส่งข้อมูลออกไปที่เซิร์ฟเวอร์ใดๆ
        </span>
        <span className="text-emerald-700/80 dark:text-emerald-400/80">
          ตรวจสอบเองได้: เปิด DevTools → แท็บ Network → ลากไฟล์เข้ามา แล้วดูว่าไม่มี request ออกไปไหน
        </span>
      </div>
    </div>
  );
}
