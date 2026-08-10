import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 38,
          background: "linear-gradient(145deg, #668cf4, #355cc8)",
          color: "white",
          fontSize: 100,
          fontWeight: 750,
          letterSpacing: -8
        }}
      >
        P
      </div>
    ),
    size
  );
}
