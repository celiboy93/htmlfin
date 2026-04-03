const fetch = require("node-fetch");
const cheerio = require("cheerio");

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  // Validate URL
  let targetUrl;
  try {
    targetUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  try {
    const response = await fetch(targetUrl.href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
      timeout: 15000,
    });

    if (!response.ok) {
      return res
        .status(502)
        .json({ error: `Failed to fetch: HTTP ${response.status}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // ---- Extract all https:// links ----
    const linksSet = new Set();

    // 1) <a href="...">
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.startsWith("https://")) linksSet.add(href);
    });

    // 2) <script src="...">
    $("script[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (src && src.startsWith("https://")) linksSet.add(src);
    });

    // 3) <link href="...">
    $("link[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.startsWith("https://")) linksSet.add(href);
    });

    // 4) <img src="..."> & <img srcset="...">
    $("img[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (src && src.startsWith("https://")) linksSet.add(src);
    });

    // 5) <source src="..."> & <video src="..."> & <audio src="...">
    $("source[src], video[src], audio[src], iframe[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (src && src.startsWith("https://")) linksSet.add(src);
    });

    // 6) Regex: catch any https:// URL hidden in inline styles, JSON-LD, etc.
    const regexLinks = html.match(/https:\/\/[^\s"'<>()\\]+/g) || [];
    regexLinks.forEach((link) => {
      // Clean trailing punctuation
      const cleaned = link.replace(/[.,;:!?)}\]]+$/, "");
      linksSet.add(cleaned);
    });

    const links = [...linksSet].sort();

    // Categorize links
    const categories = {};
    links.forEach((link) => {
      try {
        const hostname = new URL(link).hostname;
        if (!categories[hostname]) categories[hostname] = [];
        categories[hostname].push(link);
      } catch {
        if (!categories["other"]) categories["other"] = [];
        categories["other"].push(link);
      }
    });

    return res.status(200).json({
      success: true,
      targetUrl: targetUrl.href,
      totalLinks: links.length,
      totalDomains: Object.keys(categories).length,
      categories,
      links,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Extraction failed: ${err.message}`,
    });
  }
};
