import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { food } = req.body;
  if (!food || typeof food !== "string") {
    return res.status(400).json({ error: "Missing food name" });
  }

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Estimate the calories and protein for this food item a child might eat: "${food}"

Respond ONLY with valid JSON, no other text:
{"name": "cleaned up food name", "cal": number, "protein": number, "serving": "brief serving description"}

Use typical kid-sized portions. Be reasonable and accurate. Round calories to nearest 5, protein to nearest 1g.`,
        },
      ],
    });

    const text = msg.content[0].text.trim();
    const data = JSON.parse(text);
    return res.status(200).json(data);
  } catch (err) {
    console.error("Calorie estimation error:", err);
    return res.status(500).json({ error: "Failed to estimate calories" });
  }
}
