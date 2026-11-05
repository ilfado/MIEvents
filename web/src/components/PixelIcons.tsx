export function PixelHeart({ filled, size = 22 }: { filled: boolean; size?: number }) {
  const cells: Array<[number, number]> = filled
    ? [
        [1, 0], [2, 0], [6, 0], [7, 0],
        [0, 1], [1, 1], [2, 1], [3, 1], [5, 1], [6, 1], [7, 1], [8, 1],
        [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2],
        [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3],
        [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4],
        [2, 5], [3, 5], [4, 5], [5, 5], [6, 5],
        [3, 6], [4, 6], [5, 6],
        [4, 7],
      ]
    : [
        [1, 0], [2, 0], [6, 0], [7, 0],
        [0, 1], [3, 1], [5, 1], [8, 1],
        [0, 2], [4, 2], [8, 2],
        [0, 3], [8, 3],
        [1, 4], [7, 4],
        [2, 5], [6, 5],
        [3, 6], [5, 6],
        [4, 7],
      ];
  return (
    <svg
      width={size}
      height={size * 8 / 9}
      viewBox="0 0 9 8"
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
