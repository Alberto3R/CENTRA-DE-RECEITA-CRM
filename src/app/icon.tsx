import { ImageResponse } from "next/og";

// Brand favicon — Central de Receita: lime square (#A6E43C, the brand
// signature green) with "CR" in ink. Next.js renders this at build time and
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
          background: "#A6E43C",
          color: "#0A0A0A",
          fontSize: 17,
          fontWeight: 700,
          fontFamily: "sans-serif",
          letterSpacing: "-0.04em",
          borderRadius: 6,
        }}
      >
        CR
      </div>
    ),
    { ...size },
  );
}
