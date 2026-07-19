import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** App icon generated at build time — a gradient tile with the ₹-split mark. */
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
          background: "linear-gradient(135deg, #6c5bff 0%, #a855f7 55%, #ec4899 100%)",
          borderRadius: 96,
          color: "white",
          fontSize: 300,
          fontWeight: 700,
        }}
      >
        ₹
      </div>
    ),
    size,
  );
}
