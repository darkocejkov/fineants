export function JsonView({ value, maxChars = 20000 }: { value: unknown; maxChars?: number }) {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxChars) return <pre className="json">{json}</pre>;
  return <pre className="json">{`${json.slice(0, maxChars)}\n… truncated, ${json.length} characters total`}</pre>;
}
