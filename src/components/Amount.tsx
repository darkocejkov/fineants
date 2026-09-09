import { formatCents } from "@/lib/money";

export function Amount({ cents, currency, signColour = true }: { cents: number; currency: string; signColour?: boolean }) {
  const tone = signColour && cents < 0 ? " amount-out" : signColour && cents > 0 ? " amount-in" : "";
  return <span className={`amount${tone}`}>{formatCents(cents, currency)}</span>;
}
