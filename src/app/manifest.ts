import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Splitzy",
    short_name: "Splitzy",
    description: "Trip expenses for Snehil, Shruti & Anshul — split, sorted.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0a12",
    theme_color: "#6c5bff",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
