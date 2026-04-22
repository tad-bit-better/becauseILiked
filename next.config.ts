import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
         {
      protocol: 'https',
      hostname: 'covers.openlibrary.org',
      pathname: '/b/id/**',
    },
    ],
  },
};

export default nextConfig;