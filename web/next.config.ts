import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // pdf.js가 서버용 canvas 패키지를 찾지 않도록 한다.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
