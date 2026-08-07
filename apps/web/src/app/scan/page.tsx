import Link from "next/link";
import { Scanner } from "./scanner";

export default function ScanPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Scan</h1>
        <Link href="/" className="text-sm text-blue-700 hover:underline dark:text-blue-400">
          Home
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Align a card to the guide frame, capture, and confirm. Collector number is read with OCR and
        matched exactly against your local card database.
      </p>
      <Scanner />
    </main>
  );
}
