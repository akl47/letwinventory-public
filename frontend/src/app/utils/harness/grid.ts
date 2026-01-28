// Grid rendering for harness canvas

/**
 * Draw grid (dark mode) - Draws in screen space for consistent rendering
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  screenWidth: number,
  screenHeight: number,
  gridSize: number,
  panX: number = 0,
  panY: number = 0,
  zoom: number = 1
): void {
  ctx.save();

  // Grid spacing in screen space
  const screenGridSize = gridSize * zoom;

  // Calculate starting position accounting for pan
  const startX = (panX % screenGridSize);
  const startY = (panY % screenGridSize);

  // Draw vertical lines
  for (let screenX = startX; screenX <= screenWidth; screenX += screenGridSize) {
    const worldX = (screenX - panX) / zoom;
    const isMajor = Math.abs(Math.round(worldX / gridSize) % 5) === 0;

    ctx.strokeStyle = isMajor ? '#404040' : '#2a2a2a';
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.round(screenX) + 0.5, 0);
    ctx.lineTo(Math.round(screenX) + 0.5, screenHeight);
    ctx.stroke();
  }

  // Draw horizontal lines
  for (let screenY = startY; screenY <= screenHeight; screenY += screenGridSize) {
    const worldY = (screenY - panY) / zoom;
    const isMajor = Math.abs(Math.round(worldY / gridSize) % 5) === 0;

    ctx.strokeStyle = isMajor ? '#404040' : '#2a2a2a';
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(screenY) + 0.5);
    ctx.lineTo(screenWidth, Math.round(screenY) + 0.5);
    ctx.stroke();
  }

  ctx.restore();
}
