import { useEffect, useRef, useState } from "react";

export function useIncrementalGrid(itemCount: number, pageSize = 40) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(itemCount, pageSize));
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(Math.min(itemCount, pageSize));
  }, [itemCount, pageSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= itemCount) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount((current) => Math.min(itemCount, current + pageSize));
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleCount((current) => Math.min(itemCount, current + pageSize));
      }
    }, { rootMargin: "600px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [itemCount, pageSize, visibleCount]);

  return { visibleCount, sentinelRef, hasMore: visibleCount < itemCount };
}
