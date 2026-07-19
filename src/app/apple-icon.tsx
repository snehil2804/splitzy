import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iOS (iOS applies its own corner mask). */
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
          background: "linear-gradient(135deg, #6c5bff 0%, #a855f7 55%, #ec4899 100%)",
          color: "white",
          fontSize: 108,
          fontWeight: 700,
        }}
      >
        ₹
      </div>
    ),
    size,
  );
}
