import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "内容工作台",
    short_name: "内容工作台",
    description: "远程查看热榜、管理转写稿并生成文案。",
    start_url: "/mobile",
    display: "standalone",
    background_color: "#f4f6f5",
    theme_color: "#f4f6f5",
    orientation: "any",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
