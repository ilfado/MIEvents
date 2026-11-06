export function PixelHeart({ size = 26 }: { size?: number }) {
  const OUTLINE: Array<[number, number]> = [
    [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0],
    [1, 1], [7, 1], [8, 1], [14, 1],
    [0, 2], [15, 2],
    [0, 3], [15, 3],
    [0, 4], [15, 4],
    [0, 5], [15, 5],
    [1, 6], [14, 6],
    [2, 7], [13, 7],
    [3, 8], [12, 8],
    [4, 9], [11, 9],
    [5, 10], [10, 10],
    [6, 11], [9, 11],
    [7, 12], [8, 12],
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {OUTLINE.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y + 1} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export function PixelShades({ size = 24 }: { size?: number }) {
  const rects: Array<[number, number, number, number]> = [
    [0, 0, 11, 1],
    [0, 1, 4, 1], [7, 1, 4, 1],
    [0, 2, 4, 1], [7, 2, 4, 1],
    [1, 3, 2, 1], [8, 3, 2, 1],
  ];
  return (
    <svg
      width={size}
      height={size * 4 / 11}
      viewBox="0 0 11 4"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rects.map(([x, y, w, h]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}
