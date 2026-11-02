// Fields to draw poses on, by season: WPILib's images, and where the field
// is in each (its corners in pixels) and how big it is (metres), from the
// JSON beside each image in allwpilib's fields/. Newest first.
//
// The images are drawn from the red alliance's end: turned as they are,
// the red side is at x = 0, where WPILib's coordinates put the blue
// alliance wall (its AprilTag layouts, and robots' poses, have the red
// speaker, grids and hub at the far end). So they're drawn turned 180°
// about the field's middle, which puts each element where the tags say.

import field2022 from '@/assets/fields/2022-rapidreact.png';
import field2023 from '@/assets/fields/2023-chargedup.png';
import field2024 from '@/assets/fields/2024-crescendo.png';
import field2025 from '@/assets/fields/2025-reefscape.png';
import field2026 from '@/assets/fields/2026-rebuilt.png';

export interface FieldImage {
  season: string;
  game: string;
  image: string;
  // The field's edges in the image, pixels.
  top: number;
  left: number;
  bottom: number;
  right: number;
  // Metres: along the field (x) and across it (y).
  length: number;
  width: number;
}

export const fieldImages: FieldImage[] = [
  { season: '2026', game: 'Rebuilt', image: field2026, top: 121, left: 254, bottom: 1917, right: 3951, length: 16.541, width: 8.069 },
  { season: '2025', game: 'Reefscape', image: field2025, top: 289, left: 534, bottom: 1636, right: 3466, length: 17.548, width: 8.052 },
  { season: '2024', game: 'Crescendo', image: field2024, top: 80, left: 151, bottom: 1477, right: 2962, length: 16.541, width: 8.211 },
  { season: '2023', game: 'Charged Up', image: field2023, top: 36, left: 46, bottom: 544, right: 1088, length: 16.54175, width: 8.0137 },
  { season: '2022', game: 'Rapid React', image: field2022, top: 49, left: 85, bottom: 899, right: 1785, length: 16.4592, width: 8.2296 }
];

export const fieldFor = (season: string): FieldImage => fieldImages.find((f) => f.season === season) ?? fieldImages[0];

// The season a log's from, by when it was recorded: a season's field is
// played from January into the next autumn's off-season events.
export function seasonFor(recorded: string | null | undefined): string {
  const year = recorded ? new Date(recorded).getFullYear() : new Date().getFullYear();
  return fieldImages.some((f) => f.season === String(year)) ? String(year) : fieldImages[0].season;
}
