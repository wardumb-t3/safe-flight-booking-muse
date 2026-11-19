export default function handler(req, res) {
  const pk = process.env.STRIPE_PUBLISHABLE_KEY || "";
  if (!pk.startsWith("pk_test_")) {
    res.status(500).json({ error: "STRIPE_PUBLISHABLE_KEY must be a test-mode key (pk_test_…)" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ publishableKey: pk });
}
