import { CustomerServiceOutlined } from "@ant-design/icons";
import { Avatar } from "antd";
import { useEffect, useRef, useState } from "react";
import type { AudioTrack } from "../app/types";
import { useTrackCover } from "../hooks/useTrackCovers";

type ArtworkTrack = Pick<AudioTrack, "coverDataUrl"> & Partial<Pick<AudioTrack, "path" | "hasCover">>;

export function TrackArtwork({ track, size }: { track?: ArtworkTrack; size: number }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || nearViewport || track?.coverDataUrl || !track?.path || !track.hasCover) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearViewport, track?.coverDataUrl, track?.hasCover, track?.path]);
  const lazyCover = useTrackCover(track?.path, nearViewport && Boolean(track?.hasCover));
  const coverDataUrl = track?.coverDataUrl ?? lazyCover;

  if (coverDataUrl) {
    return <span ref={containerRef}><Avatar shape="square" src={coverDataUrl} size={size} className="artwork" /></span>;
  }

  return (
    <span ref={containerRef}>
      <Avatar shape="square" size={size} className="artwork fallback-artwork">
        <CustomerServiceOutlined />
      </Avatar>
    </span>
  );
}
