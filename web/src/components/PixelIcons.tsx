const FILLED: Array<[number, number]> = [
  [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0],
  ...Array.from({ length: 14 }, (_, i) => [i + 1, 1] as [number, number]),
  ...Array.from({ length: 16 }, (_, i) => [i, 2] as [number, number]),
  ...Array.from({ length: 16 }, (_, i) => [i, 3] as [number, number]),
  ...Array.from({ length: 16 }, (_, i) => [i, 4] as [number, number]),
  ...Array.from({ length: 16 }, (_, i) => [i, 5] as [number, number]),
  ...Array.from({ length: 14 }, (_, i) => [i + 1, 6] as [number, number]),
  ...Array.from({ length: 12 }, (_, i) => [i + 2, 7] as [number, number]),
  ...Array.from({ length: 10 }, (_, i) => [i + 3, 8] as [number, number]),
  ...Array.from({ length: 8 }, (_, i) => [i + 4, 9] as [number, number]),
  ...Array.from({ length: 6 }, (_, i) => [i + 5, 10] as [number, number]),
  ...Array.from({ length: 4 }, (_, i) => [i + 6, 11] as [number, number]),
  [7, 12], [8, 12],
];

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

export function PixelHeart({ filled, size = 24 }: { filled: boolean; size?: number }) {
  const cells = filled ? FILLED : OUTLINE;
  return (
    <svg
      width={size}
      height={size * 13 / 16}
      viewBox="0 0 16 13"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
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
