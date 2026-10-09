import type { MetadataRoute } from "next";

const BASE = "https://www.centraldereceita.com.br";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/oferta`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
