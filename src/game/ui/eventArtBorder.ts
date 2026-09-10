import type Phaser from 'phaser';

type ArtBounds = { x: number; y: number; width: number; height: number };
type BorderStroke = { bounds: ArtBounds; color: number; width: number };

/** Story-specific POIs read as manga panels. Ordinary area art keeps its
 * existing neutral edge. All strokes stay inside the existing art rectangle. */
export function eventArtBorderModel(kind: 'event' | 'theme', bounds: ArtBounds): readonly BorderStroke[] {
  if (kind !== 'event') return [];
  const inset = (amount: number): ArtBounds => ({ x: bounds.x + amount, y: bounds.y + amount, width: bounds.width - amount * 2, height: bounds.height - amount * 2 });
  return [
    { bounds: inset(2), color: 0x163547, width: 4 },
    { bounds: inset(4), color: 0xffedc7, width: 2 },
  ];
}

export function renderEventArtBorder(scene: Phaser.Scene, kind: 'event' | 'theme', bounds: ArtBounds): void {
  const strokes = eventArtBorderModel(kind, bounds);
  if (!strokes.length) return;
  const ink = scene.add.graphics().setName('poi-manga-border');
  for (const stroke of strokes) {
    ink.lineStyle(stroke.width, stroke.color, 1);
    ink.strokeRect(stroke.bounds.x, stroke.bounds.y, stroke.bounds.width, stroke.bounds.height);
  }
  // Short ink accents tuck just inside the cream keyline at each corner.
  const pad = 7, length = 12;
  ink.lineStyle(2, 0x163547, 1);
  for (const dx of [0, 1]) for (const dy of [0, 1]) {
    const x = bounds.x + (dx ? bounds.width - pad : pad);
    const y = bounds.y + (dy ? bounds.height - pad : pad);
    ink.beginPath(); ink.moveTo(x + (dx ? -length : length), y); ink.lineTo(x, y);
    ink.lineTo(x, y + (dy ? -length : length)); ink.strokePath();
  }
}
