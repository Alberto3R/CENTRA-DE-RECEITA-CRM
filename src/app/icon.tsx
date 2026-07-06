import { ImageResponse } from "next/og";

// Brand favicon — Central de Receita: emerald square (#10B981, the brand
// signature green) with the sales bell in ink. Next.js renders this at build time and
// auto-injects <link rel="icon"> into <head>. Takes precedence over
// src/app/favicon.ico (the Next.js default, harmless on disk).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#10B981",
          color: "#04231A",
          borderRadius: 7,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 120 120" fill="#04231A">
          <circle cx="60" cy="22" r="5" />
          <path d="M60 27 C67 27 72 33 72 41 L72 43 C83 48 86 62 87 74 C87 78 89 81 91 83 C93 85 92 88 89 88 L31 88 C28 88 27 85 29 83 C31 81 33 78 33 74 C34 62 37 48 48 43 L48 41 C48 33 53 27 60 27 Z" />
          <path d="M49 92 C49 98 54 102 60 102 C66 102 71 98 71 92 Z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
