import { CustomerServiceOutlined } from "@ant-design/icons";
import { Avatar } from "antd";
import type { AudioTrack } from "../app/types";

export function TrackArtwork({ track, size }: { track?: Pick<AudioTrack, "coverDataUrl">; size: number }) {
  if (track?.coverDataUrl) {
    return <Avatar shape="square" src={track.coverDataUrl} size={size} className="artwork" />;
  }

  return (
    <Avatar shape="square" size={size} className="artwork fallback-artwork">
      <CustomerServiceOutlined />
    </Avatar>
  );
}
